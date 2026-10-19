import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OfferAnalysisView } from "@/components/offers/OfferAnalysisView";
import { CompleteOfferPanel } from "@/components/offers/CompleteOfferPanel";
import { BOARD_LABELS, OFFER_SOURCE_LABELS, OFFER_STATUS_LABELS } from "@/components/offers/status";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { RequestMatchButton } from "@/components/matching/RequestMatchButton";
import { STATUS_META } from "@/components/applications/labels";
import { ActionButton } from "@/components/ui/ActionButton";
import { getCurrentAnalysis } from "@/modules/analysis";
import { getActiveApplication } from "@/modules/applications";
import { getCurrentMatch } from "@/modules/matching";
import { getOffer } from "@/modules/offers";
import { sightingsOf } from "@/modules/sources";
import { decideOfferAction, retryAnalysisAction } from "./actions";
import { createApplicationAction } from "../../candidatures/actions";

export const metadata: Metadata = { title: "Offre" };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const usd = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 3 });

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border bg-panel px-2.5 py-0.5 font-mono text-xs text-muted-foreground">{children}</span>;
}

export default async function OfferPage(props: PageProps<"/offres/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const db = getDb();
  const offer = await getOffer(db, user.id, id);
  if (!offer) notFound();
  const [current, match, application, sightings] = await Promise.all([
    getCurrentAnalysis(db, user.id, offer.id),
    getCurrentMatch(db, user.id, offer.id),
    getActiveApplication(db, user.id, offer.id),
    sightingsOf(db, user.id, offer.id),
  ]);
  // LinkedIn et Indeed interdisent la récupération automatique : le texte se colle.
  const host = URL.canParse(offer.originalUrl ?? "") ? new URL(offer.originalUrl!).hostname.toLowerCase() : "";
  const fetchAllowed = Boolean(host) && !/(^|\.)(linkedin\.com|indeed\.(com|fr))$/.test(host);
  const status = OFFER_STATUS_LABELS[offer.status];
  const decided = offer.status === "analyzed" || offer.status === "qualified" || offer.status === "discarded";

  return (
    <>
      <nav aria-label="Fil d'Ariane" className="flex flex-wrap gap-1.5 text-sm text-muted-foreground">
        <Link href="/offres" className="text-accent">
          Offres
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate">{offer.title}</span>
      </nav>
      <PageHeader
        title={offer.company ? `${offer.title} · ${offer.company}` : offer.title}
        actions={
          decided ? (
            <>
              {match ? (
                <Link
                  href={`/offres/${offer.id}/matching`}
                  className="inline-flex min-h-11 items-center rounded-lg border border-accent bg-accent-soft px-4 text-sm font-semibold text-foreground no-underline"
                >
                  {match.match.status === "done" && match.match.score !== null ? `Matching ${match.match.score}/100` : "Voir le matching"}
                </Link>
              ) : (
                <RequestMatchButton offerId={offer.id} />
              )}
              <ButtonLink href={`/offres/${offer.id}/cv`}>CV personnalisé</ButtonLink>
              {application ? (
                <ButtonLink href={`/candidatures/${application.id}`}>Candidature · {STATUS_META[application.status].label}</ButtonLink>
              ) : (
                <ActionButton action={createApplicationAction.bind(null, offer.id)} label="Suivre la candidature" pendingLabel="Création…" />
              )}
              {offer.status !== "discarded" ? (
                <form action={decideOfferAction.bind(null, offer.id, "discard")}>
                  <Button type="submit">Écarter l&apos;offre</Button>
                </form>
              ) : null}
              {offer.status !== "qualified" ? (
                <form action={decideOfferAction.bind(null, offer.id, "qualify")}>
                  <Button type="submit">Qualifier l&apos;offre</Button>
                </form>
              ) : null}
            </>
          ) : offer.status === "failed" ? (
            <form action={retryAnalysisAction.bind(null, offer.id)}>
              <Button type="submit" variant="primary">
                Relancer l&apos;analyse
              </Button>
            </form>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <Chip>{OFFER_SOURCE_LABELS[offer.source]}</Chip>
          {offer.location ? <Chip>{offer.location}</Chip> : null}
          {offer.publishedAt ? <Chip>Publiée le {dateFmt.format(offer.publishedAt)}</Chip> : null}
          <Chip>Importée le {dateFmt.format(offer.createdAt)}</Chip>
        </div>
        {sightings.length ? (
          <p className="pt-1 text-[13px] text-muted-foreground">
            Trouvée sur :{" "}
            {sightings.map((s, i) => (
              <span key={s.id}>
                {i ? ", " : ""}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                    {BOARD_LABELS[s.board] ?? s.board}
                  </a>
                ) : (
                  (BOARD_LABELS[s.board] ?? s.board)
                )}{" "}
                ({dateFmt.format(s.firstSeenAt)}
                {s.origin === "email_alert" ? ", alerte e-mail" : ""})
              </span>
            ))}
          </p>
        ) : null}
        {offer.originalUrl ? (
          <a href={offer.originalUrl} target="_blank" rel="noopener noreferrer nofollow" className="pt-1 text-sm font-semibold text-accent">
            Voir l&apos;annonce originale
          </a>
        ) : null}
      </PageHeader>

      {offer.status === "incomplete" ? <CompleteOfferPanel offerId={offer.id} url={offer.originalUrl} fetchAllowed={fetchAllowed} /> : null}

      {current ? (
        <OfferAnalysisView
          rawText={offer.rawText}
          notMentioned={current.analysis.notMentioned}
          meta={[
            `schéma v${current.analysis.schemaVersion}`,
            current.analysis.promptVersion,
            current.analysis.latencyMs ? `${Math.round(current.analysis.latencyMs / 1000)} s` : null,
            current.analysis.costUsd !== null ? usd.format(current.analysis.costUsd) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          requirements={current.requirements.map((r) => ({
            id: r.id,
            kind: r.kind,
            importance: r.importance,
            label: r.label,
            value: r.value,
            provenance: r.provenance,
            quote: r.quote,
            quoteStart: r.quoteStart,
            quoteEnd: r.quoteEnd,
            rationale: r.rationale,
            verificationNote: r.verificationNote,
            correctedByUser: r.correctedByUser,
          }))}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <Panel aria-labelledby="source-title" className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
            <h2 id="source-title" className="text-base font-semibold">
              Texte source
            </h2>
            <p className="rounded-md bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
              Contenu importé traité comme donnée non fiable : il est analysé, jamais exécuté comme une instruction.
            </p>
            <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{offer.rawText}</div>
          </Panel>
          <Panel aria-labelledby="analysis-title" className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
            <h2 id="analysis-title" className="text-base font-semibold">
              Analyse structurée
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {offer.statusReason ??
                (offer.status === "analyzing"
                  ? "Analyse en cours…"
                  : "L'analyse est en file d'attente. Elle démarre dès qu'un worker est actif et qu'un fournisseur IA est configuré.")}
            </p>
          </Panel>
        </div>
      )}
    </>
  );
}
