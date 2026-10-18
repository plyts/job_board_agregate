import { z } from "zod";
import { letterFactCheck } from "@/modules/cv/factcheck";
import { UNTRUSTED_DATA_RULE, untrustedDocument } from "@/modules/platform/llm/untrusted";
import { PII_LABELS, restorePlaceholders } from "@/modules/privacy/pii";
import { evidenceElements, type ProfileContent } from "@/modules/profile/content";

export const LETTER_PROMPT_VERSION = "letter-draft-v1";
export const LETTER_SCHEMA_VERSION = 1;
const MAX_PARAGRAPHS = 6;
const MAX_PARAGRAPH_CHARS = 1500;

export const LetterDraft = z.object({
  paragraphs: z.array(
    z.object({
      kind: z.enum(["opening", "body", "closing"]),
      text: z.string(),
      sourceIds: z.array(z.string()).describe("Éléments du profil qui fondent le paragraphe ; vide seulement pour l'accroche et la conclusion"),
      covers: z.array(z.string()).describe("Exigences de l'offre mises en avant, telles qu'écrites"),
    }),
  ),
});
export type RawLetter = z.infer<typeof LetterDraft>;

export const LETTER_SYSTEM = `Tu aides un candidat à rédiger une lettre de motivation en français pour une offre, sans jamais rien inventer.

Structure : 3 à 5 paragraphes, 250 à 350 mots au total.
- "opening" : pourquoi ce poste et cette entreprise, à partir de ce que dit l'offre ; pas de formule creuse.
- "body" (1 à 3) : ce que le candidat apporte, chaque paragraphe appuyé sur des éléments du profil cités dans sourceIds,
  reliés aux exigences de l'offre qu'ils couvrent (covers). Mets d'abord les exigences confirmées par le profil.
- "closing" : la suite proposée (échange, entretien), sobre.

Règles :
- N'utilise que des faits du profil : intitulés, entreprises, dates, chiffres, technologies. Aucun chiffre, aucune durée,
  aucune technologie ni aucun mot-clé de l'offre absents du profil.
- Une exigence classée not_demonstrated ou to_confirm n'est jamais présentée comme acquise ; n'en parle pas.
- Un projet personnel ou une formation reste présenté comme tel, jamais comme une expérience professionnelle.
- Les données personnelles ont été remplacées par des balises ([CANDIDAT]…) : n'en ajoute pas, n'écris ni coordonnées
  ni signature, ni date, ni formule d'appel (« Madame, Monsieur ») : elles sont ajoutées par l'application.
- Ton professionnel, phrases courtes, à la première personne.

${UNTRUSTED_DATA_RULE}`;

/** Vue du profil pour la lettre : identifiants citables, sans coordonnées ni préférences. */
function profileForLetter(profile: ProfileContent) {
  return {
    headline: profile.identity.headline,
    summary: profile.summary,
    experiences: profile.experiences.map((e) => ({ id: e.id, title: e.title, company: e.company, start: e.start, end: e.end, current: e.current, items: e.items })),
    projects: profile.projects,
    education: profile.education,
    certifications: profile.certifications,
    skills: profile.skills.filter((s) => s.level !== "unconfirmed").map(({ id, name, level }) => ({ id, name, level })),
    languages: profile.languages,
  };
}

export function buildLetterUserMessage(
  offer: { title: string; company: string | null },
  requirements: { label: string; importance: string; category: string | null }[],
  profile: ProfileContent,
): string {
  const head = untrustedDocument("job_offer", JSON.stringify({ title: offer.title, company: offer.company, requirements }, null, 1));
  const prof = untrustedDocument("candidate_profile", JSON.stringify(profileForLetter(profile), null, 1));
  return `Offre et couverture des exigences par le profil :\n${head.block}\n\nProfil maître :\n${prof.block}`;
}

export type LetterParagraph = { kind: RawLetter["paragraphs"][number]["kind"]; text: string; sourceIds: string[]; covers: string[]; issues: string[] };
/** Proposition de lettre gardée sur la candidature jusqu'à ce que l'utilisateur la reprenne ou l'écarte. */
export type LetterProposal = { paragraphs: LetterParagraph[]; dropped: number; promptVersion: string; llmCallId: string; createdAt: string };

/**
 * Garde-fou de la proposition :
 * - un paragraphe de fond sans élément du profil existant pour l'appuyer est écarté ;
 * - tout paragraphe est passé au contrôle des faits de la lettre (chiffres, mots-clés de l'offre) ;
 * - une balise de donnée masquée restée dans le texte est signalée.
 * Un paragraphe signalé reste visible avec sa raison, mais n'est pas repris dans la lettre.
 */
export function guardLetter(
  raw: RawLetter,
  profile: ProfileContent,
  offerTerms: string[],
  name: string | null,
  today = new Date(),
): { paragraphs: LetterParagraph[]; dropped: number } {
  const known = new Set([...evidenceElements(profile).map((e) => e.id), ...profile.skills.map((s) => s.id), ...profile.languages.map((l) => l.id)]);
  const kept: LetterParagraph[] = [];
  let dropped = 0;
  for (const p of raw.paragraphs.slice(0, MAX_PARAGRAPHS)) {
    const restored = restorePlaceholders(p.text.trim().slice(0, MAX_PARAGRAPH_CHARS), name);
    const text = restored.value;
    const sourceIds = [...new Set(p.sourceIds.filter((id) => known.has(id)))];
    if (!text || (p.kind === "body" && sourceIds.length === 0)) {
      dropped++;
      continue;
    }
    const issues = [
      ...letterFactCheck(text, profile, offerTerms, today)
        .filter((i) => i.severity === "blocking")
        .map((i) => i.message.replace(/^Lettre : /, "")),
      ...restored.leftovers.map((c) => `contient une donnée masquée (${PII_LABELS[c]}).`),
      ...(text.includes("[CANDIDAT]") ? ["contient la balise du nom."] : []),
    ];
    kept.push({ kind: p.kind, text, sourceIds, covers: p.covers.slice(0, 6), issues });
  }
  dropped += Math.max(0, raw.paragraphs.length - MAX_PARAGRAPHS);
  return { paragraphs: kept, dropped };
}

/** Texte repris dans la lettre : les paragraphes sans signalement, séparés par une ligne vide. */
export function letterText(proposal: LetterProposal): string {
  return proposal.paragraphs
    .filter((p) => p.issues.length === 0)
    .map((p) => p.text)
    .join("\n\n");
}
