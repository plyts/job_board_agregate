"use client";

import { useActionState } from "react";
import { updateWeightsAction, type WeightsState } from "@/app/(app)/offres/[id]/matching/actions";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Field";
import type { Weights } from "@/modules/matching/score";
import { FACTOR_LABELS } from "./labels";

export function WeightsForm({ matchId, weights }: { matchId: string; weights: Weights }) {
  const [state, action, pending] = useActionState<WeightsState, FormData>(updateWeightsAction.bind(null, matchId), {});
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-accent">Configurer les poids</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(FACTOR_LABELS) as (keyof Weights)[]).map((f) => (
            <Label key={f}>
              {FACTOR_LABELS[f]}
              <Input name={f} type="number" min={0} max={100} defaultValue={weights[f]} required />
            </Label>
          ))}
        </div>
        <FieldError>{state.error}</FieldError>
        <Button type="submit" disabled={pending} className="self-start">
          Recalculer le score
        </Button>
        <p className="text-xs text-muted-foreground">Le recalcul utilise les catégories déjà établies : aucun nouvel appel au modèle.</p>
      </form>
    </details>
  );
}
