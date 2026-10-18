import { Panel } from "@/components/ui/Panel";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import { QUALITY_RULES, type QualityReport, type QualityRule, type QualityStatus } from "@/modules/cv/quality";

export const RULE_LABELS: Record<QualityRule, string> = {
  order: "Ordre antéchronologique",
  bullets: "3 à 5 puces par poste",
  action_verb: "Verbe d'action en tête",
  quantified: "Résultats chiffrés",
  length: "Une à deux lignes par puce",
  keywords: "Mots-clés de l'offre",
};

export const STATUS_META: Record<QualityStatus, { glyph: string; tone: Tone; text: string; label: string }> = {
  ok: { glyph: "✓", tone: "accent", text: "text-accent", label: "respectée" },
  info: { glyph: "?", tone: "signal", text: "text-signal", label: "à améliorer" },
  warn: { glyph: "!", tone: "danger", text: "text-danger", label: "à corriger" },
};

const KEYWORD_META = {
  used: { label: "repris", tone: "accent" as Tone },
  available: { label: "prouvé, absent du CV", tone: "signal" as Tone },
  gap: { label: "lacune, ne pas ajouter", tone: "neutral" as Tone },
};

/**
 * Rapport de bonnes pratiques (ordre, puces, verbes d'action, chiffres, longueur, mots-clés).
 * Conseils seulement : il ne bloque rien ; le contrôle des faits, lui, bloque.
 */
export function QualityPanel({
  report,
  title = "Bonnes pratiques",
  note,
  actions,
  className,
}: {
  report: QualityReport;
  title?: string;
  note?: React.ReactNode;
  actions?: Partial<Record<QualityRule, React.ReactNode>>;
  className?: string;
}) {
  const warnings = report.checks.filter((c) => c.status === "warn");
  const infos = report.checks.filter((c) => c.status === "info");
  return (
    <Panel aria-label={title} className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        <span className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular-nums">{report.score}</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
          <span className="font-mono text-[11px] text-muted-foreground">· règles v{report.rulesVersion}</span>
        </span>
      </div>
      {note ? <p className="text-[13px] leading-5 text-muted-foreground">{note}</p> : null}
      <ul className="flex flex-col gap-1.5">
        {QUALITY_RULES.filter((r) => report.rules[r]).map((r) => {
          const rule = report.rules[r]!;
          const meta = STATUS_META[rule.status];
          return (
            <li key={r} className="flex flex-wrap items-start gap-2 text-sm">
              <span className={cn("w-4 shrink-0 text-center font-semibold", meta.text)} aria-hidden="true">
                {meta.glyph}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{RULE_LABELS[r]}</span>
                <span className="sr-only"> : {meta.label}</span>
                <span className="block text-[13px] leading-5 text-muted-foreground">{rule.summary}</span>
              </span>
              {actions?.[r] && rule.status !== "ok" ? actions[r] : null}
            </li>
          );
        })}
      </ul>
      {report.keywords?.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Mots-clés de l'offre">
          {report.keywords.map((k) => (
            <StatusBadge key={k.term} tone={KEYWORD_META[k.status].tone} className="normal-case tracking-normal">
              {k.term} · {KEYWORD_META[k.status].label}
            </StatusBadge>
          ))}
        </div>
      ) : null}
      {warnings.length ? (
        <ul className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          {warnings.map((c, i) => (
            <li key={i} className="text-[13px] leading-5">
              <span className="font-semibold text-danger">! </span>
              {c.message}
              {c.hint ? <span className="block text-muted-foreground">{c.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {infos.length ? (
        <details className="border-t border-border pt-2.5 text-[13px] leading-5">
          <summary className="cursor-pointer font-medium text-signal">
            {infos.length} recommandation{infos.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {infos.map((c, i) => (
              <li key={i}>
                <span className="text-signal">? </span>
                {c.message}
                {c.hint ? <span className="block text-muted-foreground">{c.hint}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

/** Score et règle par règle, entre deux rapports (versions comparées). */
export function QualityDelta({ before, after }: { before: QualityReport | null; after: QualityReport }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        Bonnes pratiques : <span className="font-semibold tabular-nums">{before ? before.score : "—"}</span> →{" "}
        <span className="font-semibold tabular-nums">{after.score}</span> / 100
        {before && before.rulesVersion !== after.rulesVersion ? (
          <span className="text-muted-foreground"> (règles v{before.rulesVersion} → v{after.rulesVersion})</span>
        ) : null}
      </p>
      <ul className="grid gap-1 text-[13px] sm:grid-cols-2">
        {QUALITY_RULES.filter((r) => after.rules[r]).map((r) => {
          const b = before?.rules[r];
          const a = after.rules[r]!;
          return (
            <li key={r} className="flex gap-2">
              <span className="text-muted-foreground">{RULE_LABELS[r]} :</span>
              <span className={b ? STATUS_META[b.status].text : "text-muted-foreground"}>{b ? `${b.passed}/${b.total}` : "—"}</span>→
              <span className={STATUS_META[a.status].text}>
                {a.passed}/{a.total}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
