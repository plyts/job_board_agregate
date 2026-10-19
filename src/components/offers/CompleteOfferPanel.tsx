"use client";

import Link from "next/link";
import { useActionState } from "react";
import { completeOfferAction, fetchOfferAction, type CompleteState } from "@/app/(app)/offres/[id]/actions";
import { ActionButton } from "@/components/ui/ActionButton";
import { Button } from "@/components/ui/Button";
import { Label, Textarea } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";

/** Offre connue par un extrait (alerte, agrégateur) : coller le texte complet, ou récupérer la page si le site l'autorise. */
export function CompleteOfferPanel({ offerId, url, fetchAllowed }: { offerId: string; url: string | null; fetchAllowed: boolean }) {
  const [state, action, pending] = useActionState<CompleteState, FormData>(completeOfferAction.bind(null, offerId), {});
  return (
    <Panel aria-label="Compléter l'offre" className="flex flex-col gap-3 border-signal">
      <h2 className="text-lg font-semibold tracking-tight">Texte complet de l&apos;annonce</h2>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        Cette offre est arrivée avec un extrait. L&apos;analyse et le matching ont besoin du texte complet :{" "}
        {fetchAllowed
          ? "récupère la page (seulement si le site l'autorise), ou colle le texte."
          : "les conditions de ce site interdisent la récupération automatique, ouvre l'annonce et colle son texte."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm font-semibold">
            Ouvrir l&apos;annonce
          </a>
        ) : null}
        {fetchAllowed && url ? <ActionButton action={fetchOfferAction.bind(null, offerId)} label="Récupérer la page" pendingLabel="Récupération…" className="min-h-10 px-3" /> : null}
      </div>
      <form action={action} className="flex flex-col gap-2">
        <Label>
          Texte de l&apos;annonce
          <Textarea name="text" rows={8} required maxLength={60_000} placeholder="Colle ici l'intégralité de l'annonce" />
        </Label>
        <Button type="submit" variant="primary" disabled={pending} className="self-start">
          {pending ? "Enregistrement…" : "Enregistrer et analyser"}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error} {state.duplicateOf ? <Link href={`/offres/${state.duplicateOf}`}>Voir cette offre</Link> : null}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}
