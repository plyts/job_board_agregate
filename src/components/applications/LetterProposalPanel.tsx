"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { decideLetterProposalAction, requestLetterDraftAction } from "@/app/(app)/candidatures/actions";
import { MatchPoller } from "@/components/matching/MatchPoller";
import { Button } from "@/components/ui/Button";
import type { LetterProposal } from "@/modules/applications";

const KIND_LABELS = { opening: "Accroche", body: "Ce que j'apporte", closing: "Conclusion" } as const;

type Props = {
  id: string;
  status: "none" | "queued" | "running" | "done" | "failed";
  reason: string | null;
  proposal: LetterProposal | null;
  aiAvailable: boolean;
  /** La lettre actuelle n'est pas vide : la reprise la remplace, après confirmation. */
  hasLetter: boolean;
  labels: Record<string, string>;
};

/** Proposition de lettre par l'IA : sourcée, contrôlée ; l'utilisateur la reprend dans sa lettre ou l'écarte. */
export function LetterProposalPanel({ id, status, reason, proposal, aiAvailable, hasLetter, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const working = status === "queued" || status === "running";
  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
    });
  const usable = proposal?.paragraphs.filter((p) => p.issues.length === 0).length ?? 0;

  return (
    <section aria-label="Proposition de lettre" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Proposition de l&apos;IA</h3>
        {aiAvailable ? (
          <Button className="min-h-10 px-3" disabled={pending || working} onClick={() => run(() => requestLetterDraftAction(id))}>
            {working ? "En cours…" : proposal ? "Nouvelle proposition" : "Proposer une lettre"}
          </Button>
        ) : null}
      </div>
      {!aiAvailable ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          Aucun fournisseur IA n&apos;est autorisé et consenti pour recevoir ton profil (masqué) : la proposition de lettre est désactivée. Configure un modèle
          local (recommandé) ou donne ton consentement à un fournisseur dans <Link href="/reglages/confidentialite">Confidentialité</Link>.
        </p>
      ) : null}
      {/* Une seule région d'état, toujours présente : l'arrivée de la proposition est annoncée au lecteur d'écran. */}
      <p role="status" className={status === "failed" ? "text-sm text-danger" : "text-sm text-muted-foreground"}>
        {working ? (
          <>
            <MatchPoller />
            {reason ?? "Le modèle rédige une proposition à partir de ton profil maître…"}
          </>
        ) : status === "failed" && reason ? (
          reason
        ) : proposal ? (
          <span className="sr-only">
            Proposition prête : {proposal.paragraphs.length} paragraphe{proposal.paragraphs.length > 1 ? "s" : ""}, dont {proposal.paragraphs.length - usable} non repris.
          </span>
        ) : null}
      </p>
      {proposal ? (
        <>
          <ol className="flex flex-col gap-2.5">
            {proposal.paragraphs.map((p, i) => (
              <li
                key={i}
                aria-label={`${KIND_LABELS[p.kind]}${p.issues.length ? " — non reprise" : ""}`}
                className={p.issues.length ? "rounded-md border border-danger p-2.5" : "rounded-md border border-border p-2.5"}
              >
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{KIND_LABELS[p.kind]}</span>
                <p className="pt-1 text-sm leading-6">{p.text}</p>
                {p.sourceIds.length ? (
                  <p className="text-[12px] leading-5 text-muted-foreground">Sources : {p.sourceIds.map((s) => labels[s] ?? "Élément du profil").join(" ; ")}</p>
                ) : null}
                {p.covers.length ? <p className="text-[12px] leading-5 text-accent">Couvre : {p.covers.join(", ")}</p> : null}
                {p.issues.length ? <p className="pt-1 text-[13px] text-danger">Non reprise : {p.issues.join(" ")}</p> : null}
              </li>
            ))}
          </ol>
          {proposal.dropped ? (
            <p className="text-[12px] text-muted-foreground">
              {proposal.dropped} paragraphe{proposal.dropped > 1 ? "s" : ""} sans élément du profil pour l&apos;appuyer, écarté{proposal.dropped > 1 ? "s" : ""}.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              className="min-h-10 px-3"
              disabled={pending || usable === 0}
              onClick={() => {
                if (hasLetter && !window.confirm("Remplacer ta lettre actuelle par la proposition ? Les paragraphes signalés ne sont pas repris.")) return;
                run(() => decideLetterProposalAction(id, "accept"));
              }}
            >
              Reprendre dans ma lettre
            </Button>
            <Button className="min-h-10 px-3" disabled={pending} onClick={() => run(() => decideLetterProposalAction(id, "discard"))}>
              Écarter
            </Button>
          </div>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <p className="text-[12px] leading-5 text-muted-foreground">
        Chaque paragraphe cite les éléments de ton profil maître qui l&apos;appuient ; un chiffre ou un mot-clé de l&apos;offre sans preuve le fait écarter. Relis et
        personnalise la lettre avant l&apos;envoi : le contrôle des faits s&apos;applique toujours.
      </p>
    </section>
  );
}
