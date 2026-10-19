"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { importResultsAction } from "@/app/(app)/recherche/actions";
import { BOARD_LABELS } from "@/components/offers/status";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { SearchResultItem } from "@/db/schema";

// Fuseau explicite : le serveur (UTC) et le navigateur affichent le même jour.
const day = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" });

function excerpt(item: SearchResultItem): string {
  const lines = item.offer.text.split("\n").filter((l) => l.trim() && l.trim() !== item.offer.title);
  const text = lines.join(" ");
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

/** Résultats fusionnés d'une recherche : sélection, import, offres déjà connues signalées. */
export function SearchResults({ runId, items }: { runId: string; items: SearchResultItem[] }) {
  const importable = items.map((it, i) => (it.existingOfferId ? -1 : i)).filter((i) => i >= 0);
  const [selected, setSelected] = useState<number[]>([]);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; ok?: string }>({});
  const all = selected.length === importable.length && importable.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="min-h-10 px-3" disabled={!importable.length} onClick={() => setSelected(all ? [] : importable)}>
          {all ? "Tout désélectionner" : "Tout sélectionner"}
        </Button>
        <Button
          variant="primary"
          className="min-h-10 px-3"
          disabled={pending || selected.length === 0}
          onClick={() =>
            startTransition(async () => {
              setResult(await importResultsAction(runId, selected));
              setSelected([]);
            })
          }
        >
          {pending ? "Import…" : `Importer la sélection (${selected.length})`}
        </Button>
        {result.error ? (
          <span role="alert" className="text-sm text-danger">
            {result.error}
          </span>
        ) : result.ok ? (
          <span role="status" className="text-sm text-accent">
            {result.ok}
          </span>
        ) : null}
      </div>
      <ol className="flex flex-col gap-2">
        {items.map((item, i) => {
          const o = item.offer;
          const id = `resultat-${i}`;
          return (
            <li key={i} aria-labelledby={id} className="flex gap-3 rounded-lg border border-border bg-panel p-3">
              <input
                type="checkbox"
                aria-labelledby={id}
                disabled={Boolean(item.existingOfferId)}
                checked={selected.includes(i)}
                onChange={() => setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))}
                className="mt-1 size-4 shrink-0"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span id={id} className="font-semibold">
                    {o.title}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {item.boards.map((b) => (
                      <StatusBadge key={b}>{BOARD_LABELS[b] ?? b}</StatusBadge>
                    ))}
                  </span>
                </div>
                <span className="text-[13px] text-muted-foreground">
                  {[o.company, o.location, o.publishedAt ? `publiée le ${day.format(new Date(o.publishedAt))}` : null].filter(Boolean).join(" · ")}
                </span>
                <p className="text-[13px] leading-5">{excerpt(item)}</p>
                <span className="flex flex-wrap items-center gap-3 text-[13px]">
                  {o.complete ? <span className="text-accent">Texte complet</span> : <span className="text-signal">Extrait : texte à compléter après import</span>}
                  {o.url ? (
                    <a href={o.url} rel="noopener noreferrer">
                      Annonce d&apos;origine
                    </a>
                  ) : null}
                  {item.existingOfferId ? <Link href={`/offres/${item.existingOfferId}`}>Déjà dans tes offres</Link> : null}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
