import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ApplicationRow } from "@/modules/applications";

type Item = { id: string; day: string; kind: "action" | "sent"; text: string; tone: "late" | "today" | "future" | "done" };

const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function shift(month: string, delta: number) {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

/**
 * Calendrier du mois : prochaines actions (relances, entretiens planifiés) et envois confirmés.
 * Grille au-dessus de 768 px, liste par jour en dessous.
 */
export function CalendarView({ rows, month, today, href }: { rows: ApplicationRow[]; month: string; today: string; href: (month: string) => string }) {
  const items: Item[] = [];
  for (const a of rows) {
    const who = `${a.company ? `${a.company} · ` : ""}${a.title}`;
    if (a.nextActionAt?.startsWith(month)) {
      const tone = a.nextActionAt < today ? "late" : a.nextActionAt === today ? "today" : "future";
      items.push({ id: a.id, day: a.nextActionAt, kind: "action", text: `${a.nextAction ?? "Action"} — ${who}`, tone });
    }
    if (a.sentAt?.startsWith(month)) items.push({ id: a.id, day: a.sentAt, kind: "sent", text: `Envoyée — ${who}`, tone: "done" });
  }
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const byDay = (d: string) => items.filter((i) => i.day === d);
  const tone = { late: "border-danger text-danger", today: "border-signal text-signal", future: "border-border text-foreground", done: "border-accent text-accent" };

  return (
    <section aria-label="Calendrier" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={href(shift(month, -1))} className="text-sm font-semibold">
          ← Mois précédent
        </Link>
        <h2 className="text-lg font-semibold capitalize">{monthFmt.format(first)}</h2>
        <Link href={href(shift(month, 1))} className="text-sm font-semibold">
          Mois suivant →
        </Link>
      </div>

      <div className="hidden flex-col gap-1.5 md:flex">
        <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
          {WEEKDAYS.map((d) => (
            <span key={d} className="px-1 text-[12px] font-medium text-muted-foreground">
              {d}
            </span>
          ))}
        </div>
        <ol className="grid grid-cols-7 gap-1.5">
          {cells.map((d, i) =>
            d ? (
              <li key={d} className={cn("flex min-h-24 flex-col gap-1 rounded-lg border border-border bg-panel p-1.5", d === today && "border-foreground")}>
                <span className={cn("text-[12px] tabular-nums", d === today ? "font-bold" : "text-muted-foreground")}>
                  <span className="sr-only">{dayFmt.format(new Date(`${d}T00:00:00Z`))}</span>
                  <span aria-hidden="true">{Number(d.slice(8))}</span>
                </span>
                {byDay(d).map((it, k) => (
                  <Link key={k} href={`/candidatures/${it.id}`} className={cn("rounded border px-1 py-0.5 text-[11px] leading-4 no-underline", tone[it.tone])}>
                    {it.tone === "late" ? "! " : it.kind === "sent" ? "→ " : ""}
                    {it.text}
                  </Link>
                ))}
              </li>
            ) : (
              <li key={`vide-${i}`} aria-hidden="true" />
            ),
          )}
        </ol>
      </div>

      <ol className="flex flex-col gap-3 md:hidden">
        {cells
          .filter((d): d is string => Boolean(d) && byDay(d as string).length > 0)
          .map((d) => (
            <li key={d} className="flex flex-col gap-1.5">
              <h3 className={cn("text-sm font-semibold first-letter:uppercase", d === today && "text-accent")}>{dayFmt.format(new Date(`${d}T00:00:00Z`))}</h3>
              {byDay(d).map((it, k) => (
                <Link key={k} href={`/candidatures/${it.id}`} className={cn("rounded-lg border bg-panel px-3 py-2 text-sm no-underline", tone[it.tone])}>
                  {it.tone === "late" ? "! En retard · " : it.kind === "sent" ? "→ " : ""}
                  {it.text}
                </Link>
              ))}
            </li>
          ))}
      </ol>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Aucune échéance ni aucun envoi ce mois-ci.</p> : null}
    </section>
  );
}
