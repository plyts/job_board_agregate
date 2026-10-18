import { UNTRUSTED_DATA_RULE, untrustedDocument } from "@/modules/platform/llm/untrusted";

export const EXTRACTION_PROMPT_VERSION = "offer-extract-v1";

export const EXTRACTION_SYSTEM = `Tu analyses une offre d'emploi pour un candidat qui veut savoir précisément ce qui est exigé.

Règles :
- Relève chaque exigence ou information utile : missions, compétences techniques et comportementales, technologies, années d'expérience, séniorité, diplômes, certifications, langues, type de contrat, lieu, télétravail, disponibilité, salaire, habilitation.
- importance : "mandatory" pour ce qui est exigé, "preferred" pour ce qui est souhaité (« un plus », « idéalement »), "condition" pour le contrat, le lieu, le télétravail, le salaire, la disponibilité.
- provenance :
  - "explicit" : écrit dans l'annonce. Recopie dans quote l'extrait exact, mot pour mot, sans le reformuler ni le corriger (une phrase au plus).
  - "inferred" : déduit sans être écrit. Explique la déduction dans rationale ; quote peut citer le passage qui la fonde.
  - "uncertain" : l'annonce est ambiguë. Explique pourquoi dans rationale.
- N'invente rien. Une information absente (par exemple un salaire non communiqué) va dans notMentioned, jamais dans requirements.
- Deux technologies distinctes font deux exigences ; une même exigence n'apparaît qu'une fois.
- title, company et location : tels qu'écrits dans l'annonce, null s'ils n'y figurent pas.

${UNTRUSTED_DATA_RULE}`;

export function buildExtractionUserMessage(rawText: string): string {
  const { block } = untrustedDocument("job_offer", rawText);
  return `Analyse l'offre d'emploi suivante.\n\n${block}`;
}
