import type { Metadata } from "next";
import { BackupNowButton } from "@/components/backups/BackupNowButton";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { BACKUP_MAX_AGE_HOURS, backupConfig, backupFreshness, getBoss, listBackupRuns, logger } from "@/modules/platform";

export const metadata: Metadata = { title: "Sauvegardes" };

const TZ = process.env.APP_TIME_ZONE ?? "Europe/Paris";
const stamp = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
const size = new Intl.NumberFormat("fr-FR", { style: "unit", unit: "kilobyte", maximumFractionDigits: 0 });

async function schedule() {
  try {
    const boss = await getBoss();
    const [row] = await boss.getSchedules("backup.run");
    if (!row) return null;
    const data = (row.data ?? {}) as { offsite?: unknown; retentionDays?: unknown };
    return {
      cron: row.cron,
      timezone: row.timezone,
      next: boss.previewSchedule(row.cron, { tz: row.timezone, count: 1 })[0] ?? null,
      offsite: data.offsite === true,
      retentionDays: typeof data.retentionDays === "number" ? data.retentionDays : null,
    };
  } catch (err) {
    logger.error({ err }, "lecture de la planification des sauvegardes");
    return null;
  }
}

export default async function BackupsPage() {
  await requireUser();
  const db = getDb();
  const config = backupConfig();
  const [planned, runs, fresh] = await Promise.all([schedule(), listBackupRuns(db), backupFreshness(db)]);
  const pending = runs.some((r) => r.status === "running");
  // La planification, écrite par le worker, fait foi : le serveur web n'a pas forcément les variables du worker.
  const retentionDays = planned?.retentionDays ?? (config.enabled ? config.retentionDays : 30);
  const offsite = planned ? planned.offsite : config.enabled && config.offsite;

  return (
    <>
      <PageHeader eyebrow="Réglages" title="Sauvegardes">
        <p className="max-w-prose text-[15px] leading-6 text-muted-foreground">
          Chaque jour, le worker sauvegarde la base et les fichiers dans une archive chiffrée (AES-256), garde {retentionDays} jours
          d&apos;archives et peut en copier chacune hors site. La restauration se fait avec <code className="font-mono">scripts/restore.sh</code> (voir{" "}
          <code className="font-mono">docs/OPERATIONS.md</code>).
        </p>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel aria-label="Planification" className="flex flex-col items-start gap-1.5">
          <span className="text-sm font-semibold text-muted-foreground">Planification</span>
          {planned ? (
            <>
              <StatusBadge tone="accent">Active</StatusBadge>
              <span className="text-sm">
                Prochaine : {planned.next ? stamp.format(planned.next) : "—"} <span className="font-mono text-xs text-muted-foreground">({planned.cron}, {planned.timezone})</span>
              </span>
            </>
          ) : (
            <>
              <StatusBadge tone="signal">Inactive</StatusBadge>
              <span className="text-[13px] leading-5 text-muted-foreground">
                {config.enabled
                  ? "Configurée ici, mais le worker ne l'a pas encore planifiée : démarre ou redémarre le worker."
                  : `Renseigne ${config.missing.join(", ")} dans l'environnement du worker, puis redémarre-le.`}
              </span>
            </>
          )}
        </Panel>
        <Panel aria-label="Dernière sauvegarde réussie" className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-muted-foreground">Dernière sauvegarde réussie</span>
          {fresh.last ? <span className="text-lg font-semibold">{stamp.format(fresh.last.startedAt)}</span> : <span className="text-lg font-semibold">Aucune</span>}
          {fresh.stale ? (
            <p role="status" className="text-[13px] text-danger">
              ! Aucune sauvegarde réussie depuis plus de {BACKUP_MAX_AGE_HOURS} heures.
            </p>
          ) : null}
        </Panel>
        <Panel aria-label="Copie hors site" className="flex flex-col items-start gap-1.5">
          <span className="text-sm font-semibold text-muted-foreground">Copie hors site</span>
          {offsite ? (
            <StatusBadge tone="accent">Configurée</StatusBadge>
          ) : (
            <>
              <StatusBadge>Non configurée</StatusBadge>
              <span className="text-[13px] leading-5 text-muted-foreground">
                Une archive restée sur le même serveur disparaît avec lui : renseigne <code className="font-mono">BACKUP_COPY_COMMAND</code>.
              </span>
            </>
          )}
        </Panel>
      </div>

      <Panel aria-label="Sauvegarde à la demande" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Sauvegarde à la demande</h2>
        <BackupNowButton disabled={pending} />
        {pending ? <p className="text-[13px] text-muted-foreground">Une sauvegarde est en cours.</p> : null}
      </Panel>

      <Panel aria-label="Historique des sauvegardes" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Historique</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune sauvegarde pour l&apos;instant.</p>
        ) : (
          <ScrollArea label="Tableau des sauvegardes" className="rounded-lg border border-border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="bg-background text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Début</th>
                  <th scope="col" className="px-3 py-2 font-medium">Origine</th>
                  <th scope="col" className="px-3 py-2 font-medium">Résultat</th>
                  <th scope="col" className="px-3 py-2 font-medium">Archive</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-muted align-top">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {stamp.format(r.startedAt)}
                    </th>
                    <td className="px-3 py-2">{r.trigger === "schedule" ? "Planifiée" : "À la demande"}</td>
                    <td className="px-3 py-2">
                      {r.status === "ok" ? <StatusBadge tone="accent">Réussie</StatusBadge> : r.status === "running" ? <StatusBadge tone="signal">En cours</StatusBadge> : <StatusBadge tone="danger">Échec</StatusBadge>}
                      {r.error ? <div className="pt-1 text-xs leading-5 text-danger">{r.error}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-[13px]">
                      {r.fileName ? (
                        <>
                          <span className="break-all font-mono text-xs">{r.fileName}</span>
                          <div className="text-xs text-muted-foreground">
                            {r.sizeBytes !== null ? size.format(r.sizeBytes / 1024) : ""} · sha256 <span className="font-mono">{r.sha256?.slice(0, 12)}…</span>
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Panel>
    </>
  );
}
