import { z } from "zod";
import { evidenceElements, type ProfileContent } from "@/modules/profile/content";
import { UNTRUSTED_DATA_RULE, untrustedDocument } from "@/modules/platform/llm/untrusted";
import { MATCH_CATEGORIES, type MatchCategory } from "./score";

export const MATCH_PROMPT_VERSION = "match-v1";
export const MATCH_SCHEMA_VERSION = 1;

export const MatchJudgement = z.object({
  items: z.array(
    z.object({
      requirementRef: z.string(),
      category: z.enum(MATCH_CATEGORIES),
      evidenceIds: z.array(z.string()).describe("Identifiants d'éléments du profil qui démontrent l'exigence"),
      rationale: z.string().describe("Une phrase : pourquoi cette catégorie"),
      action: z.string().describe("Action utile et honnête pour le candidat"),
    }),
  ),
});
export type MatchJudgement = z.infer<typeof MatchJudgement>;

export const MATCH_SYSTEM = `Tu compares les exigences d'une offre d'emploi au profil vérifié d'un candidat.

Pour chaque exigence, choisis une catégorie :
- "confirmed" : le profil démontre l'exigence par une expérience, une réalisation, une formation ou une certification.
- "partial" : démontrée en partie (niveau, durée ou contexte inférieurs, projet personnel seulement).
- "to_confirm" : rien ne permet de conclure ; l'information manque dans le profil.
- "not_demonstrated" : le profil ne contient rien qui la démontre.
- "potential_incompatibility" : une condition (lieu, télétravail, contrat, salaire) contredit les préférences du candidat.
- "not_applicable" : l'exigence ne concerne pas le candidat.

Règles :
- Cite dans evidenceIds uniquement des identifiants présents dans le profil ("id"). Sans preuve, la catégorie ne peut pas être "confirmed" ni "partial".
- Une compétence simplement listée (niveau "unconfirmed") ne prouve rien. Un mot-clé présent ne prouve pas une maîtrise.
- Une information inconnue n'est pas une lacune : préfère "to_confirm" à "not_demonstrated" quand le profil est muet.
- L'action ne doit jamais suggérer d'inventer ou d'exagérer une expérience.
- Réponds pour chaque exigence, en reprenant son requirementRef.

${UNTRUSTED_DATA_RULE}`;

export type RequirementInput = { ref: string; kind: string; importance: string; label: string; value: string | null };

/** Profil transmis au modèle : sans identité ni coordonnées. */
export function profileForModel(content: ProfileContent) {
  return {
    experiences: content.experiences.map((e) => ({ id: e.id, title: e.title, company: e.company, start: e.start, end: e.end, current: e.current, items: e.items })),
    projects: content.projects,
    education: content.education,
    certifications: content.certifications,
    languages: content.languages.map(({ name, level }) => ({ name, level })),
    skills: content.skills.map(({ name, level, evidence }) => ({ name, level, evidence })),
    preferences: content.preferences,
  };
}

export function buildMatchUserMessage(requirements: RequirementInput[], content: ProfileContent): string {
  const offer = untrustedDocument("job_requirements", JSON.stringify(requirements, null, 1));
  const profile = untrustedDocument("candidate_profile", JSON.stringify(profileForModel(content), null, 1));
  return `Exigences de l'offre :\n${offer.block}\n\nProfil du candidat :\n${profile.block}`;
}

export type JudgedItem = { category: MatchCategory; evidenceIds: string[]; rationale: string; action: string; source: "model" | "guard" };

/**
 * Garde-fous appliqués au jugement du modèle : preuves inexistantes retirées, « confirmée » ou « partielle »
 * sans preuve déclassées, preuve uniquement issue de projets personnels ou académiques plafonnée à « partielle ».
 */
export function guardJudgement(raw: MatchJudgement["items"][number], content: ProfileContent): JudgedItem {
  const elements = new Map(evidenceElements(content).map((e) => [e.id, e]));
  const evidenceIds = [...new Set(raw.evidenceIds.filter((id) => elements.has(id)))];
  let { category } = raw;
  let rationale = raw.rationale.trim() || "Sans justification.";
  let source: JudgedItem["source"] = "model";

  if ((category === "confirmed" || category === "partial") && evidenceIds.length === 0) {
    category = "to_confirm";
    rationale = `${rationale} (Aucune preuve vérifiable dans le profil : à confirmer.)`;
    source = "guard";
  } else if (category === "confirmed") {
    const projectIds = new Set(content.projects.filter((p) => p.context !== "professional").map((p) => p.id));
    if (evidenceIds.every((id) => projectIds.has(id))) {
      category = "partial";
      rationale = `${rationale} (Preuve issue uniquement d'un projet personnel ou académique.)`;
      source = "guard";
    }
  }
  return { category, evidenceIds, rationale, action: raw.action.trim() || "—", source };
}
