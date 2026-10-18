"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { decideSuggestionAction, requestSuggestionsAction } from "@/app/(app)/offres/[id]/cv/actions";
import { MatchPoller } from "@/components/matching/MatchPoller";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { CvContent } from "@/modules/cv/content";
import { evidenceElements, type ProfileContent } from "@/modules/profile/content";
import { SUGGESTION_KIND_LABELS, SUGGESTION_STATE_META } from "./labels";

export type SuggestionView = {
  id: string;
  kind: keyof typeof SUGGESTION_KIND_LABELS;
  targetId: string | null;
  text: string | null;
  order: string[] | null;
  sourceIds: string[];
  rationale: string;
  covers: string | null;
  state: keyof typeof SUGGESTION_STATE_META;
  blockReason: string | null;
};

type Props = {
  offerId: string;
  cv: CvContent;
  profile: ProfileContent;
  suggestions: SuggestionView[];
  status: "none" | "queued" | "running" | "done" | "failed";
  reason: string | null;
  aiAvailable: boolean;
  /** Modifications non enregistrées : décider d'une suggestion les écraserait. */
  locked: boolean;
};

function labels(profile: ProfileContent) {
  const map = new Map(evidenceElements(profile).map((e) => [e.id, e.label]));
  for (const s of profile.skills) map.set(s.id, `Compétence ${s.name}`);
  return map;
}

function currentText(cv: CvContent, id: string | null): string | null {
  if (!id) return null;
  for (const e of cv.experiences) for (const i of e.items) if (i.sourceId === id) return i.text;
  return cv.projects.find((p) => p.sourceId === id)?.description ?? null;
}

function Card({ s, cv, names, locked }: { s: SuggestionView; cv: CvContent; names: Map<string, string>; locked: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const meta = SUGGESTION_STATE_META[s.state];
  const editable = s.kind === "rephrase" || s.kind === "summary";

  const decide = (decision: "accept" | "reject" | "undo", edited?: string) =>
    startTransition(async () => {
      setError(null);
      const r = await decideSuggestionAction({ suggestionId: s.id, decision, text: edited });
      if (r.error) setError(r.error);
      else setEditing(false);
    });

  const onKey = (e: React.KeyboardEvent) => {
    // Raccourcis A / R sur la suggestion active (pas pendant la saisie).
    if (e.target !== e.currentTarget || locked || pending) return;
    if (e.key.toLowerCase() === "a" && s.state === "pending") decide("accept");
    if (e.key.toLowerCase() === "r" && (s.state === "pending" || s.state === "blocked")) decide("reject");
  };

  const before = s.kind === "rephrase" && s.state === "pending" ? currentText(cv, s.targetId) : null;
  return (
    <li
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={`${SUGGESTION_KIND_LABELS[s.kind]} — ${meta.label}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 focus:outline-2 focus:outline-accent"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{SUGGESTION_KIND_LABELS[s.kind]}</span>
        <StatusBadge tone={meta.tone}>
          {meta.glyph} {meta.label}
        </StatusBadge>
      </div>
      {s.targetId && s.kind !== "summary" ? <p className="text-[13px] text-muted-foreground">{names.get(s.targetId) ?? "Élément du profil"}</p> : null}
      {before ? <p className="text-sm text-muted-foreground line-through">{before}</p> : null}
      {editing ? (
        <Textarea aria-label="Ta formulation" rows={3} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} />
      ) : s.text ? (
        <p className="text-sm leading-6">{s.text}</p>
      ) : null}
      {s.kind === "reorder_items" && s.order ? (
        <ol className="list-decimal pl-5 text-sm">
          {s.order.map((id) => (
            <li key={id}>{(currentText(cv, id) ?? names.get(id) ?? id).slice(0, 80)}</li>
          ))}
        </ol>
      ) : null}
      <p className="text-[13px] leading-5">
        <span className="font-semibold">Pourquoi : </span>
        {s.rationale}
        {s.covers ? <span className="text-accent"> · Couvre : {s.covers}</span> : null}
      </p>
      <p className="text-[12px] leading-5 text-muted-foreground">Sources : {s.sourceIds.map((id) => names.get(id) ?? id).join(" ; ")}</p>
      {s.state === "blocked" && s.blockReason ? (
        <p className="rounded-md border border-danger px-2 py-1.5 text-[13px] text-danger">Bloquée par le contrôle des faits : {s.blockReason}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {s.state === "pending" && !editing ? (
          <>
            <Button variant="primary" className="min-h-10 px-3" disabled={locked || pending} onClick={() => decide("accept")}>
              Accepter
            </Button>
            {editable ? (
              <Button className="min-h-10 px-3" disabled={locked || pending} onClick={() => setEditing(true)}>
                Modifier
              </Button>
            ) : null}
            <Button className="min-h-10 px-3" disabled={locked || pending} onClick={() => decide("reject")}>
              Refuser
            </Button>
          </>
        ) : null}
        {editing ? (
          <>
            <Button variant="primary" className="min-h-10 px-3" disabled={locked || pending || !text.trim()} onClick={() => decide("accept", text)}>
              Accepter ma version
            </Button>
            <Button className="min-h-10 px-3" disabled={pending} onClick={() => setEditing(false)}>
              Annuler
            </Button>
          </>
        ) : null}
        {s.state === "blocked" ? (
          <Button className="min-h-10 px-3" disabled={locked || pending} onClick={() => decide("reject")}>
            Écarter
          </Button>
        ) : null}
        {s.state === "accepted" || s.state === "edited" || s.state === "rejected" ? (
          <Button variant="ghost" className="min-h-10 px-3" disabled={locked || pending} onClick={() => decide("undo")}>
            Annuler la décision
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Suggestions sourcées du modèle, filtrées par le garde-fou. Chaque décision est enregistrée et annulable. */
export function SuggestionsPanel({ offerId, cv, profile, suggestions, status, reason, aiAvailable, locked }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const names = labels(profile);
  const working = status === "queued" || status === "running";
  const ask = () =>
    startTransition(async () => {
      setError(null);
      const r = await requestSuggestionsAction(offerId);
      if (r.error) setError(r.error);
    });

  return (
    <Panel aria-label="Suggestions" className="flex flex-col gap-3 self-start xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Suggestions</h2>
        {aiAvailable ? (
          <Button className="min-h-10 px-3" onClick={ask} disabled={pending || working || locked}>
            {working ? "En cours…" : suggestions.length ? "Nouvelles suggestions" : "Proposer des suggestions"}
          </Button>
        ) : null}
      </div>
      {!aiAvailable ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          Aucun fournisseur IA n&apos;est autorisé à recevoir ton CV : les suggestions sont désactivées. Tu peux adapter le CV toi-même, ou autoriser un fournisseur (modèle local
          recommandé) dans <Link href="/reglages/ia">les réglages IA</Link>.
        </p>
      ) : null}
      {working ? (
        <p role="status" className="text-sm text-muted-foreground">
          <MatchPoller />
          {reason ?? "Le modèle prépare des suggestions à partir de ton profil maître…"}
        </p>
      ) : reason ? (
        <p role="status" className={status === "failed" ? "text-sm text-danger" : "text-[13px] text-muted-foreground"}>
          {reason}
        </p>
      ) : null}
      {locked ? <p className="text-[13px] text-signal">Enregistre tes modifications pour décider des suggestions.</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {suggestions.length ? (
        <ul className="flex flex-col gap-3">
          {suggestions.map((s) => (
            <Card key={`${s.id}-${s.state}`} s={s} cv={cv} names={names} locked={locked} />
          ))}
        </ul>
      ) : status === "done" ? (
        <p className="text-sm text-muted-foreground">Aucune suggestion retenue : ton CV couvre déjà ce que le profil permet d&apos;affirmer.</p>
      ) : null}
      <p className="text-[12px] leading-5 text-muted-foreground">
        Une suggestion sans élément du profil pour l&apos;appuyer n&apos;est jamais affichée ; celle qui ajouterait un chiffre ou un mot-clé absent de la source est bloquée.
        Raccourcis : A accepter, R refuser la suggestion sélectionnée.
      </p>
    </Panel>
  );
}
