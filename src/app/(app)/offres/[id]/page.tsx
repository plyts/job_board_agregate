import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OFFER_SOURCE_LABELS, OFFER_STATUS_LABELS } from "@/components/offers/status";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getOffer } from "@/modules/offers";

export const metadata: Metadata = { title: "Offre" };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border bg-panel px-2.5 py-0.5 font-mono text-xs text-muted-foreground">{children}</span>;
}

export default async function OfferPage(props: PageProps<"/offres/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const offer = await getOffer(getDb(), user.id, id);
  if (!offer) notFound();
  const status = OFFER_STATUS_LABELS[offer.status];

  return (
    <>
      <nav aria-label="Fil d'Ariane" className="flex flex-wrap gap-1.5 text-sm text-muted-foreground">
        <Link href="/offres" className="text-accent">
          Offres
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate">{offer.title}</span>
      </nav>
      <PageHeader title={offer.company ? `${offer.title} · ${offer.company}` : offer.title}>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <Chip>{OFFER_SOURCE_LABELS[offer.source]}</Chip>
          {offer.location ? <Chip>{offer.location}</Chip> : null}
          {offer.publishedAt ? <Chip>Publiée le {dateFmt.format(offer.publishedAt)}</Chip> : null}
          <Chip>Importée le {dateFmt.format(offer.createdAt)}</Chip>
        </div>
        {offer.originalUrl ? (
          <a href={offer.originalUrl} target="_blank" rel="noopener noreferrer nofollow" className="pt-1 text-sm font-semibold text-accent">
            Voir l&apos;annonce originale
          </a>
        ) : null}
      </PageHeader>

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
          {offer.status === "queued" ? (
            <p className="text-sm leading-6 text-muted-foreground">
              L&apos;analyse est en file d&apos;attente. Elle démarre dès qu&apos;un worker est actif et qu&apos;une clé IA est configurée.
            </p>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">{offer.statusReason ?? status.label}</p>
          )}
        </Panel>
      </div>
    </>
  );
}
