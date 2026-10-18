import type { Metadata } from "next";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { dailyBudgetUsd, providerStatuses, providerUsageToday, spentTodayUsd } from "@/modules/platform";

export const metadata: Metadata = { title: "Fournisseurs IA" };

const usd = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 3 });
const seconds = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function limit(n: number | null) {
  return n === null ? "non limité" : String(n);
}

export default async function AiProvidersPage() {
  const user = await requireUser();
  const db = getDb();
  const [usage, spent] = await Promise.all([providerUsageToday(db), spentTodayUsd(db, user.id)]);
  const byProvider = new Map(usage.map((u) => [u.provider, u]));
  const statuses = providerStatuses();
  const active = statuses.filter((s) => s.enabled);

  return (
    <>
      <PageHeader eyebrow="Réglages" title="Fournisseurs IA">
        <p className="max-w-prose text-[15px] leading-6 text-muted-foreground">
          Les fournisseurs sont essayés dans l&apos;ordre ci-dessous. Un fournisseur saturé, en échec ou non autorisé passe la main au suivant. La configuration se fait par variables d&apos;environnement ; aucune clé n&apos;est affichée.
        </p>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground">Fournisseurs actifs</span>
          <span className="text-3xl font-bold">{active.length}</span>
        </Panel>
        <Panel className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground">Appels aujourd&apos;hui</span>
          <span className="text-3xl font-bold">{usage.reduce((s, u) => s + u.calls, 0)}</span>
        </Panel>
        <Panel className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground">Coût du jour</span>
          <span className="text-3xl font-bold">{usd.format(spent)}</span>
          <span className="text-xs text-muted-foreground">Budget : {usd.format(dailyBudgetUsd())} par jour</span>
        </Panel>
      </div>

      {active.length === 0 ? (
        <p role="status" className="rounded-lg border border-signal bg-panel px-4 py-3 text-sm">
          Aucun fournisseur actif : les analyses restent en file. Renseigne au moins une clé et un modèle (voir <code className="font-mono">.env.example</code>), puis lance <code className="font-mono">npm run llm:check</code>.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-panel">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="bg-background text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 font-medium">Ordre</th>
              <th scope="col" className="px-2 py-2.5 font-medium">Fournisseur</th>
              <th scope="col" className="px-2 py-2.5 font-medium">État</th>
              <th scope="col" className="px-2 py-2.5 font-medium">Données personnelles</th>
              <th scope="col" className="px-2 py-2.5 font-medium">Limites (min / jour)</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Aujourd&apos;hui</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s, i) => {
              const u = byProvider.get(s.id);
              return (
                <tr key={s.id} className="border-t border-muted align-top">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                  <th scope="row" className="px-2 py-3 text-left font-normal">
                    <span className="font-semibold">{s.label}</span>
                    <div className="font-mono text-xs text-muted-foreground">{s.model ?? "modèle non défini"}</div>
                    <div className="pt-1 text-xs leading-5 text-muted-foreground">{s.dataNote}</div>
                  </th>
                  <td className="px-2 py-3">
                    {s.enabled ? (
                      <StatusBadge tone="accent">Actif</StatusBadge>
                    ) : (
                      <>
                        <StatusBadge>Inactif</StatusBadge>
                        <div className="pt-1 font-mono text-xs text-muted-foreground">manque {s.missing.join(", ")}</div>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    {s.policy.allowsPersonalData ? <StatusBadge tone="signal">Autorisées</StatusBadge> : <StatusBadge>Refusées</StatusBadge>}
                  </td>
                  <td className="px-2 py-3 font-mono text-xs">
                    {limit(s.policy.requestsPerMinute)} / {limit(s.policy.requestsPerDay)}
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    {u ? (
                      <>
                        {u.ok} réussi{u.ok > 1 ? "s" : ""}, {u.failed} échec{u.failed > 1 ? "s" : ""}
                        {s.policy.requestsPerDay !== null ? ` · ${u.calls}/${s.policy.requestsPerDay}` : ""}
                        <div className="text-xs text-muted-foreground">
                          {u.avgLatencyMs !== null ? `${seconds.format(u.avgLatencyMs / 1000)} s en moyenne · ` : ""}
                          {usd.format(u.costUsd)}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Aucun appel</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground">
        Les limites par défaut sont indicatives (relevées le 18/10/2026 sur des sources secondaires) : vérifie-les sur la console de chaque fournisseur et ajuste <code className="font-mono">*_RPM</code> et <code className="font-mono">*_RPD</code>. Les annonces sont des données publiques ; le CV et les candidatures ne partent que vers un fournisseur dont la ligne indique « Autorisées ».
      </p>
    </>
  );
}
