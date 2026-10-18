"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { moveApplicationAction } from "@/app/(app)/candidatures/actions";
import { cn } from "@/lib/cn";
import { adjacentStatus, moveRefusal, type ApplicationStatus } from "@/modules/applications/rules";
import { STATUS_META } from "./labels";
import { Glyph } from "@/components/ui/Glyph";

export type CardView = {
  id: string;
  status: ApplicationStatus;
  title: string;
  company: string | null;
  location: string | null;
  score: number | null;
  nextAction: string | null;
  nextActionLabel: string | null;
  overdue: boolean;
  sent: boolean;
};

/** Colonne telle que réglée par l'utilisateur : nom affiché (personnalisé ou par défaut) et masquage. */
export type ColumnView = { status: ApplicationStatus; label: string; hidden: boolean };

/** Nom annoncé par un lecteur d'écran : tout ce que la carte montre (score, prochaine action, retard), pas seulement le titre. */
function cardName(c: CardView, column: string): string {
  const score = c.score === null ? "" : ` · score ${c.score} sur 100`;
  const action = c.nextAction ? ` · ${c.overdue ? "en retard : " : "prochaine action : "}${c.nextAction}${c.nextActionLabel ? ` ${c.nextActionLabel}` : ""}` : "";
  return `${c.title}${c.company ? `, ${c.company}` : ""} — ${column}${score}${action}`;
}

function scoreTone(score: number | null) {
  if (score === null) return "text-muted-foreground";
  return score >= 75 ? "text-accent" : score >= 55 ? "text-signal" : "text-muted-foreground";
}

/**
 * Kanban des 12 étapes. Déplacement à la souris (glisser-déposer) ou au clavier (← → sur une carte sélectionnée) ;
 * chaque déplacement est vérifié par le serveur et journalisé. Une colonne masquée n'est affichée que si elle
 * contient des cartes ; le clavier et le sélecteur mobile sautent les colonnes non affichées.
 */
export function KanbanBoard({ cards, columns }: { cards: CardView[]; columns: ColumnView[] }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, ApplicationStatus>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<ApplicationStatus | null>(null);
  const [, startTransition] = useTransition();
  const board = useRef<HTMLDivElement>(null);
  // Déplacements d'une même carte envoyés l'un après l'autre, dans l'ordre des gestes.
  const queues = useRef<Record<string, Promise<void>>>({});

  // État optimiste : la colonne demandée l'emporte jusqu'à ce que le serveur la confirme ou la refuse.
  const view = cards.map((c) => ({ ...c, status: overrides[c.id] ?? c.status }));
  const labelOf = (s: ApplicationStatus) => columns.find((c) => c.status === s)?.label ?? STATUS_META[s].label;
  const shown = (s: ApplicationStatus) => !columns.find((c) => c.status === s)?.hidden || view.some((c) => c.status === s);

  useEffect(() => {
    if (!focusId) return;
    board.current?.querySelector<HTMLElement>(`[data-card="${focusId}"]`)?.focus();
  }, [focusId, overrides, cards]);

  const move = (card: CardView, to: ApplicationStatus) => {
    if (card.status === to) return;
    const refusal = moveRefusal(to, card.sent);
    setFocusId(card.id);
    if (refusal) {
      setAlert(refusal);
      return;
    }
    setAlert(null);
    setOverrides((o) => {
      // Les colonnes déjà confirmées par le serveur n'ont plus besoin d'état optimiste.
      const next = Object.fromEntries(Object.entries(o).filter(([id, s]) => cards.find((c) => c.id === id)?.status !== s));
      return { ...next, [card.id]: to };
    });
    const previous = queues.current[card.id] ?? Promise.resolve();
    const run = previous.then(async () => {
      const r = await moveApplicationAction({ id: card.id, to });
      if (r.error) {
        setAlert(r.error);
        // Refus du serveur : la carte reprend la colonne enregistrée.
        setOverrides((o) => {
          const next = { ...o };
          if (next[card.id] === to) delete next[card.id];
          return next;
        });
      } else {
        setAnnounce(`« ${card.title} » déplacée vers ${labelOf(to)}.`);
      }
    });
    queues.current[card.id] = run;
    startTransition(() => run);
  };

  const onKey = (e: React.KeyboardEvent, card: CardView) => {
    if (e.target !== e.currentTarget) return;
    const to = e.key === "ArrowRight" ? adjacentStatus(card.status, 1, shown) : e.key === "ArrowLeft" ? adjacentStatus(card.status, -1, shown) : null;
    if (to) {
      e.preventDefault();
      move(card, to);
    } else if (e.key === "Enter") {
      router.push(`/candidatures/${card.id}`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p id="kanban-aide" className="text-[13px] text-muted-foreground">
        Déplacer : glisser-déposer, ou sélectionner une carte (Tab) puis ← →. Entrée ouvre la fiche. Sur téléphone : choisis l&apos;étape dans la carte.
      </p>
      {alert ? (
        <p role="alert" className="rounded-lg border border-danger bg-panel px-4 py-2.5 text-sm text-danger">
          {alert}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div ref={board} className="flex flex-col gap-3 md:flex-row md:items-start md:overflow-x-auto md:pb-3">
        {columns.map(({ status, label, hidden }, ci) => {
          const list = view.filter((c) => c.status === status);
          if (hidden && list.length === 0) return null;
          // Colonne vide repliée en bande verticale (toujours zone de dépôt) : les 12 étapes tiennent à l'écran.
          const collapsed = list.length === 0 && dragOver !== status;
          return (
            <section
              key={status}
              aria-label={label}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(status);
              }}
              onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const card = view.find((c) => c.id === e.dataTransfer.getData("text/plain"));
                if (card) move(card, status);
              }}
              className={cn(
                "flex shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2.5",
                collapsed ? "py-2 md:min-h-64 md:w-11 md:px-1" : "md:w-62",
                status === "ready" && "bg-accent-soft/60",
                dragOver === status && "outline-2 outline-accent",
              )}
            >
              <div className={cn("flex items-center gap-2 px-1", !collapsed && "pb-1", collapsed && "md:flex-col md:px-0")}>
                <span className="font-mono text-[11px] text-muted-foreground">{String(ci + 1).padStart(2, "0")}</span>
                <h2 className={cn("flex-1 text-sm font-semibold", collapsed && "font-medium whitespace-nowrap text-muted-foreground md:[writing-mode:vertical-rl]")}>{label}</h2>
                {hidden ? <span className="text-[11px] text-muted-foreground">masquée</span> : null}
                <span className="font-mono text-xs text-muted-foreground">{list.length}</span>
              </div>
              <ul className={cn("flex flex-col gap-2", list.length === 0 && "hidden")}>
                {list.map((c) => (
                  <li
                    key={c.id}
                    data-card={c.id}
                    tabIndex={0}
                    draggable
                    aria-describedby="kanban-aide"
                    aria-label={cardName(c, label)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onKeyDown={(e) => onKey(e, c)}
                    className="flex cursor-grab flex-col gap-2 rounded-lg border border-border bg-panel p-3 focus:outline-2 focus:outline-accent"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/candidatures/${c.id}`} tabIndex={-1} className="text-sm font-semibold leading-5 text-foreground no-underline hover:underline">
                        {c.title}
                      </Link>
                      <span className={cn("whitespace-nowrap font-mono text-xs font-medium", scoreTone(c.score))}>{c.score === null ? "—" : `${c.score}/100`}</span>
                    </div>
                    <span className="text-[13px] text-muted-foreground">{[c.company, c.location].filter(Boolean).join(" · ") || "Entreprise non renseignée"}</span>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground md:hidden">
                      Étape
                      <select
                        value={c.status}
                        onChange={(e) => move(c, e.target.value as ApplicationStatus)}
                        className="min-h-10 flex-1 rounded-md border border-border bg-panel px-2 text-sm text-foreground"
                      >
                        {columns
                          .filter((o) => o.status === c.status || shown(o.status))
                          .map((o) => (
                            <option key={o.status} value={o.status}>
                              {o.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    {c.nextAction ? (
                      <span className={cn("text-xs", c.overdue ? "font-semibold text-danger" : "text-muted-foreground")}>
                        {c.overdue ? (
                          <>
                            <Glyph>! </Glyph>En retard ·{" "}
                          </>
                        ) : null}
                        {c.nextAction}
                        {c.nextActionLabel ? ` · ${c.nextActionLabel}` : ""}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
