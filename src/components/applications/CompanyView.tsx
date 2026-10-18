import Link from "next/link";
import { STATUS_META } from "@/components/applications/labels";
import { OFFER_STATUS_LABELS } from "@/components/offers/status";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { companyOverview } from "@/modules/applications";

type Groups = Awaited<ReturnType<typeof companyOverview>>;

/** Par entreprise : toutes les offres (suivies ou non), l'état de chaque candidature et les contacts connus. */
export function CompanyView({ groups }: { groups: Groups }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g, i) => {
        const tracked = g.offers.filter((o) => o.applicationId);
        return (
          <Panel key={i} aria-label={g.company ?? "Entreprise non renseignée"} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">{g.company ?? "Entreprise non renseignée"}</h2>
              <span className="text-[13px] text-muted-foreground">
                {g.offers.length} offre{g.offers.length > 1 ? "s" : ""} · {tracked.length} candidature{tracked.length > 1 ? "s" : ""}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {g.offers.map((o) => (
                <li key={`${o.offerId}-${o.applicationId ?? "x"}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Link href={o.applicationId ? `/candidatures/${o.applicationId}` : `/offres/${o.offerId}`} className="min-w-0 flex-1 font-medium">
                    {o.title}
                  </Link>
                  {o.applicationStatus ? (
                    <StatusBadge tone={STATUS_META[o.applicationStatus].tone}>
                      {STATUS_META[o.applicationStatus].glyph} {STATUS_META[o.applicationStatus].label}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Offre · {OFFER_STATUS_LABELS[o.offerStatus].label}</StatusBadge>
                  )}
                </li>
              ))}
            </ul>
            {g.contacts.length ? (
              <p className="text-[13px] text-muted-foreground">
                Contacts : {g.contacts.map((c) => (c.role ? `${c.name} (${c.role})` : c.name)).join(", ")}
              </p>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}
