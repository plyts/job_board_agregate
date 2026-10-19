import type { Metadata } from "next";
import Link from "next/link";
import { SearchForm, type SearchCriteria } from "@/components/sources/SearchForm";
import { SearchResults } from "@/components/sources/SearchResults";
import { ActionButton } from "@/components/ui/ActionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { CONTRACTS, getSearchRun, listSavedSearches, listSources } from "@/modules/sources";
import { deleteSavedSearchAction, runSavedSearchNowAction, setSavedSearchActiveAction } from "./actions";

export const metadata: Metadata = { title: "Recherche" };

const stamp = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: process.env.APP_TIME_ZONE ?? "Europe/Paris" });

export default async function SearchPage(props: PageProps<"/recherche">) {
  const user = await requireUser();
  const db = getDb();
  const { run: runId } = await props.searchParams;
  const [sources, saved, run] = await Promise.all([listSources(db, user.id), listSavedSearches(db, user.id), typeof runId === "string" ? getSearchRun(db, user.id, runId) : null]);
  const searchable = sources.filter((s) => s.kind !== "email_alerts" && s.state === "active");
  const labels = new Map(sources.map((s) => [s.id, s.label]));
  const q = (run?.query ?? {}) as Partial<{ keywords: string; location: string | null; radiusKm: number | null; publishedWithinDays: number | null; contracts: string[] }>;
  const initial: SearchCriteria = {
    keywords: q.keywords ?? "",
    location: q.location ?? "",
    radiusKm: q.radiusKm ? String(q.radiusKm) : "",
    publishedWithinDays: String(q.publishedWithinDays ?? 7),
    contracts: q.contracts ?? [],
    sourceIds: [],
  };

  return (
    <>
      <PageHeader eyebrow="Travail" title="Recherche">
        <p className="max-w-prose text-[15px] leading-6 text-muted-foreground">
          Une seule recherche sur toutes tes sources connectées : France Travail, Adzuna et les pages carrières suivies. La même annonce vue à plusieurs endroits
          n&apos;apparaît qu&apos;une fois. Les alertes e-mail (LinkedIn, Indeed, Welcome to the Jungle…) arrivent d&apos;elles-mêmes dans tes offres.
        </p>
      </PageHeader>

      {searchable.length === 0 ? (
        <EmptyState title="Aucune source interrogeable">
          <p>Connecte France Travail, Adzuna ou une page carrières pour lancer une recherche combinée.</p>
          <Link href="/sources">Connecter une source</Link>
        </EmptyState>
      ) : (
        <Panel aria-label="Critères" className="flex flex-col gap-3">
          <SearchForm key={run?.id ?? "nouvelle"} sources={searchable.map((s) => ({ id: s.id, label: s.label }))} initial={initial} />
        </Panel>
      )}

      {run ? (
        <Panel aria-label="Résultats" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {run.results?.length ?? 0} résultat{(run.results?.length ?? 0) > 1 ? "s" : ""}
            </h2>
            <span className="text-[13px] text-muted-foreground">
              {stamp.format(run.startedAt)} · {run.fetched} offre{run.fetched > 1 ? "s" : ""} reçue{run.fetched > 1 ? "s" : ""} avant fusion des doublons
            </span>
          </div>
          {run.errors.length ? (
            <ul role="status" className="flex flex-col gap-1 text-sm text-danger">
              {run.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {run.results?.length ? <SearchResults runId={run.id} items={run.results} /> : <p className="text-sm text-muted-foreground">Aucune offre ne correspond. Élargis les mots-clés, le lieu ou la période.</p>}
        </Panel>
      ) : null}

      <Panel aria-label="Recherches enregistrées" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Recherches enregistrées</h2>
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune. Enregistre une recherche : le worker la relance et importe les nouvelles offres.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {saved.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{s.name}</span>
                  {s.active ? <StatusBadge tone="accent">Active</StatusBadge> : <StatusBadge>En pause</StatusBadge>}
                </div>
                <span className="text-[13px] text-muted-foreground">
                  « {s.keywords} »{s.location ? ` · ${s.location}${s.radiusKm ? ` (${s.radiusKm} km)` : ""}` : ""}
                  {s.contracts.length ? ` · ${s.contracts.map((c) => CONTRACTS[c as keyof typeof CONTRACTS] ?? c).join(", ")}` : ""} · publiées depuis {s.publishedWithinDays} j · toutes les{" "}
                  {s.intervalHours} h · {s.maxPerRun} offres au plus par passage
                  {s.sourceIds.length ? ` · ${s.sourceIds.map((id) => labels.get(id) ?? "source supprimée").join(", ")}` : " · toutes les sources"}
                </span>
                <span className="text-[13px]">
                  {s.lastRun
                    ? `Dernier passage ${stamp.format(s.lastRun.startedAt)} : ${s.lastRun.created} nouvelle${s.lastRun.created > 1 ? "s" : ""}, ${s.lastRun.duplicates} déjà connue${s.lastRun.duplicates > 1 ? "s" : ""}${s.lastRun.errors.length ? ` · ${s.lastRun.errors.join(" ; ")}` : ""}`
                    : "Pas encore lancée : premier passage au prochain quart d'heure."}
                </span>
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={runSavedSearchNowAction.bind(null, s.id)} label="Lancer maintenant" className="min-h-10 px-3" />
                  <ActionButton action={setSavedSearchActiveAction.bind(null, s.id, !s.active)} label={s.active ? "Mettre en pause" : "Reprendre"} className="min-h-10 px-3" />
                  <ActionButton action={deleteSavedSearchAction.bind(null, s.id)} label="Supprimer" variant="ghost" className="min-h-10 px-3" confirm={`Supprimer la recherche « ${s.name} » ? Les offres importées restent.`} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
