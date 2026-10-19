import type { Metadata } from "next";
import { ScrollArea } from "@/components/ui/ScrollArea";
import Link from "next/link";
import { ImportPanel } from "@/components/offers/ImportPanel";
import { OFFER_SOURCE_LABELS, OFFER_STATUS_LABELS } from "@/components/offers/status";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { triageCounts } from "@/modules/matching";
import { listOffers, OFFER_ORIGINS, OFFER_STATUSES, type OfferOrigin, type OfferStatus } from "@/modules/offers";

export const metadata: Metadata = { title: "Offres" };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });

export default async function OffersPage(props: PageProps<"/offres">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const status = typeof sp.statut === "string" && (OFFER_STATUSES as readonly string[]).includes(sp.statut) ? (sp.statut as OfferStatus) : undefined;
  const origin = typeof sp.origine === "string" && (OFFER_ORIGINS as readonly string[]).includes(sp.origine) ? (sp.origine as OfferOrigin) : undefined;
  const [offers, triage] = await Promise.all([listOffers(getDb(), user.id, { q, status, origin }), triageCounts(getDb(), user.id)]);
  const filtered = Boolean(q || status || origin);

  return (
    <>
      <PageHeader eyebrow="Offres" title="Offres" />
      <ImportPanel />

      <section aria-labelledby="list-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="list-title" className="flex-1 text-lg font-semibold tracking-tight">
            Toutes les offres <span className="font-mono text-sm font-normal text-muted-foreground">{offers.length}</span>
          </h2>
          {triage.toDecide ? (
            <Link href="/offres/a-traiter" className="text-sm font-semibold">
              À traiter, par score ({triage.toDecide})
            </Link>
          ) : null}
        </div>
        <form method="get" role="search" className="flex flex-wrap gap-3 rounded-xl border border-border bg-panel p-3">
          <label className="min-w-0 flex-[1_1_240px]">
            <span className="sr-only">Rechercher par poste, entreprise ou lieu</span>
            <Input name="q" type="search" defaultValue={q} placeholder="Poste, entreprise, lieu…" />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Statut
            <select name="statut" defaultValue={status ?? ""} className="min-h-11 rounded-lg border border-border bg-panel px-2 text-sm text-foreground">
              <option value="">Tous</option>
              {OFFER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {OFFER_STATUS_LABELS[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Origine
            <select name="origine" defaultValue={origin ?? ""} className="min-h-11 rounded-lg border border-border bg-panel px-2 text-sm text-foreground">
              <option value="">Toutes</option>
              {OFFER_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {OFFER_SOURCE_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded-lg border border-border bg-panel px-4 text-sm font-semibold hover:bg-muted">
            Filtrer
          </button>
          {filtered ? (
            <Link href="/offres" className="flex min-h-11 items-center px-2 text-sm font-semibold text-accent">
              Réinitialiser
            </Link>
          ) : null}
        </form>

        {offers.length === 0 ? (
          <EmptyState title={filtered ? "Aucune offre ne correspond à ces filtres" : "Aucune offre pour l'instant"}>
            {filtered ? <p>Modifie ou réinitialise les filtres.</p> : <p>Importe ta première offre par URL, texte collé ou fichier.</p>}
          </EmptyState>
        ) : (
          <ScrollArea label="Liste des offres" className="rounded-xl border border-border bg-panel">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-background text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">Poste</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Lieu</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Source</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Importée</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Analyse</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className="border-t border-muted">
                    <td className="px-4 py-2.5">
                      <Link href={`/offres/${o.id}`} className="font-semibold text-foreground hover:text-accent">
                        {o.title}
                      </Link>
                      {o.company ? <div className="text-[13px] text-muted-foreground">{o.company}</div> : null}
                    </td>
                    <td className="px-2 py-2.5">{o.location ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-2.5 text-muted-foreground">{OFFER_SOURCE_LABELS[o.source]}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">{dateFmt.format(o.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge tone={OFFER_STATUS_LABELS[o.status].tone}>{OFFER_STATUS_LABELS[o.status].label}</StatusBadge>
                      {o.statusReason ? <div className="pt-1 text-xs text-muted-foreground">{o.statusReason}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </section>
    </>
  );
}
