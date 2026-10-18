import type { Metadata } from "next";
import { ScrollArea } from "@/components/ui/ScrollArea";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { CvWorkspace } from "@/components/cv/CvWorkspace";
import { QualityDelta } from "@/components/cv/QualityPanel";
import { VERSION_STATUS_META } from "@/components/cv/labels";
import { CATEGORY_META } from "@/components/matching/labels";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { cn } from "@/lib/cn";
import { currentRequirements, getCvDraft, getCvVersion, lineDiff, listCvVersions, listSuggestions, offerTermsFrom, renderCv, type RenderedCv } from "@/modules/cv";
import { cvQuality } from "@/modules/cv/quality";
import { getCurrentMatch } from "@/modules/matching";
import { getOffer } from "@/modules/offers";
import { personalDataProviders } from "@/modules/privacy";
import { getCurrentProfile, getVersion } from "@/modules/profile";
import { resetCvFromProfileAction, restoreCvVersionAction, startCvDraftAction } from "./actions";

export const metadata: Metadata = { title: "CV personnalisé" };

const when = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const IMPORTANCE = { mandatory: "obligatoire", preferred: "souhaitée", condition: "condition" } as const;

const flatten = (r: RenderedCv) => r.flatMap((s) => [`— ${s.title} —`, ...s.lines]);

export default async function CvPage(props: PageProps<"/offres/[id]/cv">) {
  const user = await requireUser();
  const { id } = await props.params;
  const search = await props.searchParams;
  const db = getDb();
  const offer = await getOffer(db, user.id, id);
  if (!offer) notFound();
  const title = offer.company ? `${offer.title} · ${offer.company}` : offer.title;
  const [draft, requirements, match, currentProfile, versions] = await Promise.all([
    getCvDraft(db, user.id, offer.id),
    currentRequirements(db, user.id, offer.id),
    getCurrentMatch(db, user.id, offer.id),
    getCurrentProfile(db, user.id),
    listCvVersions(db, user.id, offer.id),
  ]);

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
      <span>CV personnalisé</span>
    </nav>
  );

  if (!draft) {
    return (
      <>
        {crumbs}
        <PageHeader eyebrow="CV personnalisé" title="Adapter mon CV à cette offre" />
        {!currentProfile ? (
          <EmptyState title="Aucun profil maître validé">
            <p>Le CV personnalisé est une sélection de ton profil maître : valide-le d&apos;abord.</p>
            <ButtonLink href="/profil" variant="primary">
              Aller au profil maître
            </ButtonLink>
          </EmptyState>
        ) : !requirements ? (
          <EmptyState title="Offre pas encore analysée">
            <p>Les suggestions et le recontrôle s&apos;appuient sur les exigences extraites de l&apos;annonce.</p>
          </EmptyState>
        ) : (
          <EmptyState title="Aucun CV pour cette offre">
            <p>
              Le CV part de ton profil maître v{currentProfile.version}. Tu choisis ce que tu montres et comment tu le formules ; le profil maître n&apos;est jamais modifié.
            </p>
            <ActionButton action={startCvDraftAction.bind(null, offer.id)} label="Créer le CV de cette offre" pendingLabel="Création…" variant="primary" />
          </EmptyState>
        )}
      </>
    );
  }

  const base = await getVersion(db, user.id, draft.baseProfileVersionId);
  if (!base) notFound();
  const suggestions = await listSuggestions(db, user.id, draft.id);
  // Les coordonnées ne sont pas utiles à l'éditeur : elles restent côté serveur.
  const profile = { ...base.content, identity: { ...base.content.identity, email: null, phone: null } };
  const categories = new Map(match?.items.map(({ item }) => [item.requirementId, item.category]) ?? []);
  const aiAvailable = (await personalDataProviders(db, user.id)).usable.length > 0;
  const comparedId = typeof search.comparer === "string" ? search.comparer : null;
  const compared = comparedId ? await getCvVersion(db, user.id, comparedId) : null;
  const comparedBase = compared && compared.offerId === offer.id ? await getVersion(db, user.id, compared.baseProfileVersionId) : null;
  // Chaque version se lit avec son propre profil de référence.
  const diff = compared && comparedBase ? lineDiff(flatten(renderCv(compared.content, comparedBase.content)), flatten(renderCv(draft.content, base.content))) : null;
  const staleProfile = currentProfile && currentProfile.id !== base.id && currentProfile.version > base.version;

  const aside = (
    <Panel aria-label="Exigences de l'offre" className="flex flex-col gap-3 xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Exigences de l&apos;offre</h2>
        {match ? (
          <Link href={`/offres/${offer.id}/matching`} className="text-[13px] font-semibold text-accent">
            {match.match.score !== null ? `Matching ${match.match.score}/100` : "Matching"}
          </Link>
        ) : null}
      </div>
      {requirements?.length ? (
        <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 xl:flex">
          {requirements.map((r) => {
            const c = categories.get(r.id);
            const meta = c ? CATEGORY_META[c] : null;
            return (
              <li key={r.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
                <span className="text-sm font-medium">{r.label}</span>
                <span className="flex flex-wrap gap-1.5 text-[12px] text-muted-foreground">
                  {IMPORTANCE[r.importance]}
                  {meta ? (
                    <StatusBadge tone={meta.tone}>
                      {meta.glyph} {meta.label}
                    </StatusBadge>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Offre non analysée.</p>
      )}
      {!match ? <p className="text-[13px] text-muted-foreground">Lance le matching pour voir la couverture de chaque exigence.</p> : null}
    </Panel>
  );

  return (
    <>
      {crumbs}
      <PageHeader eyebrow={`CV personnalisé · brouillon v${draft.version} · profil maître v${base.version}`} title="Adapter mon CV">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Choisis, ordonne et reformule les éléments de ton profil maître. Intitulés, entreprises et dates restent ceux du profil ; chaque chiffre et chaque mot-clé de l&apos;offre doit avoir sa source.
        </p>
      </PageHeader>

      {staleProfile ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-signal bg-panel px-4 py-3 text-sm">
          <span>
            Ton profil maître est passé en version {currentProfile.version} depuis la création de ce CV (v{base.version}).
          </span>
          <ActionButton
            action={resetCvFromProfileAction.bind(null, offer.id)}
            label={`Repartir du profil v${currentProfile.version}`}
            confirm="Le brouillon sera remplacé par le profil maître actuel. Les versions enregistrées restent disponibles. Continuer ?"
            className="min-h-10 px-3"
          />
        </div>
      ) : null}

      <CvWorkspace
        key={draft.revision}
        offerId={offer.id}
        revision={draft.revision}
        initial={draft.content}
        profile={profile}
        offerTerms={offerTermsFrom(requirements ?? [])}
        today={new Date().toISOString()}
        savedAt={`le ${when.format(draft.updatedAt)}`}
        suggestions={suggestions.map((s) => ({
          id: s.id,
          kind: s.kind,
          targetId: s.targetId,
          text: s.text,
          order: s.order,
          sourceIds: s.sourceIds,
          rationale: s.rationale,
          covers: s.covers,
          state: s.state,
          blockReason: s.blockReason,
        }))}
        suggestStatus={draft.suggestStatus}
        suggestReason={draft.suggestReason}
        aiAvailable={aiAvailable}
        aside={aside}
      />

      <Panel aria-label="Versions" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Versions</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune version enregistrée. « Recontrôler cette version » fige le brouillon en version immuable.</p>
        ) : (
          <ScrollArea label="Tableau des enregistrements du CV">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-[12px] text-muted-foreground">
                  <th className="py-2 font-medium">Version</th>
                  <th className="py-2 font-medium">État</th>
                  <th className="py-2 font-medium">Créée</th>
                  <th className="py-2 font-medium">Bonnes pratiques</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-t border-border align-top">
                    <td className="py-2.5 font-semibold">v{v.version}</td>
                    <td className="py-2.5">
                      <StatusBadge tone={VERSION_STATUS_META[v.status].tone}>{VERSION_STATUS_META[v.status].label}</StatusBadge>
                    </td>
                    <td className="py-2.5 text-muted-foreground">{when.format(v.createdAt)}</td>
                    <td className="py-2.5 tabular-nums">{v.quality ? `${v.quality.score}/100 · règles v${v.quality.rulesVersion}` : "—"}</td>
                    <td className="flex flex-wrap items-center gap-3 py-2">
                      <Link href={`/offres/${offer.id}/cv?comparer=${v.id}#comparaison`} className="font-semibold text-accent">
                        Comparer au brouillon
                      </Link>
                      <Link href={`/offres/${offer.id}/cv/recontrole/${v.id}`} className="font-semibold text-accent">
                        Recontrôle
                      </Link>
                      <a href={`/api/cv/${v.id}/export?format=pdf`} className="font-semibold text-accent">
                        PDF
                      </a>
                      <a href={`/api/cv/${v.id}/export?format=docx`} className="font-semibold text-accent">
                        DOCX
                      </a>
                      <ActionButton
                        action={restoreCvVersionAction.bind(null, offer.id, v.id)}
                        label="Restaurer"
                        variant="ghost"
                        className="min-h-10 px-2"
                        confirm={`Remplacer le brouillon par la version ${v.version} ? Les versions enregistrées ne changent pas.`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Panel>

      {diff && compared ? (
        <Panel id="comparaison" aria-label="Comparaison" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              v{compared.version} → brouillon v{draft.version}
            </h2>
            <Link href={`/offres/${offer.id}/cv`} className="text-sm font-semibold text-accent">
              Fermer la comparaison
            </Link>
          </div>
          <QualityDelta before={compared.quality} after={cvQuality(draft.content, base.content, offerTermsFrom(requirements ?? []))} />
          {diff.every((d) => d.op === "same") ? <p className="text-sm text-muted-foreground">Aucune différence.</p> : null}
          <ol className="flex flex-col font-mono text-[13px] leading-6">
            {diff.map((d, i) => (
              <li
                key={i}
                className={cn(
                  "whitespace-pre-wrap rounded px-2",
                  d.op === "added" && "bg-accent-soft text-foreground",
                  d.op === "removed" && "text-danger line-through",
                  d.op === "same" && "text-muted-foreground",
                )}
              >
                <span className="sr-only">{d.op === "added" ? "Ajouté : " : d.op === "removed" ? "Retiré : " : ""}</span>
                <span aria-hidden="true">{d.op === "added" ? "+ " : d.op === "removed" ? "− " : "  "}</span>
                {d.text}
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </>
  );
}
