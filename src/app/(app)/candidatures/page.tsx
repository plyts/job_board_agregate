import type { Metadata } from "next";
import { ScrollArea } from "@/components/ui/ScrollArea";
import Link from "next/link";
import { CalendarView } from "@/components/applications/CalendarView";
import { CompanyView } from "@/components/applications/CompanyView";
import { BoardColumnsForm } from "@/components/applications/BoardColumnsForm";
import { KanbanBoard, type CardView, type ColumnView } from "@/components/applications/KanbanBoard";
import { STATUS_META } from "@/components/applications/labels";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { cn } from "@/lib/cn";
import { APPLICATION_STATUSES, CHANNELS, CLOSED, companyOverview, getColumnSettings, isOverdue, listApplications, localDate, type ApplicationRow, type Channel } from "@/modules/applications";
import { Glyph } from "@/components/ui/Glyph";

export const metadata: Metadata = { title: "Candidatures" };

const day = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const fmt = (d: string | null) => (d ? day.format(new Date(`${d}T00:00:00Z`)) : null);

type Params = { vue?: string; q?: string; retard?: string; score?: string; sansaction?: string; tri?: string; mois?: string };

const SORTS = {
  echeance: (a: ApplicationRow, b: ApplicationRow) => (a.nextActionAt ?? "9999").localeCompare(b.nextActionAt ?? "9999"),
  score: (a: ApplicationRow, b: ApplicationRow) => (b.matchScore ?? -1) - (a.matchScore ?? -1),
  statut: (a: ApplicationRow, b: ApplicationRow) => APPLICATION_STATUSES.indexOf(a.status) - APPLICATION_STATUSES.indexOf(b.status),
  envoi: (a: ApplicationRow, b: ApplicationRow) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""),
} as const;

function href(params: Params, patch: Partial<Params>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const s = next.toString();
  return s ? `/candidatures?${s}` : "/candidatures";
}

export default async function ApplicationsPage(props: PageProps<"/candidatures">) {
  const user = await requireUser();
  const raw = await props.searchParams;
  const params: Params = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Params;
  const [all, settings] = await Promise.all([listApplications(getDb(), user.id), getColumnSettings(getDb(), user.id)]);
  const columns: ColumnView[] = settings.map((c) => ({ status: c.status, label: c.label ?? STATUS_META[c.status].label, hidden: c.hidden }));
  const labelOf = new Map(columns.map((c) => [c.status, c.label]));
  const today = localDate();
  const q = params.q?.trim().toLowerCase() ?? "";
  const rows = all.filter((a) => {
    if (q && !`${a.title} ${a.company ?? ""} ${a.location ?? ""}`.toLowerCase().includes(q)) return false;
    if (params.retard && !isOverdue(a.nextActionAt, today)) return false;
    if (params.score && (a.matchScore ?? 0) < 60) return false;
    if (params.sansaction && (a.nextAction || CLOSED.has(a.status))) return false;
    return true;
  });
  const table = params.vue === "tableau";
  const active = all.filter((a) => !CLOSED.has(a.status)).length;
  const overdue = all.filter((a) => isOverdue(a.nextActionAt, today)).length;

  const chip = (key: "retard" | "score" | "sansaction", label: string) => (
    <Link
      href={href(params, { [key]: params[key] ? undefined : "1" })}
      className={cn(
        "inline-flex min-h-10 items-center rounded-full border px-3 text-[13px] no-underline",
        params[key] ? "border-foreground bg-foreground text-background" : "border-border bg-panel text-foreground",
      )}
    >
      {label}
      {params[key] ? <span className="sr-only"> (filtre actif, cliquer pour le retirer)</span> : null}
    </Link>
  );

  const cards: CardView[] = rows.map((a) => ({
    id: a.id,
    status: a.status,
    title: a.title,
    company: a.company,
    location: a.location,
    score: a.matchScore,
    nextAction: a.nextAction,
    nextActionLabel: a.nextActionAt ? `le ${fmt(a.nextActionAt)}` : null,
    overdue: isOverdue(a.nextActionAt, today),
    sent: a.sentAt !== null,
  }));

  return (
    <>
      <PageHeader
        eyebrow={`Suivi · ${active} candidature${active > 1 ? "s" : ""} active${active > 1 ? "s" : ""}${overdue ? ` · ${overdue} en retard` : ""}`}
        title="Candidatures"
        actions={
          <div role="group" aria-label="Vue" className="flex flex-wrap gap-1 rounded-lg border border-border bg-panel p-1">
            {[
              ["kanban", "Kanban"],
              ["tableau", "Tableau"],
              ["calendrier", "Calendrier"],
              ["entreprise", "Par entreprise"],
            ].map(([id, label]) => {
              const on = (params.vue ?? "kanban") === id;
              return (
                <Link
                  key={id}
                  href={href(params, { vue: id === "kanban" ? undefined : id })}
                  aria-current={on ? "page" : undefined}
                  className={cn("inline-flex min-h-9 items-center rounded-md px-3 text-sm no-underline", on ? "bg-foreground font-semibold text-background" : "text-foreground")}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        }
      />

      {all.length === 0 ? (
        <EmptyState title="Aucune candidature">
          <p>Ouvre une offre analysée et choisis « Suivre la candidature » : elle apparaîtra ici, dans la colonne qui correspond à son état réel.</p>
          <ButtonLink href="/offres" variant="primary">
            Voir les offres
          </ButtonLink>
        </EmptyState>
      ) : (
        <>
          <form action="/candidatures" className="flex flex-wrap items-center gap-2.5">
            {params.vue ? <input type="hidden" name="vue" value={params.vue} /> : null}
            <label className="flex min-h-10 flex-1 basis-64 items-center gap-2 rounded-lg border border-border bg-panel px-3 md:max-w-sm">
              <span className="sr-only">Filtrer les candidatures</span>
              <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Entreprise, poste, lieu…" className="w-full bg-transparent text-sm outline-none" />
            </label>
            {chip("retard", "Relance en retard")}
            {chip("score", "Score ≥ 60")}
            {chip("sansaction", "Sans prochaine action")}
            <span className="text-[13px] text-muted-foreground">
              {rows.length} / {all.length} affichée{all.length > 1 ? "s" : ""}
            </span>
          </form>

          {params.vue === "calendrier" ? (
            <CalendarView
              rows={rows}
              month={/^\d{4}-\d{2}$/.test(params.mois ?? "") ? params.mois! : today.slice(0, 7)}
              today={today}
              href={(m) => href(params, { mois: m })}
            />
          ) : params.vue === "entreprise" ? (
            <CompanyView groups={(await companyOverview(getDb(), user.id)).filter((g) => !q || (g.company ?? "").toLowerCase().includes(q) || g.offers.some((o) => o.title.toLowerCase().includes(q)))} />
          ) : table ? (
            <ScrollArea label="Tableau des candidatures" className="rounded-xl border border-border bg-panel">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Poste</th>
                    <th className="px-4 py-2.5 font-medium">
                      <Link href={href(params, { tri: "statut" })}>Statut</Link>
                    </th>
                    <th className="px-4 py-2.5 font-medium">
                      <Link href={href(params, { tri: "score" })}>Score</Link>
                    </th>
                    <th className="px-4 py-2.5 font-medium">
                      <Link href={href(params, { tri: "envoi" })}>Envoyée le</Link>
                    </th>
                    <th className="px-4 py-2.5 font-medium">
                      <Link href={href(params, { tri: undefined })}>Prochaine action</Link>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort(SORTS[(params.tri as keyof typeof SORTS) ?? "echeance"] ?? SORTS.echeance).map((a) => {
                    const meta = STATUS_META[a.status];
                    const late = isOverdue(a.nextActionAt, today);
                    return (
                      <tr key={a.id} className="border-t border-border align-top">
                        <td className="px-4 py-3">
                          <Link href={`/candidatures/${a.id}`} className="font-semibold text-foreground">
                            {a.title}
                          </Link>
                          <div className="text-[13px] text-muted-foreground">{[a.company, a.location].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={meta.tone}>
                            <Glyph>{meta.glyph}</Glyph> {labelOf.get(a.status) ?? meta.label}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums">{a.matchScore ?? "—"}</td>
                        <td className="px-4 py-3">
                          {fmt(a.sentAt) ?? "—"}
                          {a.channel ? <div className="text-[12px] text-muted-foreground">{CHANNELS[a.channel as Channel] ?? a.channel}</div> : null}
                        </td>
                        <td className={cn("px-4 py-3", late && "font-semibold text-danger")}>
                          {a.nextAction ? (
                            <>
                              {late ? (
                                <>
                                  <Glyph>! </Glyph>
                                  <span className="sr-only">En retard : </span>
                                </>
                              ) : null}
                              {`${a.nextAction}${a.nextActionAt ? ` · ${fmt(a.nextActionAt)}` : ""}`}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          ) : (
            <>
              <KanbanBoard cards={cards} columns={columns} />
              <details className="rounded-xl border border-border bg-muted/40 p-3">
                <summary className="cursor-pointer text-sm font-semibold">Personnaliser les colonnes</summary>
                <div className="pt-3">
                  <BoardColumnsForm settings={settings} />
                </div>
              </details>
            </>
          )}
          <p className="text-[13px] text-muted-foreground">
            Une même entreprise peut avoir plusieurs candidatures ; une même offre n&apos;a qu&apos;une candidature active. « Envoyée » n&apos;est atteinte que par la confirmation d&apos;envoi, sur la fiche.
          </p>
        </>
      )}
    </>
  );
}
