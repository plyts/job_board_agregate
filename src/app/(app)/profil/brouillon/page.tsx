import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PrivacyReportPanel } from "@/components/privacy/PrivacyReportPanel";
import { ProfileEditor } from "@/components/profile/ProfileEditor";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { personalDataProviders, redactPii } from "@/modules/privacy";
import { getDraft } from "@/modules/profile";
import { resolveUncertaintyAction } from "../actions";

export const metadata: Metadata = { title: "Brouillon du profil" };

export default async function DraftPage() {
  const user = await requireUser();
  const draft = await getDraft(getDb(), user.id);
  if (!draft) redirect("/profil");
  const extracting = draft.importStatus === "queued" || draft.importStatus === "extracting";
  const { usable: personalProviders, awaitingConsent } = await personalDataProviders(getDb(), user.id);
  // Texte masqué recalculé localement, tant que le texte source est conservé.
  const masked = draft.sourceText ? redactPii(draft.sourceText, { cv: true, names: [draft.content.identity.fullName] }).text : null;

  return (
    <>
      <nav aria-label="Fil d'Ariane" className="flex flex-wrap gap-1.5 text-sm text-muted-foreground">
        <Link href="/profil" className="text-accent">
          Profil maître
        </Link>
        <span aria-hidden="true">/</span>
        <span>Brouillon</span>
      </nav>
      <PageHeader eyebrow={`Brouillon · version ${draft.version}`} title="Vérifie et complète ton profil">
        <p className="max-w-prose text-[15px] leading-6 text-muted-foreground">
          Rien n&apos;est pris en compte tant que tu n&apos;as pas validé. La version validée devient la source de vérité et ne pourra plus être modifiée : toute correction créera une nouvelle version.
        </p>
      </PageHeader>

      {draft.origin === "import" ? (
        <Panel aria-label="Import du CV" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Import du CV</h2>
            <StatusBadge tone={draft.importStatus === "failed" ? "signal" : draft.importStatus === "extracted" ? "accent" : "neutral"}>
              {{ none: "—", queued: "En file", extracting: "Extraction en cours", extracted: "Extrait", failed: "Échec" }[draft.importStatus]}
            </StatusBadge>
          </div>
          {draft.importReason ? <p className="text-sm leading-6">{draft.importReason}</p> : null}
          {extracting && personalProviders.length === 0 ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Aucun fournisseur IA n&apos;est autorisé et consenti pour recevoir ton CV masqué : l&apos;extraction ne démarrera pas.{" "}
              {awaitingConsent.length
                ? `Tu peux donner ton consentement à ${awaitingConsent.map((p) => p.label).join(", ")} dans `
                : "Saisis ton profil manuellement, ou configure un fournisseur dans "}
              <Link href="/reglages/ia">Fournisseurs IA</Link>.
            </p>
          ) : null}
          {draft.sourceText ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-accent">Texte extrait du CV (non masqué, reste sur ton serveur)</summary>
              <p tabIndex={0} className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-background p-3 font-mono text-xs leading-5">
                {draft.sourceText}
              </p>
            </details>
          ) : null}
        </Panel>
      ) : null}
      {draft.origin === "import" ? <PrivacyReportPanel report={draft.privacyReport} maskedText={masked} /> : null}

      {draft.uncertainties.length > 0 ? (
        <Panel aria-label="Points à vérifier" className="flex flex-col gap-2 border-signal">
          <h2 className="text-base font-semibold">{draft.uncertainties.length} point(s) à vérifier avant validation</h2>
          <ul className="flex flex-col">
            {draft.uncertainties.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 border-t border-muted py-2 text-sm first:border-0">
                <StatusBadge tone="signal">Incertain</StatusBadge>
                <span className="flex-1">
                  <strong>{u.field}</strong> : {u.note}
                </span>
                <form action={resolveUncertaintyAction.bind(null, u.id)}>
                  <Button type="submit" className="min-h-9 px-3">
                    J&apos;ai vérifié
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <ProfileEditor key={`${draft.id}-${draft.importStatus}`} initial={draft.content} locked={extracting} />
    </>
  );
}
