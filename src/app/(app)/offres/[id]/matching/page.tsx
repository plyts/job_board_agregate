import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_META, FACTOR_LABELS } from "@/components/matching/labels";
import { MatchItems } from "@/components/matching/MatchItems";
import { MatchPoller } from "@/components/matching/MatchPoller";
import { RequestMatchButton } from "@/components/matching/RequestMatchButton";
import { WeightsForm } from "@/components/matching/WeightsForm";
import { KIND_LABELS } from "@/components/offers/labels";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getCurrentAnalysis } from "@/modules/analysis";
import { getCurrentMatch } from "@/modules/matching";
import { getOffer } from "@/modules/offers";
import { getCurrentProfile } from "@/modules/profile";

export const metadata: Metadata = { title: "Matching" };

export default async function MatchingPage(props: PageProps<"/offres/[id]/matching">) {
  const user = await requireUser();
  const { id } = await props.params;
  const db = getDb();
  const offer = await getOffer(db, user.id, id);
  if (!offer) notFound();
  const [current, analysis, profile] = await Promise.all([getCurrentMatch(db, user.id, offer.id), getCurrentAnalysis(db, user.id, offer.id), getCurrentProfile(db, user.id)]);
  const title = offer.company ? `${offer.title} · ${offer.company}` : offer.title;

  const crumbs = (
    <nav aria-label="Fil d'Ariane" className="flex flex-wrap gap-1.5 text-sm text-muted-foreground">
      <Link href="/offres" className="text-accent">
        Offres
      </Link>
      <span aria-hidden="true">/</span>
      <Link href={`/offres/${offer.id}`} className="text-accent">
        {title}
      </Link>
      <span aria-hidden="true">/</span>
      <span>Matching</span>
    </nav>
  );

  if (!current) {
    return (
      <>
        {crumbs}
        <PageHeader eyebrow="Matching" title="Pourquoi cette offre te correspond" actions={<RequestMatchButton offerId={offer.id} />} />
        <EmptyState title="Aucun matching pour cette offre">
          <p>Lance la comparaison avec ton profil maître validé.</p>
        </EmptyState>
      </>
    );
  }

  const { match, items } = current;
  const stale = profile && current.profileVersion !== null && profile.version > current.profileVersion;
  const view = items.map(({ item, requirement }) => ({
    id: item.id,
    category: item.category,
    label: requirement.label,
    // Valeurs figées au moment du matching.
    kind: item.kind,
    importance: item.importance,
    evidence: item.evidence,
    rationale: item.rationale,
    action: item.action,
    source: item.source,
  }));
  const matches = view.filter((i) => i.category === "confirmed");
  const reducers = view.filter((i) => ["partial", "not_demonstrated", "potential_incompatibility"].includes(i.category));
  const unknown = view.filter((i) => i.category === "to_confirm");
  const notMentioned = analysis?.analysis.notMentioned ?? [];

  return (
    <>
      {crumbs}
      <PageHeader
        eyebrow={`Matching · profil maître v${current.profileVersion ?? "?"} × offre`}
        title="Pourquoi cette offre te correspond"
        actions={match.status !== "pending" ? <RequestMatchButton offerId={offer.id} label="Relancer le matching" /> : null}
      />

      {match.status === "pending" ? (
        <Panel role="status" className="flex flex-col gap-2">
          <MatchPoller />
          <h2 className="text-base font-semibold">Comparaison en cours…</h2>
          <p className="text-sm text-muted-foreground">{match.statusReason ?? "Le résultat s'affichera ici automatiquement. Le worker doit être actif."}</p>
        </Panel>
      ) : null}
      {match.status === "failed" ? (
        <p role="alert" className="rounded-lg border border-danger bg-panel px-4 py-3 text-sm">
          {match.statusReason}
        </p>
      ) : null}
      {stale ? (
        <p role="status" className="rounded-lg border border-signal bg-panel px-4 py-3 text-sm">
          Ton profil maître est passé en version {profile.version} depuis ce matching : relance-le pour en tenir compte.
        </p>
      ) : null}
      {match.mode === "rules_only" ? (
        <p role="status" className="rounded-lg border border-signal bg-panel px-4 py-3 text-sm">
          Matching partiel : seuls les calculs déterministes (années d&apos;expérience, critères d&apos;exclusion) ont été faits, car aucun fournisseur IA n&apos;est autorisé à recevoir ton profil. Les autres exigences sont « à confirmer ».
        </p>
      ) : null}

      {match.status === "done" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel aria-label="Score de compatibilité" className="flex flex-col gap-3.5">
              <h2 className="text-sm font-semibold text-muted-foreground">Score de compatibilité</h2>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold tracking-tight">{match.score ?? "—"}</span>
                <span className="text-muted-foreground">/ 100</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {match.factors
                  .filter((f) => f.value !== null)
                  .map((f) => (
                    <div key={f.factor} className="flex flex-col gap-1">
                      <div className="flex justify-between text-[13px]">
                        <span>
                          {FACTOR_LABELS[f.factor as keyof typeof FACTOR_LABELS]} <span className="text-muted-foreground">· poids {f.weight}</span>
                        </span>
                        <span className="font-semibold tabular-nums">
                          {f.points} / {f.maxPoints}
                        </span>
                      </div>
                      <div role="img" aria-label={`${f.points} sur ${f.maxPoints}`} className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-1.5 bg-accent" style={{ width: `${f.maxPoints ? (f.points / f.maxPoints) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
              </div>
              <WeightsForm matchId={match.id} weights={match.weights} />
            </Panel>
            <Panel aria-label="En résumé" className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground">En résumé</h2>
              <div className="flex flex-col gap-1">
                <h3 className="text-[15px] font-semibold text-accent">Ce qui correspond</h3>
                <p className="text-sm leading-6">{matches.length ? matches.map((m) => m.label).join(", ") : "Aucune exigence confirmée."}</p>
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-[15px] font-semibold text-signal">Ce qui réduit le score</h3>
                <p className="text-sm leading-6">
                  {reducers.length ? reducers.map((r) => `${r.label} (${CATEGORY_META[r.category].label.toLowerCase()})`).join(", ") : "Rien de notable."}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-[15px] font-semibold text-muted-foreground">Ce qui est inconnu</h3>
                <p className="text-sm leading-6">
                  {`${[...unknown.map((u) => u.label), ...notMentioned.map((k) => `${(KIND_LABELS[k] ?? k).toLowerCase()} (non mentionné)`)].join(", ") || "Rien"}.`}{" "}
                  Inconnu ne veut pas dire lacune.
                </p>
              </div>
            </Panel>
          </div>
          <Panel aria-label="Exigence par exigence" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Exigence par exigence</h2>
            <MatchItems items={view} />
            <p className="text-[13px] leading-5 text-muted-foreground">
              Un mot-clé présent dans le CV ne vaut pas preuve : sans expérience, projet ou certification liée, l&apos;exigence est « à confirmer » ou « partielle ».
            </p>
          </Panel>
        </>
      ) : null}
    </>
  );
}
