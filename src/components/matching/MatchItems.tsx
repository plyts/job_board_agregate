"use client";

import { useState } from "react";
import { KIND_LABELS } from "@/components/offers/labels";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import type { MatchCategory } from "@/modules/matching/score";
import { CATEGORY_META } from "./labels";

export type MatchItemView = {
  id: string;
  category: MatchCategory;
  label: string;
  kind: string;
  importance: string;
  evidence: { id: string; label: string; text: string }[];
  rationale: string;
  action: string;
  source: "rule" | "model" | "guard";
};

const IMPORTANCE = { mandatory: "Obligatoire", preferred: "Souhaitée", condition: "Condition" } as Record<string, string>;
const SOURCE = { rule: "Calcul", model: "Jugement IA", guard: "Jugement IA corrigé" } as const;

export function MatchItems({ items }: { items: MatchItemView[] }) {
  const [filter, setFilter] = useState<MatchCategory | "all">("all");
  const counts = new Map<MatchCategory, number>();
  for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  const visible = items.filter((i) => filter === "all" || i.category === filter);
  const tabs: [MatchCategory | "all", string, number][] = [
    ["all", "Toutes", items.length],
    ...(Object.keys(CATEGORY_META) as MatchCategory[]).filter((c) => counts.has(c)).map((c): [MatchCategory, string, number] => [c, CATEGORY_META[c].label, counts.get(c)!]),
  ];
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Filtrer par catégorie" className="flex flex-wrap gap-1.5">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-[13px]",
              filter === id ? "border-foreground bg-foreground font-semibold text-background" : "border-border bg-panel text-foreground hover:bg-muted",
            )}
          >
            {label} <span className="font-mono text-xs">{n}</span>
          </button>
        ))}
      </div>
      <ul className="flex flex-col">
        {visible.map((i) => {
          const meta = CATEGORY_META[i.category];
          return (
            <li key={i.id} className="grid gap-4 border-t border-muted py-3.5 md:grid-cols-[minmax(180px,1.1fr)_minmax(220px,1.6fr)_minmax(180px,1fr)]">
              <div className="flex flex-col gap-1.5">
                <span className="text-[15px] font-semibold">{i.label}</span>
                <span className="text-xs text-muted-foreground">
                  {IMPORTANCE[i.importance]} · {KIND_LABELS[i.kind] ?? i.kind}
                </span>
                <StatusBadge tone={meta.tone} className="self-start">
                  <span aria-hidden="true">{meta.glyph}</span> {meta.label}
                </StatusBadge>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {i.evidence.length ? `Preuve · ${i.evidence.map((e) => e.label).join(" · ")}` : "Aucune preuve"} · {SOURCE[i.source]}
                </span>
                {i.evidence.slice(0, 2).map((e) => (
                  <blockquote key={e.id} className="rounded-md bg-background px-3 py-2 text-sm leading-5">
                    {e.text}
                  </blockquote>
                ))}
                <span className="text-xs text-muted-foreground">{i.rationale}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Action proposée</span>
                <span className="text-sm leading-5">{i.action}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
