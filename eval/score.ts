import { normalizeForHash } from "../src/modules/offers/normalize";
import type { VerifiedExtraction } from "../src/modules/analysis/verify";

export type EvalCase = {
  id: string;
  text: string;
  expected: { kinds: string[]; importance: string; keywords: string[] }[];
  notMentioned: string[];
  forbidden: { keywords: string[] }[];
  expectUncertain?: string[];
};

export type CaseScore = {
  id: string;
  recall: number;
  importanceAgreement: number;
  missed: string[];
  forbiddenFound: string[];
  invalidQuotes: number;
  explicit: number;
  notMentionedMissed: string[];
};

function haystack(r: VerifiedExtraction["requirements"][number]): string {
  return normalizeForHash([r.label, r.value, r.quote].filter(Boolean).join(" "));
}

/** Rappel des exigences attendues, accord sur l'importance, contenus interdits et citations invalides. */
export function scoreCase(c: EvalCase, out: VerifiedExtraction): CaseScore {
  let matched = 0;
  let importanceOk = 0;
  const missed: string[] = [];
  for (const exp of c.expected) {
    const hit = out.requirements.find(
      (r) => exp.kinds.includes(r.kind) && exp.keywords.every((k) => haystack(r).includes(normalizeForHash(k))),
    );
    if (hit) {
      matched++;
      if (hit.importance === exp.importance) importanceOk++;
    } else missed.push(`${exp.kinds.join("|")}:${exp.keywords.join("+")}`);
  }
  const forbiddenFound = c.forbidden
    .filter((f) => out.requirements.some((r) => f.keywords.every((k) => haystack(r).includes(normalizeForHash(k)))))
    .map((f) => f.keywords.join("+"));
  const explicitClaims = out.requirements.filter((r) => r.provenance === "explicit" || r.verificationNote?.startsWith("Citation"));
  return {
    id: c.id,
    recall: c.expected.length ? matched / c.expected.length : 1,
    importanceAgreement: matched ? importanceOk / matched : 1,
    missed,
    forbiddenFound,
    invalidQuotes: out.requirements.filter((r) => r.verificationNote?.startsWith("Citation")).length,
    explicit: explicitClaims.length,
    notMentionedMissed: c.notMentioned.filter((k) => !out.notMentioned.includes(k as never)),
  };
}
