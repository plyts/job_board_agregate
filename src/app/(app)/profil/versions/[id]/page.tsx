import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QualityPanel } from "@/components/cv/QualityPanel";
import { ProfileView } from "@/components/profile/ProfileView";
import { PageHeader } from "@/components/ui/PageHeader";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getVersion } from "@/modules/profile";

export const metadata: Metadata = { title: "Version du profil" };

export default async function VersionPage(props: PageProps<"/profil/versions/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const version = await getVersion(getDb(), user.id, id);
  if (!version || version.status !== "validated") notFound();
  return (
    <>
      <nav aria-label="Fil d'Ariane" className="flex flex-wrap gap-1.5 text-sm text-muted-foreground">
        <Link href="/profil" className="text-accent">
          Profil maître
        </Link>
        <span aria-hidden="true">/</span>
        <span>Version {version.version}</span>
      </nav>
      <PageHeader eyebrow={`Version ${version.version} · lecture seule`} title={version.content.identity.fullName} />
      {version.quality ? (
        <QualityPanel report={version.quality} title="Bonnes pratiques de cette version" note={`Rapport figé à la validation, avec les règles v${version.quality.rulesVersion}.`} />
      ) : null}
      <ProfileView content={version.content} />
    </>
  );
}
