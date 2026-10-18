import Link from "next/link";
import { STATUS_META } from "@/components/applications/labels";
import { OFFER_SOURCE_LABELS } from "@/components/offers/status";
import { ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { cn } from "@/lib/cn";
import { localDate } from "@/modules/applications";
import { dailyGoal, getDashboard, type Period } from "@/modules/metrics";

const TZ = process.env.APP_TIME_ZONE ?? "Europe/Paris";
const longDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const usd = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

const FUNNEL = [
  ["collected", "Offres collectées", "Chaque import tenté, doublons compris"],
  ["fresh", "Nouvelles (après dédoublonnage)", null],
  ["analyzed", "Analysées", null],
  ["qualified", "Qualifiées", null],
  ["cvFinalized", "CV adaptés (finalisés)", null],
  ["prepared", "Candidatures préparées", "Passées à « Prête à envoyer »"],
  ["sent", "Candidatures envoyées", "Confirmées par toi"],
  ["interviews", "Entretiens obtenus", null],
] as const;

function Stat({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("text-[28px] font-bold leading-9 tabular-nums", tone)}>{value}</span>
      <span className="text-[13px] leading-5 text-muted-foreground">{label}</span>
    </div>
  );
}

function Todo({ tag, tone, children, href, cta }: { tag: string; tone: Tone; children: React.ReactNode; href: string; cta: string }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-border py-3 first:border-0">
      <StatusBadge tone={tone}>{tag}</StatusBadge>
      <span className="min-w-0 flex-1 text-sm leading-5">{children}</span>
      <Link href={href} className="text-sm font-semibold whitespace-nowrap">
        {cta}
      </Link>
    </li>
  );
}

export default async function DashboardPage(props: PageProps<"/">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const period: Period = sp.periode === "7j" ? "week" : "day";
  const today = localDate(new Date(), TZ);
  const d = await getDashboard(getDb(), user.id, { period, today, timeZone: TZ, dailyGoal: dailyGoal() });
  const max = Math.max(1, d.funnel.collected, ...Object.values(d.funnel));
  const pct = d.goal.target ? Math.min(100, Math.round((d.goal.processed / d.goal.target) * 100)) : 0;
  const rate = (v: number | null) => (v === null ? "—" : `${v} %`);
  const nothing = Object.values(d.funnel).every((v) => v === 0) && d.todo.overdue.length === 0 && d.todo.ready.length === 0;

  return (
    <>
      <PageHeader
        eyebrow={`Tableau de bord · ${longDay.format(asDate(today))}${period === "week" ? ` · du ${shortDay.format(asDate(d.range.from))} au ${shortDay.format(asDate(d.range.to))}` : ""}`}
        title="Ta journée de recherche"
        actions={
          <>
            <div role="group" aria-label="Période" className="flex gap-1 rounded-lg border border-border bg-panel p-1">
              {[
                ["day", "Aujourd'hui", "/"],
                ["week", "7 jours", "/?periode=7j"],
              ].map(([id, label, href]) => (
                <Link
                  key={id}
                  href={href!}
                  aria-current={period === id ? "page" : undefined}
                  className={cn("inline-flex min-h-9 items-center rounded-md px-3 text-sm no-underline", period === id ? "bg-foreground font-semibold text-background" : "text-foreground")}
                >
                  {label}
                </Link>
              ))}
            </div>
            <ButtonLink href="/candidatures">Ouvrir le Kanban</ButtonLink>
            <ButtonLink href="/offres" variant="primary">
              Importer une offre
            </ButtonLink>
          </>
        }
      />

      {nothing ? (
        <p role="status" className="rounded-lg border border-dashed border-border bg-panel px-4 py-3 text-sm text-muted-foreground">
          Rien de mesuré sur la période. Les chiffres viennent des imports, analyses, décisions et candidatures réellement enregistrés : aucun n&apos;est estimé.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Panel aria-label="Objectif" className="flex flex-col gap-3.5">
          <h2 className="text-sm font-semibold text-muted-foreground">Objectif : offres traitées</h2>
          <div className="flex items-baseline gap-2">
            <span className="text-[40px] font-bold leading-[44px] tracking-tight tabular-nums">{d.goal.processed}</span>
            <span className="text-muted-foreground">/ {d.goal.target}</span>
          </div>
          <div role="img" aria-label={`${pct} % de l'objectif`} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-2 bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Traitée = analysée puis qualifiée ou écartée. Les envois sont comptés à part. Objectif réglable par JOBPILOT_DAILY_GOAL.
          </p>
        </Panel>
        <Panel aria-label="Résultats réels" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Résultats réels</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat value={d.results.sent} label="Candidatures envoyées (confirmées)" />
            <Stat value={d.results.interviews} label="Entretiens obtenus" />
            <Stat value={d.results.refusals} label="Refus reçus" />
            <Stat value={d.results.overdue} label="Relances en retard (à ce jour)" tone={d.results.overdue ? "text-danger" : undefined} />
          </div>
        </Panel>
        <Panel aria-label="Santé du pipeline" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Santé du pipeline</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">Analyses en file</dt>
            <dd className="font-semibold tabular-nums">{d.health.queued}</dd>
            <dt className="text-muted-foreground">Analyses en échec</dt>
            <dd className={cn("font-semibold tabular-nums", d.health.failed > 0 && "text-signal")}>{d.health.failed}</dd>
            <dt className="text-muted-foreground">Durée moyenne d&apos;analyse</dt>
            <dd className="font-semibold tabular-nums">{d.health.avgAnalysisMs === null ? "—" : `${(d.health.avgAnalysisMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`}</dd>
            <dt className="text-muted-foreground">{period === "day" ? "Coût IA du jour" : "Coût IA sur 7 jours"}</dt>
            <dd className="font-semibold tabular-nums">
              {usd.format(period === "day" ? d.health.costTodayUsd : d.health.periodCostUsd)}
              {period === "day" ? <span className="font-normal text-muted-foreground"> / {usd.format(d.health.budgetUsd)}</span> : null}
            </dd>
          </dl>
        </Panel>
      </div>

      <Panel aria-label="Entonnoir de traitement" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Entonnoir de traitement</h2>
          <span className="text-[13px] text-muted-foreground">Chaque étape est mesurée séparément, sur la période</span>
        </div>
        <ol className="flex flex-col gap-2">
          {FUNNEL.map(([key, label, hint], i) => {
            const n = d.funnel[key];
            return (
              <li key={key} className="grid grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                <span title={hint ?? undefined}>{label}</span>
                <div className="h-4.5 overflow-hidden rounded bg-muted" aria-hidden="true">
                  <div className={cn("h-4.5 rounded", i < 3 ? "bg-muted-foreground/40" : i < 6 ? "bg-accent/70" : "bg-accent")} style={{ width: `${n ? Math.max(2, Math.round((n / max) * 100)) : 0}%` }} />
                </div>
                <span className="text-right font-semibold tabular-nums">{n}</span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-2 pt-1 font-mono text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-2.5 py-0.5">Doublons {rate(d.rates.duplicates)}</span>
          <span className="rounded-full border border-border px-2.5 py-0.5">Qualification {rate(d.rates.qualification)}</span>
          <span className="rounded-full border border-border px-2.5 py-0.5">Qualifiée → envoyée {rate(d.rates.qualifiedToSent)}</span>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel aria-label="À faire maintenant" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight">À faire maintenant</h2>
          <ul className="flex flex-col">
            {d.todo.overdue.slice(0, 5).map((t) => (
              <Todo key={t.id} tag="En retard" tone="danger" href={`/candidatures/${t.id}`} cta="Ouvrir">
                {t.nextAction ?? "Action"} — {t.company ? `${t.company} · ` : ""}
                {t.title} <span className="text-muted-foreground">(prévu le {t.nextActionAt ? shortDay.format(asDate(t.nextActionAt)) : "?"})</span>
              </Todo>
            ))}
            {d.todo.dueToday.slice(0, 5).map((t) => (
              <Todo key={t.id} tag="Aujourd'hui" tone="signal" href={`/candidatures/${t.id}`} cta="Ouvrir">
                {t.nextAction ?? "Action"} — {t.company ? `${t.company} · ` : ""}
                {t.title}
              </Todo>
            ))}
            {d.todo.ready.slice(0, 5).map((t) => (
              <Todo key={t.id} tag={STATUS_META.ready.label} tone="accent" href={`/candidatures/${t.id}`} cta="Envoyer">
                {t.company ? `${t.company} · ` : ""}
                {t.title} : CV finalisé, à envoyer
              </Todo>
            ))}
            {d.todo.withoutAction ? (
              <Todo tag="Sans action" tone="signal" href="/candidatures?sansaction=1" cta="Planifier">
                {d.todo.withoutAction} candidature{d.todo.withoutAction > 1 ? "s" : ""} active{d.todo.withoutAction > 1 ? "s" : ""} sans prochaine action
              </Todo>
            ) : null}
            {d.todo.failedAnalyses ? (
              <Todo tag="À analyser" tone="neutral" href="/offres?statut=failed" cta="Voir">
                {d.todo.failedAnalyses} analyse{d.todo.failedAnalyses > 1 ? "s" : ""} en échec
              </Todo>
            ) : null}
          </ul>
          {!d.todo.overdue.length && !d.todo.dueToday.length && !d.todo.ready.length && !d.todo.withoutAction && !d.todo.failedAnalyses ? (
            <p className="text-sm text-muted-foreground">Rien d&apos;urgent : aucune relance due, aucune candidature prête en attente.</p>
          ) : null}
        </Panel>

        <Panel aria-label="Par source" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Par source</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="text-left text-[12px] text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Collectées
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Doublons
                  </th>
                  <th scope="col" className="py-2 pl-2 text-right font-medium">
                    Qualifiées
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.sources.map((s) => (
                  <tr key={s.source} className="border-t border-border">
                    <th scope="row" className="py-2.5 pr-2 text-left font-medium">
                      Import manuel · {OFFER_SOURCE_LABELS[s.source]}
                    </th>
                    <td className="px-2 py-2.5 text-right tabular-nums">{s.collected}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{s.duplicates}</td>
                    <td className="py-2.5 pl-2 text-right tabular-nums">{s.qualified}</td>
                  </tr>
                ))}
                <tr className="border-t border-border text-muted-foreground">
                  <th scope="row" className="py-2.5 pr-2 text-left font-medium">
                    Connecteurs officiels (V2)
                  </th>
                  <td colSpan={3} className="py-2.5 pl-2 text-right font-mono text-[11px] uppercase tracking-[0.04em]">
                    Non connectés
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
