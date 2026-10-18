import type { Metadata } from "next";
import Link from "next/link";
import { ImportCvForm } from "@/components/profile/ImportCvForm";
import { ProfileView } from "@/components/profile/ProfileView";
import { Button, ButtonLink } from "@/components/ui/Button";
import { QualityPanel } from "@/components/cv/QualityPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { profileQuality } from "@/modules/cv/quality";
import { getCurrentProfile, getDraft, listVersions } from "@/modules/profile";
import { startDraftAction } from "./actions";

export const metadata: Metadata = { title: "Profil maître" };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const ORIGIN = { manual: "saisie manuelle", import: "import de CV", edit: "modification" } as const;

export default async function ProfilePage() {
  const user = await requireUser();
  const db = getDb();
  const [current, draft, versions] = await Promise.all([getCurrentProfile(db, user.id), getDraft(db, user.id), listVersions(db, user.id)]);

  return (
    <>
      <PageHeader
        eyebrow={current ? `Profil maître · version ${current.version} · source de vérité` : "Profil maître"}
        title={current?.content.identity.fullName || "Profil maître"}
        actions={
          draft ? (
            <ButtonLink href="/profil/brouillon" variant="primary">
              Reprendre le brouillon
            </ButtonLink>
          ) : (
            <form action={startDraftAction}>
              <Button type="submit" variant="primary">
                {current ? "Modifier le profil" : "Saisir mon profil"}
              </Button>
            </form>
          )
        }
      >
        {current?.content.identity.headline ? <span className="text-base text-muted-foreground">{current.content.identity.headline}</span> : null}
      </PageHeader>

      {draft ? (
        <p role="status" className="rounded-lg border border-signal bg-panel px-4 py-3 text-sm">
          Un brouillon (version {draft.version}) est en cours.{" "}
          <Link href="/profil/brouillon" className="font-semibold text-accent">
            Le reprendre
          </Link>
        </p>
      ) : (
        <Panel aria-labelledby="import-cv" className="flex flex-col gap-3">
          <h2 id="import-cv" className="text-lg font-semibold tracking-tight">
            Importer un CV
          </h2>
          <ImportCvForm />
        </Panel>
      )}

      {current ? (
        <>
          <QualityPanel
            report={current.quality ?? profileQuality(current.content)}
            title="Bonnes pratiques du profil maître"
            note={
              current.quality
                ? `Rapport figé à la validation de la version ${current.version}, avec les règles v${current.quality.rulesVersion}. Pour l'améliorer : « Modifier le profil », puis valider une nouvelle version.`
                : "Version validée avant ce contrôle : rapport recalculé avec les règles actuelles."
            }
          />
          <ProfileView content={current.content} />
        </>
      ) : (
        <EmptyState title="Aucun profil validé">
          <p>Importe ton CV ou saisis ton profil. Le profil maître validé sert de référence au matching et à l&apos;adaptation des CV ; il n&apos;est jamais modifié par un CV personnalisé.</p>
        </EmptyState>
      )}

      {versions.length > 0 ? (
        <Panel aria-labelledby="versions" className="flex flex-col gap-3">
          <h2 id="versions" className="text-lg font-semibold tracking-tight">
            Historique des versions
          </h2>
          <ul className="flex flex-col">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 border-t border-muted py-2 text-sm first:border-0">
                <span className="font-mono text-xs">v{v.version}</span>
                <span className="flex-1">
                  {v.status === "draft" ? "Brouillon" : `Validée le ${dateFmt.format(v.validatedAt!)}`} · {ORIGIN[v.origin]}
                </span>
                {v.quality ? <span className="font-mono text-xs text-muted-foreground">bonnes pratiques {v.quality.score}/100</span> : null}
                {v.status === "validated" ? (
                  <Link href={`/profil/versions/${v.id}`} className="font-semibold text-accent">
                    Consulter
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
