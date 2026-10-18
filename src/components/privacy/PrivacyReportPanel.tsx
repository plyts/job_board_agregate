import { Panel } from "@/components/ui/Panel";
import { PII_CATEGORIES, PII_LABELS, totalCount, type PrivacyReport } from "@/modules/privacy/pii";

function List({ counts }: { counts: Partial<Record<(typeof PII_CATEGORIES)[number], number>> }) {
  const items = PII_CATEGORIES.filter((c) => counts[c]);
  if (!items.length) return <span className="text-muted-foreground">aucune</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((c) => (
        <li key={c} className="rounded-full border border-border px-2.5 py-0.5 text-[13px]">
          {PII_LABELS[c]} × {counts[c]}
        </li>
      ))}
    </ul>
  );
}

/**
 * Ce qui a été masqué avant l'IA et retiré de sa réponse (décomptes, jamais les valeurs), avec,
 * si le texte source est encore conservé, le texte masqué tel que le modèle le reçoit.
 */
export function PrivacyReportPanel({ report, maskedText }: { report: PrivacyReport | null; maskedText: string | null }) {
  return (
    <Panel aria-label="Confidentialité de l'import" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Confidentialité de l&apos;import</h2>
      {report ? (
        <>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Avant l&apos;envoi à l&apos;IA, masqué localement ({totalCount(report.before)}) :</span>
            <List counts={report.before} />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Après, retiré de la réponse du modèle ({totalCount(report.after ?? {})}) :</span>
            <List counts={report.after ?? {}} />
          </div>
          <p className="text-[13px] text-muted-foreground">
            {report.sentChars.toLocaleString("fr-FR")} caractères envoyés · règles de masquage v{report.rulesVersion}. Ton identité et tes coordonnées ont été réinjectées localement dans le brouillon.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun envoi à une IA pour l&apos;instant. Voici le texte masqué qui serait envoyé, si un fournisseur est autorisé.</p>
      )}
      {report?.sensitive ? (
        <p role="note" className="rounded-lg border border-signal px-3 py-2 text-sm">
          Ton CV contient une donnée sensible (santé, religion, opinions…). Elle n&apos;a pas été envoyée. Garde-la dans le CV que tu transmets aux recruteurs
          seulement si c&apos;est un choix délibéré (par exemple une RQTH que tu souhaites signaler).
        </p>
      ) : null}
      {maskedText ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-accent">Voir le texte masqué envoyé au modèle</summary>
          <p tabIndex={0} className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-background p-3 font-mono text-xs leading-5">
            {maskedText}
          </p>
        </details>
      ) : null}
    </Panel>
  );
}
