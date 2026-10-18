import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FinalizeButton } from "@/components/cv/FinalizeButton";
import { QualityPanel } from "@/components/cv/QualityPanel";
import { VERSION_STATUS_META } from "@/components/cv/labels";
import { CATEGORY_META } from "@/components/matching/labels";
import { MatchPoller } from "@/components/matching/MatchPoller";
import { ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { compareCoverage, factCheckVersion, getCvVersion, hasBlocking, type CategoryChange } from "@/modules/cv";
import { cvQuality } from "@/modules/cv/quality";
import { getCurrentMatch, getCvCheck, type MatchView } from "@/modules/matching";
import { computeScore } from "@/modules/matching/score";
import { getOffer } from "@/modules/offers";
import { getVersion } from "@/modules/profile";
import { Glyph } from "@/components/ui/Glyph";

export const metadata: Metadata = { title: "Recontrôle du CV" };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

function coverage(view: MatchView) {
  return view.items.map(({ item, requirement }) => ({ requirementId: requirement.id, label: requirement.label, category: item.category, rationale: item.rationale }));
}

function Category({ c }: { c: CategoryChange["after"] | null }) {
  if (!c) return <span className="text-muted-foreground">non évaluée</span>;
  const meta = CATEGORY_META[c];
  return (
    <StatusBadge tone={meta.tone}>
      <Glyph>{meta.glyph}</Glyph> {meta.label}
    </StatusBadge>
  );
}

function Changes({ title, tone, items, empty }: { title: string; tone: string; items: CategoryChange[]; empty: string }) {
  return (
    <Panel aria-label={title} className="flex flex-col gap-3">
      <h2 className={`text-[15px] font-semibold ${tone}`}>
        {title} <span className="text-muted-foreground">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.label} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
              <span className="text-sm font-semibold">{c.label}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
                <Category c={c.before} /> <span aria-hidden="true">→</span>
                <span className="sr-only">devient</span> <Category c={c.after} />
              </span>
              <span className="text-[13px] leading-5 text-muted-foreground">{c.rationale}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default async function RecheckPage(props: PageProps<"/offres/[id]/cv/recontrole/[versionId]">) {
  const user = await requireUser();
  const { id, versionId } = await props.params;
  const db = getDb();
  const offer = await getOffer(db, user.id, id);
  const version = offer ? await getCvVersion(db, user.id, versionId) : null;
  if (!offer || !version || version.offerId !== offer.id || version.status === "draft") notFound();
  const [check, reference, base, issues] = await Promise.all([
    getCvCheck(db, user.id, version.id),
    getCurrentMatch(db, user.id, offer.id),
    getVersion(db, user.id, version.baseProfileVersionId),
    factCheckVersion(db, user.id, version),
  ]);
  const title = offer.company ? `${offer.title} · ${offer.company}` : offer.title;
  const done = check?.match.status === "done";
  const diff = done && reference?.match.status === "done" ? compareCoverage(coverage(reference), coverage(check)) : null;
  // Score de référence recalculé avec les poids du recontrôle : les deux scores restent comparables même si les poids ont changé depuis.
  const before =
    done && reference?.match.status === "done"
      ? computeScore(
          reference.items.map(({ item }) => ({ kind: item.kind, importance: item.importance, category: item.category })),
          check.match.weights,
        ).score
      : null;
  const after = done ? check.match.score : null;
  const delta = before !== null && after !== null ? after - before : null;
  const blocking = issues?.filter((i) => i.severity === "blocking") ?? [];
  const warnings = issues?.filter((i) => i.severity === "warning") ?? [];
  const finalized = version.status === "finalized";

  return (
    <>
      <nav aria-label="Fil d'Ariane" className="flex flex-wrap gap-1.5 text-sm text-muted-foreground">
        <Link href="/offres" className="text-accent">
          Offres
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/offres/${offer.id}`} className="text-accent">
          {title}
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/offres/${offer.id}/cv`} className="text-accent">
          CV personnalisé
        </Link>
        <span aria-hidden="true">/</span>
        <span>Recontrôle v{version.version}</span>
      </nav>
      <PageHeader
        eyebrow={`Recontrôle · CV v${version.version} · profil maître v${base?.version ?? "?"}`}
        title="Ce que le recruteur verra"
        actions={
          <>
            <StatusBadge tone={VERSION_STATUS_META[version.status].tone}>{VERSION_STATUS_META[version.status].label}</StatusBadge>
            {!finalized ? <ButtonLink href={`/offres/${offer.id}/cv`}>Continuer l&apos;édition</ButtonLink> : null}
          </>
        }
      />

      {/* Région persistante : la fin du recontrôle est annoncée quand la page se rafraîchit d'elle-même. */}
      <p role="status" className="sr-only">
        {done ? `Recontrôle terminé : score ${after ?? "inconnu"} sur 100.` : ""}
      </p>
      {!check ? (
        <p role="status" className="rounded-lg border border-signal bg-panel px-4 py-3 text-sm">
          Aucun recontrôle pour cette version. Relance-le depuis l&apos;éditeur (« Recontrôler cette version »).
        </p>
      ) : check.match.status === "pending" ? (
        <Panel className="flex flex-col gap-2">
          <MatchPoller />
          <h2 className="text-base font-semibold">Recontrôle en cours…</h2>
          <p className="text-sm text-muted-foreground">{check.match.statusReason ?? "Le nouveau score s'affichera ici automatiquement. Le worker doit être actif."}</p>
        </Panel>
      ) : check.match.status === "failed" ? (
        <p role="alert" className="rounded-lg border border-danger bg-panel px-4 py-3 text-sm">
          {check.match.statusReason}
        </p>
      ) : null}
      {check?.match.mode === "rules_only" ? (
        <p role="status" className="rounded-lg border border-signal bg-panel px-4 py-3 text-sm">
          Recontrôle partiel : seuls les calculs déterministes ont été refaits, faute de fournisseur IA autorisé à recevoir ton CV. Les autres exigences restent « à confirmer ».
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Panel aria-label="Score avant et après" className="flex flex-col gap-3 md:col-span-1">
          <h2 className="text-sm font-semibold text-muted-foreground">Score de compatibilité</h2>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold text-muted-foreground tabular-nums" aria-label="Avant">
              {before ?? "—"}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <span className="text-5xl font-bold tracking-tight tabular-nums" aria-label="Après">
              {after ?? "—"}
            </span>
            <span className="text-muted-foreground">/ 100</span>
          </div>
          <p className="text-[13px] leading-5 text-muted-foreground">
            {delta === null
              ? "Avant : profil maître complet. Après : ce CV seul. Un des deux scores manque encore."
              : delta === 0
                ? "Même score que le profil maître complet : le CV montre tout ce qui compte pour cette offre."
                : delta > 0
                  ? `+${delta} points par rapport au profil maître complet : les formulations retenues rendent les preuves plus lisibles.`
                  : `${delta} points par rapport au profil maître complet : le CV laisse de côté des preuves utiles à cette offre.`}{" "}
            Mêmes poids des deux côtés.
          </p>
        </Panel>
        <Panel aria-label="Vérification des faits" className="flex flex-col gap-2 md:col-span-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Vérification des faits</h2>
          {!issues ? (
            <p className="text-sm text-danger">Profil maître de référence introuvable.</p>
          ) : blocking.length === 0 ? (
            <p className="text-sm text-accent"><Glyph>✓</Glyph> Dates, intitulés et entreprises viennent du profil maître ; chaque chiffre et mot-clé de l&apos;offre a sa source.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {blocking.map((i, k) => (
                <li key={k} className="text-sm text-danger">
                  ! {i.message}
                </li>
              ))}
            </ul>
          )}
          {warnings.map((i, k) => (
            <p key={k} className="text-[13px] text-signal">
              ? {i.message}
            </p>
          ))}
        </Panel>
      </div>

      {diff ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Changes title="Mieux couvertes" tone="text-accent" items={diff.improved} empty="Aucune exigence n'a gagné en couverture." />
          <Changes title="Moins bien couvertes" tone="text-danger" items={diff.worsened} empty="Le CV ne perd rien par rapport au profil maître." />
          <Changes title="Lacunes persistantes" tone="text-signal" items={diff.persistent} empty="Aucune." />
        </div>
      ) : done && !reference ? (
        <p className="text-sm text-muted-foreground">Pas de matching du profil maître pour comparer : lance-le depuis la page de l&apos;offre.</p>
      ) : null}

      {version.quality ? (
        <QualityPanel report={version.quality} note={`Rapport figé à l'enregistrement de la version ${version.version}, avec les règles v${version.quality.rulesVersion}. Conseils seulement : ils ne bloquent pas la finalisation.`} />
      ) : base ? (
        <QualityPanel
          report={cvQuality(version.content, base.content, [])}
          note="Version enregistrée avant le contrôle des bonnes pratiques : rapport recalculé avec les règles actuelles, sans les mots-clés de l'offre."
        />
      ) : null}

      <Panel aria-label="Les trois documents" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Les trois documents</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Profil maître</span>
            <span className="text-sm font-semibold">Version {base?.version ?? "?"}</span>
            {base ? (
              <Link href={`/profil/versions/${base.id}`} className="text-[13px] font-semibold text-accent">
                Voir le profil de référence
              </Link>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-accent p-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">CV personnalisé</span>
            <span className="text-sm font-semibold">
              Version {version.version} · {VERSION_STATUS_META[version.status].label.toLowerCase()}
              {version.finalizedAt ? ` le ${dateFmt.format(version.finalizedAt)}` : ""}
            </span>
            <span className="flex gap-3 text-[13px]">
              <a href={`/api/cv/${version.id}/export?format=pdf`} className="font-semibold text-accent">
                Télécharger le PDF
              </a>
              <a href={`/api/cv/${version.id}/export?format=docx`} className="font-semibold text-accent">
                DOCX
              </a>
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">CV envoyé</span>
            <span className="text-sm text-muted-foreground">Pas encore envoyé. Il sera figé et haché à la confirmation d&apos;envoi de la candidature.</span>
          </div>
        </div>
      </Panel>

      {!finalized ? (
        <Panel aria-label="Finaliser" className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Finaliser fige cette version : c&apos;est elle que tu joindras à ta candidature. Impossible tant qu&apos;un écart factuel bloquant subsiste ou que le recontrôle n&apos;est pas terminé.
          </p>
          <FinalizeButton versionId={version.id} disabled={!done || hasBlocking(issues ?? [])} />
        </Panel>
      ) : null}
    </>
  );
}
