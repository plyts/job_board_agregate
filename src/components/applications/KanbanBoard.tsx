"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { moveApplicationAction } from "@/app/(app)/candidatures/actions";
import { cn } from "@/lib/cn";
import { APPLICATION_STATUSES, moveRefusal, type ApplicationStatus } from "@/modules/applications/rules";
import { STATUS_META } from "./labels";

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

function scoreTone(score: number | null) {
  if (score === null) return "text-muted-foreground";
  return score >= 75 ? "text-accent" : score >= 55 ? "text-signal" : "text-muted-foreground";
}

/**
 * Kanban des 12 étapes. Déplacement à la souris (glisser-déposer) ou au clavier (← → sur une carte sélectionnée) ;
 * chaque déplacement est vérifié par le serveur et journalisé.
 */
export function KanbanBoard({ cards }: { cards: CardView[] }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, ApplicationStatus>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<ApplicationStatus | null>(null);
  const [, startTransition] = useTransition();
  const board = useRef<HTMLDivElement>(null);

  const view = cards.map((c) => ({ ...c, status: overrides[c.id] ?? c.status }));

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
    setOverrides((o) => ({ ...o, [card.id]: to }));
    setAnnounce(`« ${card.title} » déplacée vers ${STATUS_META[to].label}.`);
    startTransition(async () => {
      const r = await moveApplicationAction({ id: card.id, to });
      if (r.error) setAlert(r.error);
      // Succès ou échec, l'état serveur fait foi.
      setOverrides((o) => {
        const next = { ...o };
        delete next[card.id];
        return next;
      });
    });
  };

  const onKey = (e: React.KeyboardEvent, card: CardView) => {
    if (e.target !== e.currentTarget) return;
    const i = APPLICATION_STATUSES.indexOf(card.status);
    if (e.key === "ArrowRight" && i < APPLICATION_STATUSES.length - 1) {
      e.preventDefault();
      move(card, APPLICATION_STATUSES[i + 1]!);
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      move(card, APPLICATION_STATUSES[i - 1]!);
    } else if (e.key === "Enter") {
      router.push(`/candidatures/${card.id}`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p id="kanban-aide" className="text-[13px] text-muted-foreground">
        Déplacer : glisser-déposer, ou sélectionner une carte (Tab) puis ← →. Entrée ouvre la fiche. Sur téléphone, change l&apos;étape depuis la fiche.
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
        {APPLICATION_STATUSES.map((status, ci) => {
          const list = view.filter((c) => c.status === status);
          const meta = STATUS_META[status];
          // Colonne vide repliée en bande verticale (toujours zone de dépôt) : les 12 étapes tiennent à l'écran.
          const collapsed = list.length === 0 && dragOver !== status;
          return (
            <section
              key={status}
              aria-label={meta.label}
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
                <h2 className={cn("flex-1 text-sm font-semibold", collapsed && "font-medium whitespace-nowrap text-muted-foreground md:[writing-mode:vertical-rl]")}>{meta.label}</h2>
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
                    aria-label={`${c.title}${c.company ? `, ${c.company}` : ""} — ${meta.label}`}
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
                    {c.nextAction ? (
                      <span className={cn("text-xs", c.overdue ? "font-semibold text-danger" : "text-muted-foreground")}>
                        {c.overdue ? "! En retard · " : ""}
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
