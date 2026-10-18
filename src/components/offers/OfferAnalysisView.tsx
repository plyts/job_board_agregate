"use client";

import { useActionState, useState } from "react";
import { correctRequirementAction, removeRequirementAction, type CorrectionState } from "@/app/(app)/offres/[id]/actions";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import { IMPORTANCE_GROUPS, KIND_LABELS, PROVENANCE } from "./labels";

export type RequirementView = {
  id: string;
  kind: string;
  importance: "mandatory" | "preferred" | "condition";
  label: string;
  value: string | null;
  provenance: "explicit" | "inferred" | "uncertain";
  quote: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
  rationale: string | null;
  verificationNote: string | null;
  correctedByUser: boolean;
};

function SourceText({ text, selected }: { text: string; selected: RequirementView | null }) {
  if (!selected || selected.quoteStart === null || selected.quoteEnd === null) {
    return <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{text}</div>;
  }
  return (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
      {text.slice(0, selected.quoteStart)}
      <mark className="rounded-sm bg-accent-soft text-foreground shadow-[0_0_0_2px_var(--accent)]">{text.slice(selected.quoteStart, selected.quoteEnd)}</mark>
      {text.slice(selected.quoteEnd)}
    </div>
  );
}

function CorrectionForm({ req, onDone }: { req: RequirementView; onDone: () => void }) {
  const [state, action, pending] = useActionState<CorrectionState, FormData>(async (prev, fd) => {
    const next = await correctRequirementAction(req.id, prev, fd);
    if (next.saved) onDone();
    return next;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <Label>
        Intitulé
        <Input name="label" defaultValue={req.label} required maxLength={200} />
      </Label>
      <Label>
        Précision
        <Input name="value" defaultValue={req.value ?? ""} maxLength={300} />
      </Label>
      <Label>
        Importance
        <select name="importance" defaultValue={req.importance} className="min-h-11 rounded-lg border border-border bg-panel px-2 text-sm">
          <option value="mandatory">Obligatoire</option>
          <option value="preferred">Souhaitée</option>
          <option value="condition">Condition</option>
        </select>
      </Label>
      <FieldError>{state.error}</FieldError>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          Enregistrer
        </Button>
        <Button onClick={onDone}>Annuler</Button>
      </div>
    </form>
  );
}

function RequirementItem({ req, selected, onSelect }: { req: RequirementView; selected: boolean; onSelect: () => void }) {
  const [editing, setEditing] = useState(false);
  const prov = PROVENANCE[req.provenance]!;
  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border p-3", selected ? "border-accent bg-accent-soft/40" : "border-transparent")}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex w-full items-start gap-3 text-left">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">
            {req.label}
            {req.correctedByUser ? <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">corrigé</span> : null}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {KIND_LABELS[req.kind] ?? req.kind}
            {req.value ? ` · ${req.value}` : ""}
          </span>
        </span>
        <StatusBadge tone={prov.tone}>{prov.label}</StatusBadge>
      </button>
      {selected ? (
        <div className="flex flex-col gap-2 pl-0.5 text-[13px] leading-5">
          {req.quote ? <blockquote className="rounded-md bg-background px-3 py-2">« {req.quote} »</blockquote> : null}
          {req.rationale ? <p className="text-muted-foreground">Justification : {req.rationale}</p> : null}
          {req.verificationNote ? <p className="text-signal">{req.verificationNote}</p> : null}
          {editing ? (
            <CorrectionForm req={req} onDone={() => setEditing(false)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setEditing(true)} className="min-h-9 px-3">
                Corriger
              </Button>
              <form action={removeRequirementAction.bind(null, req.id)}>
                <Button type="submit" variant="ghost" className="min-h-9 px-3">
                  Retirer (pas une exigence)
                </Button>
              </form>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function OfferAnalysisView({
  rawText,
  requirements,
  notMentioned,
  meta,
}: {
  rawText: string;
  requirements: RequirementView[];
  notMentioned: string[];
  meta: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = requirements.find((r) => r.id === selectedId) ?? null;
  const counts = { explicit: 0, inferred: 0, uncertain: 0 };
  for (const r of requirements) counts[r.provenance]++;

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-panel px-4 py-2.5 text-[13px] text-muted-foreground">
        <span>
          <strong className="text-foreground">{requirements.length}</strong> éléments extraits
        </span>
        <span>
          <strong className="text-foreground">{counts.explicit}</strong> explicites
        </span>
        <span>
          <strong className="text-foreground">{counts.inferred}</strong> déduits
        </span>
        <span>
          <strong className="text-signal">{counts.uncertain}</strong> incertains à vérifier
        </span>
        <span className="flex-1" />
        <span className="font-mono text-xs">{meta}</span>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Panel aria-labelledby="source-title" className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="source-title" className="text-base font-semibold">
              Texte source
            </h2>
            <span className="text-xs text-muted-foreground">Sélectionne un élément pour voir son extrait</span>
          </div>
          <p className="rounded-md bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
            Contenu importé traité comme donnée non fiable : il est analysé, jamais exécuté comme une instruction.
          </p>
          <SourceText text={rawText} selected={selected} />
        </Panel>

        <section aria-label="Analyse structurée" className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
          {IMPORTANCE_GROUPS.map((group) => {
            const items = requirements.filter((r) => r.importance === group.id);
            if (items.length === 0) return null;
            return (
              <Panel key={group.id} aria-label={group.title} className="flex flex-col gap-1 px-4 py-4">
                <h3 className="mb-1 px-1 text-base font-semibold">{group.title}</h3>
                <ul className="flex flex-col gap-1">
                  {items.map((r) => (
                    <RequirementItem key={r.id} req={r} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id === selectedId ? null : r.id)} />
                  ))}
                </ul>
              </Panel>
            );
          })}
          {notMentioned.length > 0 ? (
            <p className="text-[13px] leading-5 text-muted-foreground">
              Non mentionné dans l&apos;annonce (jamais estimé) : {notMentioned.map((k) => KIND_LABELS[k]?.toLowerCase() ?? k).join(", ")}.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}
