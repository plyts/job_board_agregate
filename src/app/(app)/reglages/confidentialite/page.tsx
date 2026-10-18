import type { Metadata } from "next";
import Link from "next/link";
import { ConsentButton } from "@/components/privacy/ConsentButton";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { providerStatuses } from "@/modules/platform";
import { listConsents, NO_CONSENT_NEEDED, PII_CATEGORIES, PII_LABELS, PII_PLACEHOLDERS, PII_RULES_VERSION, personalDataStats } from "@/modules/privacy";
import { sourceRetentionDays } from "@/modules/profile";

export const metadata: Metadata = { title: "Confidentialité et RGPD" };

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

function days(n: number) {
  return n === 0 ? "effacé dès la validation" : `${n} jour${n > 1 ? "s" : ""}`;
}

export default async function PrivacyPage() {
  const user = await requireUser();
  const db = getDb();
  const [stats, consents] = await Promise.all([personalDataStats(db, user.id), listConsents(db, user.id)]);
  const statuses = providerStatuses();
  const byId = new Map(statuses.map((s) => [s.id as string, s]));
  const active = new Set(consents.filter((c) => !c.revokedAt).map((c) => c.provider));
  const eligible = statuses.filter((s) => s.policy.allowsPersonalData && !NO_CONSENT_NEEDED.has(s.id));
  const backupDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30) || 30;
  const history = [...consents].sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());

  return (
    <>
      <PageHeader eyebrow="Réglages" title="Confidentialité et RGPD">
        <p className="max-w-prose text-[15px] leading-6 text-muted-foreground">
          Ce que JobPilot garde, ce qui part vers un modèle d&apos;IA, et comment exercer tes droits. Le détail du registre des traitements est dans{" "}
          <code className="font-mono">docs/RGPD.md</code>.
        </p>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground">Envois de données personnelles</span>
          <span className="text-3xl font-bold">{stats.calls}</span>
          <span className="text-xs text-muted-foreground">appels réussis, toujours masqués</span>
        </Panel>
        <Panel className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground">Données masquées avant l&apos;envoi</span>
          <span className="text-3xl font-bold">{stats.maskedAtBoundary}</span>
          <span className="text-xs text-muted-foreground">remplacées par une étiquette</span>
        </Panel>
        <Panel className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground">Retirées des réponses</span>
          <span className="text-3xl font-bold">{stats.removedFromOutput}</span>
          <span className="text-xs text-muted-foreground">reprises ou inventées par le modèle</span>
        </Panel>
      </div>

      <Panel aria-label="Masquage" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Masquage avant et après chaque appel</h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Avant l&apos;envoi, sur ton serveur et sans appel réseau, chaque donnée ci-dessous est remplacée par une étiquette. Après la réponse, la même
          inspection retire ce que le modèle aurait repris ou inventé. Ton nom et tes coordonnées sont réinjectés localement dans le profil, jamais envoyés.
          Règles v{PII_RULES_VERSION}.
        </p>
        <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {PII_CATEGORIES.map((c) => (
            <li key={c} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-muted py-1">
              <span>{PII_LABELS[c]}</span>
              <code className="font-mono text-xs text-muted-foreground">{PII_PLACEHOLDERS[c]}</code>
            </li>
          ))}
        </ul>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Le masquage est automatique : il peut laisser passer une donnée écrite d&apos;une façon imprévue. Après chaque import, relis le texte masqué affiché sur
          le brouillon du profil. Évite de mettre dans ton CV des données sensibles (santé, religion, opinions) : elles ne sont jamais utiles au matching.
        </p>
      </Panel>

      <Panel aria-label="Consentements" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Consentements</h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Un fournisseur externe ne reçoit ton CV, ton profil ou tes candidatures (masqués) que s&apos;il est autorisé par la configuration et que tu y as
          consenti. Un modèle local traite tout sur ta machine : aucun consentement n&apos;est requis. Le retrait vaut pour les envois suivants.
        </p>
        {eligible.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Aucun fournisseur externe n&apos;est autorisé à recevoir des données personnelles (voir <Link href="/reglages/ia">Fournisseurs IA</Link>).
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {eligible.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <span className="flex flex-col">
                  <span className="font-semibold">{s.label}</span>
                  <span className="text-xs text-muted-foreground">Traitement : {s.region}</span>
                </span>
                <span className="flex items-center gap-2">
                  {active.has(s.id) ? <StatusBadge tone="signal">Consenties</StatusBadge> : <StatusBadge>Sans ton consentement</StatusBadge>}
                  <ConsentButton provider={s.id} label={s.label} region={s.region} granted={active.has(s.id)} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {history.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Historique des consentements</summary>
            <ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted-foreground">
              {history.map((c) => (
                <li key={c.id}>
                  {byId.get(c.provider)?.label ?? c.provider} : donné le {dateTime.format(c.grantedAt)}
                  {c.revokedAt ? `, retiré le ${dateTime.format(c.revokedAt)}` : ", actif"}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Panel>

      <Panel aria-label="Transferts" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Où sont parties tes données</h2>
        {stats.byProvider.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune donnée personnelle n&apos;a été envoyée à un modèle.</p>
        ) : (
          <ScrollArea label="Envois par fournisseur" className="rounded-lg border border-border">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="bg-background text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Fournisseur</th>
                  <th scope="col" className="px-3 py-2 font-medium">Lieu de traitement</th>
                  <th scope="col" className="px-3 py-2 font-medium">Envois</th>
                  <th scope="col" className="px-3 py-2 font-medium">Masquées / retirées</th>
                  <th scope="col" className="px-3 py-2 font-medium">Dernier envoi</th>
                </tr>
              </thead>
              <tbody>
                {stats.byProvider.map((r) => (
                  <tr key={r.provider} className="border-t border-muted">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">
                      {byId.get(r.provider)?.label ?? r.provider}
                    </th>
                    <td className="px-3 py-2">{byId.get(r.provider)?.region ?? "inconnu"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.calls}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.masked} / {r.removedFromOutput}
                    </td>
                    <td className="px-3 py-2 text-[13px]">{r.lastAt ? dateTime.format(r.lastAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
        <p className="text-[13px] leading-5 text-muted-foreground">
          Hors Union européenne, le transfert repose sur le cadre UE–États-Unis de protection des données ou sur les clauses contractuelles du fournisseur : à
          vérifier dans ses conditions avant de consentir. Les annonces, données publiques, ne sont pas comptées ici.
        </p>
      </Panel>

      <Panel aria-label="Durées de conservation" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Durées de conservation</h2>
        <ScrollArea label="Tableau des durées de conservation" className="rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-background text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Donnée</th>
                <th scope="col" className="px-3 py-2 font-medium">Durée</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["CV importé (fichier et texte brut), après validation du profil", days(sourceRetentionDays())],
                ["Brouillon d'import abandonné", "effacé immédiatement, fichier compris"],
                ["Profil maître, CV personnalisés, candidatures, contacts", "jusqu'à ce que tu les supprimes ou supprimes ton compte"],
                ["Documents réellement envoyés", "conservés comme preuve, effacés avec le compte"],
                ["Journal des appels IA (sans contenu, décomptes seulement)", "jusqu'à la suppression du compte"],
                ["Sessions de connexion", "expirent après 30 jours sans activité, puis effacées"],
                ["Tentatives de connexion (anti force brute)", "30 jours"],
                ["Sauvegardes chiffrées", days(backupDays)],
              ].map(([what, how]) => (
                <tr key={what} className="border-t border-muted">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {what}
                  </th>
                  <td className="px-3 py-2">{how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </Panel>

      <Panel aria-label="Tes droits" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Tes droits</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-6">
          <li>
            Accès et portabilité : <Link href="/reglages/compte">exporter toutes tes données</Link> en JSON avec les fichiers.
          </li>
          <li>
            Rectification : modifie le <Link href="/profil">profil maître</Link> ; chaque version reste datée.
          </li>
          <li>
            Effacement : <Link href="/reglages/compte">supprime ton compte</Link>, ce qui efface tout, sauvegardes comprises à leur expiration.
          </li>
          <li>Retrait du consentement : à tout moment ci-dessus, sans effet sur les envois déjà faits.</li>
          <li>
            Réclamation : auprès de la CNIL (<a href="https://www.cnil.fr/fr/plaintes">cnil.fr/fr/plaintes</a>) ou de l&apos;autorité de ton pays.
          </li>
        </ul>
        <p className="text-[13px] leading-5 text-muted-foreground">
          JobPilot est auto-hébergé : la personne qui l&apos;installe est responsable du traitement. Les contacts de recruteurs que tu enregistres sont des
          données de tiers : n&apos;y mets que le nécessaire, et ils ne sont jamais envoyés à un modèle.
        </p>
      </Panel>
    </>
  );
}
