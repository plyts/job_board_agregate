import type { Metadata } from "next";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AdzunaForm, CareerPageForm, EmailAlertsForm, FranceTravailForm } from "@/components/sources/SourceForms";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { secretsConfigured } from "@/modules/platform";
import { BOARDS, CAREER_PROVIDERS, listSources, recentRuns } from "@/modules/sources";
import { removeSourceAction, setSourceActiveAction, syncMailboxNowAction } from "./actions";

export const metadata: Metadata = { title: "Sources" };

const stamp = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: process.env.APP_TIME_ZONE ?? "Europe/Paris" });

type Source = Awaited<ReturnType<typeof listSources>>[number];

function Status({ source }: { source: Source | undefined }) {
  if (!source) return <StatusBadge>Non connectée</StatusBadge>;
  return (
    <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      {source.state === "paused" ? <StatusBadge>En pause</StatusBadge> : source.state === "error" || source.lastError ? <StatusBadge tone="danger">Erreur</StatusBadge> : <StatusBadge tone="accent">Connectée</StatusBadge>}
      {source.lastSyncAt ? <span>Dernière synchronisation : {stamp.format(source.lastSyncAt)}</span> : <span>Jamais synchronisée</span>}
    </span>
  );
}

function Controls({ source }: { source: Source }) {
  return (
    <div className="flex flex-col gap-2">
      {source.lastError ? (
        <p role="status" className="text-sm text-danger">
          {source.lastError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          action={setSourceActiveAction.bind(null, source.id, source.state === "paused")}
          label={source.state === "paused" ? "Reprendre" : "Mettre en pause"}
          className="min-h-10 px-3"
        />
        <ActionButton action={removeSourceAction.bind(null, source.id)} label="Déconnecter" variant="ghost" className="min-h-10 px-3" confirm={`Déconnecter « ${source.label} » ? Ses identifiants sont effacés ; les offres déjà importées restent.`} />
      </div>
    </div>
  );
}

const HOW_TO: Record<string, string> = {
  linkedin: "Emplois › recherche › « Activer l'alerte ». Les alertes partent vers l'e-mail du compte : crée une règle de transfert automatique vers la boîte dédiée.",
  indeed: "Recherche › « Recevoir les nouvelles offres par e-mail », avec l'adresse de la boîte dédiée.",
  wttj: "Recherche › « Créer une alerte » (compte avec l'adresse de la boîte dédiée, ou transfert automatique).",
  hellowork: "Recherche › « Créer une alerte e-mail » avec l'adresse de la boîte dédiée.",
  cadremploi: "Recherche › « Créer une alerte » (compte avec la boîte dédiée, ou transfert automatique).",
  meteojob: "Espace candidat › « Alertes » avec l'adresse de la boîte dédiée.",
  jobteaser: "Offres › « Créer une alerte » : alertes vers l'e-mail du compte, transfert automatique vers la boîte dédiée.",
  apec: "Recherche › « Créer une alerte » (compte avec la boîte dédiée, ou transfert automatique).",
  france_travail: "Inutile si l'API France Travail est connectée ; sinon « Créer une alerte » depuis une recherche.",
};

export default async function SourcesPage() {
  const user = await requireUser();
  const db = getDb();
  const [sources, runs] = await Promise.all([listSources(db, user.id), recentRuns(db, user.id, 15)]);
  const ft = sources.find((s) => s.kind === "france_travail");
  const adzuna = sources.find((s) => s.kind === "adzuna");
  const mailbox = sources.find((s) => s.kind === "email_alerts");
  const pages = sources.filter((s) => s.kind === "career_page");
  const byId = new Map(sources.map((s) => [s.id, s.label]));
  const mailConfig = mailbox?.config as { host?: string; port?: number; secure?: boolean; user?: string; folder?: string; autoFetch?: boolean } | undefined;

  return (
    <>
      <PageHeader eyebrow="Travail" title="Sources">
        <p className="max-w-prose text-[15px] leading-6 text-muted-foreground">
          JobPilot interroge les API officielles et les pages carrières, et lit les alertes e-mail de tes jobboards dans une boîte dédiée. Il ne te demande jamais tes
          mots de passe LinkedIn, Indeed ou autres : leurs conditions interdisent la collecte automatique, et ces mots de passe n&apos;ont rien à faire ici.
        </p>
      </PageHeader>

      {!secretsConfigured() ? (
        <p role="alert" className="rounded-lg border border-danger bg-panel px-4 py-3 text-sm">
          Les identifiants des sources sont chiffrés avec <code className="font-mono">JOBPILOT_SECRETS_KEY</code>, absente de l&apos;environnement : génère-la avec{" "}
          <code className="font-mono">openssl rand -base64 32</code>, ajoute-la au fichier <code className="font-mono">.env</code>, puis redémarre.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel aria-label="France Travail" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">France Travail</h2>
            <Status source={ft} />
          </div>
          <p className="text-[13px] leading-5 text-muted-foreground">
            API officielle « Offres d&apos;emploi v2 », gratuite : crée une application sur francetravail.io, abonne-la à cette API, puis colle ses identifiants. Les
            offres arrivent avec leur texte complet.
          </p>
          {ft ? <Controls source={ft} /> : null}
          <FranceTravailForm connected={Boolean(ft)} />
        </Panel>

        <Panel aria-label="Adzuna" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Adzuna</h2>
            <Status source={adzuna} />
          </div>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Agrégateur d&apos;offres : clé gratuite sur developer.adzuna.com, quotas bas. Adzuna ne fournit qu&apos;un extrait : l&apos;offre arrive « à compléter ».
          </p>
          {adzuna ? <Controls source={adzuna} /> : null}
          <AdzunaForm connected={Boolean(adzuna)} />
        </Panel>
      </div>

      <Panel aria-label="Pages carrières" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Pages carrières</h2>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Suis les entreprises qui t&apos;intéressent, quand leur page carrières passe par {Object.values(CAREER_PROVIDERS).join(", ")} : leurs offres publiques sont lues
          sans identifiant et filtrées par tes recherches.
        </p>
        {pages.length ? (
          <ul className="flex flex-col gap-2">
            {pages.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a href={String(p.config.url ?? "#")} className="font-semibold">
                    {p.label}
                  </a>
                  <Status source={p} />
                </div>
                <Controls source={p} />
              </li>
            ))}
          </ul>
        ) : null}
        <CareerPageForm />
      </Panel>

      <Panel aria-label="Alertes e-mail" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Alertes e-mail des jobboards</h2>
          <Status source={mailbox} />
        </div>
        <p className="max-w-prose text-[13px] leading-5 text-muted-foreground">
          Crée une boîte dédiée (une adresse qui ne reçoit que des alertes d&apos;emploi) et un mot de passe d&apos;application. JobPilot la lit toutes les 15 minutes en
          lecture seule : rien n&apos;est marqué lu, déplacé ni supprimé. Les offres reçues arrivent avec intitulé, entreprise, lieu et lien ; le texte complet est récupéré
          quand le site l&apos;autorise, sinon tu le colles depuis la fiche de l&apos;offre.
        </p>
        {mailbox ? (
          <div className="flex flex-wrap items-start gap-3">
            <ActionButton action={syncMailboxNowAction.bind(null, mailbox.id)} label="Lire les alertes maintenant" className="min-h-10 px-3" />
            <Controls source={mailbox} />
          </div>
        ) : null}
        <EmailAlertsForm
          defaults={
            mailConfig
              ? { host: mailConfig.host ?? "", port: String(mailConfig.port ?? 993), security: mailConfig.secure ? "tls" : "starttls", user: mailConfig.user ?? "", folder: mailConfig.folder ?? "INBOX", autoFetch: mailConfig.autoFetch !== false }
              : null
          }
        />
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Créer les alertes sur chaque jobboard</summary>
          <ScrollArea label="Guide des alertes par jobboard" className="mt-2 rounded-lg border border-border">
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-background text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Jobboard</th>
                  <th scope="col" className="px-3 py-2 font-medium">Alerte</th>
                  <th scope="col" className="px-3 py-2 font-medium">Texte complet</th>
                </tr>
              </thead>
              <tbody>
                {BOARDS.map((b) => (
                  <tr key={b.id} className="border-t border-muted align-top">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">
                      {b.label}
                    </th>
                    <td className="px-3 py-2">{HOW_TO[b.id]}</td>
                    <td className="px-3 py-2">{b.noFetch ? "À coller (récupération interdite)" : "Récupéré si le site l'autorise"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
            Un transfert automatique (règle de ta messagerie) garde l&apos;expéditeur d&apos;origine ; un transfert manuel ne le garde pas et l&apos;alerte ne serait pas
            reconnue. Les e-mails non reconnus sont comptés ci-dessous.
          </p>
        </details>
      </Panel>

      <Panel aria-label="Dernières synchronisations" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Dernières synchronisations</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune synchronisation pour l&apos;instant.</p>
        ) : (
          <ScrollArea label="Tableau des synchronisations" className="rounded-lg border border-border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="bg-background text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Source</th>
                  <th scope="col" className="px-3 py-2 font-medium">Résultat</th>
                  <th scope="col" className="px-3 py-2 font-medium">Remarques</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-muted align-top">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {stamp.format(r.startedAt)}
                    </th>
                    <td className="px-3 py-2">{r.sourceId ? (byId.get(r.sourceId) ?? "Source supprimée") : r.savedSearchId ? "Recherche enregistrée" : "—"}</td>
                    <td className="px-3 py-2">
                      {r.status === "running" ? "En cours" : `${r.created} nouvelle${r.created > 1 ? "s" : ""} · ${r.duplicates} déjà connue${r.duplicates > 1 ? "s" : ""} · ${r.fetched} reçue${r.fetched > 1 ? "s" : ""}`}
                    </td>
                    <td className="px-3 py-2 text-[13px] text-muted-foreground">{r.errors.join(" ; ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Panel>
    </>
  );
}
