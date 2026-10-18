import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NextActionForm, NotesForm, SendForm, StatusForm } from "@/components/applications/ApplicationForms";
import { EVENT_LABELS, STATUS_META } from "@/components/applications/labels";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { cn } from "@/lib/cn";
import { CHANNELS, CLOSED, getApplication, isOverdue, localDate, type ApplicationStatus, type Channel } from "@/modules/applications";
import { getVersion } from "@/modules/profile";

export const metadata: Metadata = { title: "Candidature" };

const day = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const stamp = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: process.env.APP_TIME_ZONE ?? "Europe/Paris" });
const fmt = (d: string | null) => (d ? day.format(new Date(`${d}T00:00:00Z`)) : "—");
const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const statusLabel = (s: ApplicationStatus | null) => (s ? STATUS_META[s].label : "—");

function describe(e: { type: keyof typeof EVENT_LABELS; fromStatus: ApplicationStatus | null; toStatus: ApplicationStatus | null; payload: Record<string, unknown> }): string {
  const p = e.payload;
  switch (e.type) {
    case "created":
      return `Candidature créée · « ${statusLabel(e.toStatus)} »`;
    case "status_changed":
      return `Statut : ${statusLabel(e.fromStatus)} → ${statusLabel(e.toStatus)}${typeof p.nextActionAt === "string" ? ` · relance proposée le ${fmt(p.nextActionAt)}` : ""}`;
    case "sent":
      return `Envoi confirmé par toi le ${fmt(String(p.sentAt))} · ${CHANNELS[p.channel as Channel] ?? "canal inconnu"} · ${String(p.fileName)} figé (sha256 ${shortHash(String(p.sha256))})`;
    case "next_action_set":
      return `Prochaine action : ${p.nextAction ? String(p.nextAction) : "aucune"}${typeof p.nextActionAt === "string" ? ` · échéance ${fmt(p.nextActionAt)}` : ""}`;
  }
}

export default async function ApplicationPage(props: PageProps<"/candidatures/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const db = getDb();
  const found = await getApplication(db, user.id, id);
  if (!found) notFound();
  const { application: app, offer, company, documents, events, versions } = found;
  const chosen = versions.find((v) => v.id === app.cvVersionId) ?? null;
  const base = chosen ? await getVersion(db, user.id, chosen.baseProfileVersionId) : null;
  const sentDoc = documents[0] ?? null;
  const meta = STATUS_META[app.status];
  const today = localDate();
  const late = isOverdue(app.nextActionAt, today);
  const finalized = versions.filter((v) => v.status === "finalized");

  return (
    <>
      <nav aria-label="Fil d'Ariane" className="flex flex-wrap gap-1.5 text-sm text-muted-foreground">
        <Link href="/candidatures" className="text-accent">
          Candidatures
        </Link>
        <span aria-hidden="true">/</span>
        <span>
          {company ? `${company} — ` : ""}
          {offer.title}
        </span>
      </nav>
      <PageHeader
        title={offer.title}
        actions={
          <>
            <StatusBadge tone={meta.tone}>
              {meta.glyph} {meta.label}
            </StatusBadge>
            {app.matchScore !== null ? <span className="rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[13px] font-medium text-accent">Matching {app.matchScore}/100</span> : null}
          </>
        }
      >
        <p className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          {company ? <span className="font-semibold text-foreground">{company}</span> : null}
          {offer.location ? <span>· {offer.location}</span> : null}
          <span>
            · <Link href={`/offres/${offer.id}`}>Offre source</Link>
          </span>
          <span>· Créée le {stamp.format(app.createdAt)}</span>
        </p>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel aria-label="Documents" className="flex flex-col gap-3.5">
            <h2 className="text-lg font-semibold tracking-tight">Documents</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Profil maître</span>
                <span className="text-[15px] font-semibold">{base ? `Version ${base.version}` : "—"}</span>
                <span className="text-[13px] text-muted-foreground">Source de vérité. Un CV personnalisé ne le modifie jamais.</span>
                {base ? <Link href={`/profil/versions/${base.id}`} className="text-sm font-semibold">Voir le profil</Link> : null}
              </div>
              <div className="flex flex-col gap-1.5 rounded-lg border border-accent p-3.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">CV personnalisé</span>
                <span className="text-[15px] font-semibold">{chosen ? `Version ${chosen.version} · ${chosen.status === "finalized" ? "finalisée" : "enregistrée"}` : "Aucune version finalisée"}</span>
                <span className="text-[13px] text-muted-foreground">{base ? `Basé sur le profil v${base.version}.` : "Adapte et finalise le CV de cette offre."}</span>
                {chosen ? (
                  <Link href={`/offres/${offer.id}/cv/recontrole/${chosen.id}`} className="text-sm font-semibold">
                    Voir le recontrôle
                  </Link>
                ) : (
                  <Link href={`/offres/${offer.id}/cv`} className="text-sm font-semibold">
                    Ouvrir l&apos;éditeur
                  </Link>
                )}
              </div>
              <div className={cn("flex flex-col gap-1.5 rounded-lg border border-dashed p-3.5", sentDoc ? "border-foreground" : "border-border")}>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">CV effectivement envoyé</span>
                {sentDoc ? (
                  <>
                    <span className="text-[15px] font-semibold">Figé le {fmt(app.sentAt)}</span>
                    <span className="break-all text-[13px] text-muted-foreground">
                      {sentDoc.fileName} · sha256 <span className="font-mono">{shortHash(sentDoc.sha256)}</span>
                    </span>
                    <a href={`/api/applications/documents/${sentDoc.id}`} className="text-sm font-semibold">
                      Télécharger le fichier envoyé
                    </a>
                  </>
                ) : (
                  <>
                    <span className="text-[15px] font-semibold">Aucun pour l&apos;instant</span>
                    <span className="text-[13px] text-muted-foreground">La candidature n&apos;est marquée envoyée que lorsque tu le confirmes.</span>
                  </>
                )}
              </div>
            </div>
          </Panel>

          <Panel aria-label="Envoi" className="flex flex-col gap-3.5">
            <h2 className="text-lg font-semibold tracking-tight">Envoi</h2>
            {app.sentAt ? (
              <p role="status" className="rounded-lg border border-accent px-3.5 py-3 text-sm font-medium text-accent">
                ✓ Envoi confirmé le {fmt(app.sentAt)} · {CHANNELS[app.channel as Channel] ?? app.channel}
                {app.nextActionAt ? ` · relance proposée le ${fmt(app.nextActionAt)}` : ""}
              </p>
            ) : CLOSED.has(app.status) ? (
              <p className="text-sm text-muted-foreground">Candidature close : rouvre-la (étape) pour confirmer un envoi.</p>
            ) : (
              <>
                <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
                  JobPilot prépare le dossier mais n&apos;envoie rien à ta place : aucune intégration d&apos;envoi autorisée n&apos;est disponible. Envoie-le toi-même, puis confirme ici.
                  {chosen?.status === "finalized" ? (
                    <>
                      {" "}
                      <a href={`/api/cv/${chosen.id}/export?format=pdf`}>Télécharger le CV v{chosen.version} (PDF)</a>.
                    </>
                  ) : null}
                </p>
                <SendForm id={app.id} today={today} versions={finalized.map((v) => ({ id: v.id, label: `CV personnalisé v${v.version} (PDF)` }))} channels={CHANNELS} />
              </>
            )}
          </Panel>

          <Panel aria-label="Historique" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Historique</h2>
            <ol className="flex flex-col">
              {events.map((e) => (
                <li key={e.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-b border-border py-2 text-sm leading-5 last:border-0">
                  <span className="font-mono text-xs text-muted-foreground">{stamp.format(e.occurredAt)}</span>
                  <span>{describe(e)}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Panel aria-label="Étape" className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Étape</h2>
            <StatusForm key={app.status} id={app.id} status={app.status} sent={app.sentAt !== null} />
          </Panel>
          <Panel aria-label="Prochaine action" className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Prochaine action</h2>
            {late ? (
              <p role="status" className="text-sm font-semibold text-danger">
                ! En retard depuis le {fmt(app.nextActionAt)}
              </p>
            ) : null}
            <NextActionForm key={`${app.nextAction}-${app.nextActionAt}`} id={app.id} nextAction={app.nextAction} nextActionAt={app.nextActionAt} followUpDays={app.followUpDays} />
          </Panel>
          <Panel aria-label="Notes" className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Notes</h2>
            <NotesForm id={app.id} notes={app.notes} />
          </Panel>
        </aside>
      </div>
    </>
  );
}
