import type { Metadata } from "next";
import Link from "next/link";
import { decideOfferAction } from "@/app/(app)/offres/[id]/actions";
import { OFFER_SOURCE_LABELS } from "@/components/offers/status";
import { ActionButton } from "@/components/ui/ActionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { listToTriage, triageCounts, type TriageItem } from "@/modules/matching";
import { requestMissingMatchesAction } from "./actions";

export const metadata: Metadata = { title: "À traiter" };

function Score({ match }: { match: TriageItem["match"] }) {
  if (!match) return <span className="text-sm text-muted-foreground">Pas de score</span>;
  if (match.status === "pending") return <span className="text-sm text-muted-foreground">Score en cours</span>;
  if (match.status === "failed" || match.score === null) return <span className="text-sm text-danger">Matching en échec</span>;
  const tone = match.score >= 70 ? "accent" : match.score >= 50 ? "signal" : undefined;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <StatusBadge tone={tone}>
        <span className="font-mono">{match.score}</span>
        <span className="sr-only"> sur 100</span>
        <span aria-hidden="true"> / 100</span>
      </StatusBadge>
      {match.mode === "rules_only" ? <span className="text-[12px] text-muted-foreground">règles seules</span> : null}
      {match.stale ? <span className="text-[12px] text-signal">profil modifié depuis</span> : null}
    </span>
  );
}

export default async function TriagePage() {
  const user = await requireUser();
  const db = getDb();
  const [items, counts] = await Promise.all([listToTriage(db, user.id), triageCounts(db, user.id)]);

  return (
    <>
      <PageHeader eyebrow="Offres" title="À traiter">
        <p className="max-w-prose text-[15px] leading-6 text-muted-foreground">
          Offres analysées sur lesquelles tu n&apos;as pas encore décidé, de la plus prometteuse à la moins prometteuse. Le score vient du matching avec ton profil
          maître validé, lancé dès l&apos;analyse ; ouvre l&apos;offre pour voir le détail exigence par exigence avant de décider.
        </p>
      </PageHeader>

      {!counts.hasProfile ? (
        <p role="status" className="rounded-lg border border-signal/40 bg-signal/10 px-3 py-2 text-sm">
          Aucun profil maître validé : les offres ne peuvent pas être classées. <Link href="/profil">Valider mon profil</Link>
        </p>
      ) : counts.unscored > 0 ? (
        <Panel aria-label="Scores à calculer" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {counts.unscored} offre{counts.unscored > 1 ? "s" : ""} sans score à jour (analysée{counts.unscored > 1 ? "s" : ""} avant la validation du profil, ou profil
            modifié depuis).
          </p>
          <ActionButton action={requestMissingMatchesAction} label="Calculer les scores" pendingLabel="Demande…" className="min-h-10 px-3" />
        </Panel>
      ) : null}

      {counts.incomplete > 0 ? (
        <p className="text-sm">
          {counts.incomplete} offre{counts.incomplete > 1 ? "s" : ""} attend{counts.incomplete > 1 ? "ent" : ""} son texte avant analyse :{" "}
          <Link href="/offres?statut=incomplete">compléter les offres</Link>
        </p>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="Rien à traiter">
          <p>Les offres apparaissent ici une fois analysées. Importe une offre, lance une recherche ou connecte une source.</p>
          <Link href="/recherche">Lancer une recherche</Link>
        </EmptyState>
      ) : (
        <section aria-labelledby="triage-title" className="flex flex-col gap-3">
          <h2 id="triage-title" className="text-lg font-semibold tracking-tight">
            {items.length} offre{items.length > 1 ? "s" : ""} à décider
          </h2>
          <ol className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.offerId} aria-labelledby={`offre-${item.offerId}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel p-3">
                <div className="w-24 shrink-0">
                  <Score match={item.match} />
                </div>
                <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
                  <Link id={`offre-${item.offerId}`} href={`/offres/${item.offerId}`} className="font-semibold text-foreground hover:text-accent">
                    {item.title}
                  </Link>
                  <span className="text-[13px] text-muted-foreground">{[item.company, item.location, OFFER_SOURCE_LABELS[item.source]].filter(Boolean).join(" · ")}</span>
                  {item.match?.status === "done" ? (
                    <Link href={`/offres/${item.offerId}/matching`} className="text-[13px]">
                      Détail du score
                    </Link>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={decideOfferAction.bind(null, item.offerId, "qualify")} label="Qualifier" variant="primary" className="min-h-10 px-3" />
                  <ActionButton action={decideOfferAction.bind(null, item.offerId, "discard")} label="Écarter" variant="ghost" className="min-h-10 px-3" />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
