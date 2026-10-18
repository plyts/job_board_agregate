import { z } from "zod";
import { UNTRUSTED_DATA_RULE, untrustedDocument } from "@/modules/platform/llm/untrusted";
import { evidenceElements, type ProfileContent } from "@/modules/profile/content";
import type { CvContent } from "./content";
import { factCheck } from "./factcheck";

export const SUGGEST_PROMPT_VERSION = "cv-suggest-v2";
export const SUGGEST_SCHEMA_VERSION = 1;

export const SuggestionBatch = z.object({
  suggestions: z.array(
    z.object({
      kind: z.enum(["rephrase", "summary", "reorder_items", "include"]),
      targetId: z.string().nullable().describe("rephrase : id de la puce ; reorder_items : id de l'expérience ; include : id de l'élément du profil à ajouter"),
      text: z.string().nullable().describe("Nouvelle formulation (rephrase, summary)"),
      order: z.array(z.string()).nullable().describe("reorder_items : ids des puces dans le nouvel ordre"),
      sourceIds: z.array(z.string()).describe("Éléments du profil qui justifient la suggestion"),
      rationale: z.string(),
      covers: z.string().nullable().describe("Exigence de l'offre mieux couverte, telle qu'écrite"),
    }),
  ),
});
export type RawSuggestion = z.infer<typeof SuggestionBatch>["suggestions"][number];

export const SUGGEST_SYSTEM = `Tu aides un candidat à adapter son CV à une offre, sans jamais rien inventer.

Tu peux proposer :
- "rephrase" : reformuler une puce existante (targetId) pour qu'elle reprenne les termes de l'offre, à faits identiques ;
- "summary" : un résumé de 2 à 3 phrases, appuyé sur des éléments du profil cités dans sourceIds ;
- "reorder_items" : réordonner les puces d'une expérience (targetId) pour mettre en premier ce que l'offre demande ;
- "include" : ajouter au CV un élément du profil maître qui n'y figure pas (targetId : puce d'expérience, projet, compétence ou certification).

Bonnes pratiques à viser (sans jamais inventer) :
- chaque puce commence par un nom d'action ou un verbe au passé (Pilotage, Conception, Réduction, Développé…), jamais par « En charge de », « Responsable de » ou « Participation à » ;
- montrer l'impact : garder et mettre en avant les chiffres présents dans la source (volume, %, délai, budget) ; ne jamais en ajouter ;
- reprendre les mots-clés de l'offre uniquement quand l'élément source les contient déjà ;
- 3 à 5 puces par poste, d'une à deux lignes chacune ; les plus pertinentes pour l'offre en premier.

Interdits : ajouter un chiffre, une technologie, une durée ou un niveau absents de la source ; transformer un projet personnel
ou une connaissance théorique en expérience professionnelle ; ajouter un mot-clé de l'offre que la source ne contient pas.
Cite toujours dans sourceIds les éléments du profil qui fondent la suggestion. 3 à 8 suggestions, les plus utiles d'abord.

${UNTRUSTED_DATA_RULE}`;

/** Vue du profil pour le modèle : identifiants citables, sans coordonnées ni préférences. */
function profileForSuggest(profile: ProfileContent) {
  return {
    summary: profile.summary,
    experiences: profile.experiences.map((e) => ({ id: e.id, title: e.title, company: e.company, start: e.start, end: e.end, current: e.current, items: e.items })),
    projects: profile.projects,
    education: profile.education,
    certifications: profile.certifications,
    skills: profile.skills.map(({ id, name, level, evidence }) => ({ id, name, level, evidence })),
  };
}

/** Vue du CV pour le modèle : les compétences y sont nommées, pas seulement référencées. */
function cvForSuggest(cv: CvContent, profile: ProfileContent) {
  const skills = new Map(profile.skills.map((s) => [s.id, s.name]));
  return {
    headline: cv.headline,
    summary: cv.summary?.text ?? null,
    experiences: cv.experiences,
    projects: cv.projects,
    skills: cv.skills.map((id) => ({ id, name: skills.get(id) ?? "?" })),
    certifications: cv.certifications,
  };
}

export function buildSuggestUserMessage(
  requirements: { label: string; importance: string; category: string | null }[],
  cv: CvContent,
  profile: ProfileContent,
): string {
  const offer = untrustedDocument("job_requirements", JSON.stringify(requirements, null, 1));
  const prof = untrustedDocument("candidate_profile", JSON.stringify(profileForSuggest(profile), null, 1));
  const current = untrustedDocument("current_cv", JSON.stringify(cvForSuggest(cv, profile), null, 1));
  return `Exigences de l'offre et couverture actuelle :\n${offer.block}\n\nProfil maître :\n${prof.block}\n\nCV actuel :\n${current.block}`;
}

export type Suggestion = {
  kind: RawSuggestion["kind"];
  targetId: string | null;
  text: string | null;
  order: string[] | null;
  sourceIds: string[];
  rationale: string;
  covers: string | null;
};

/** Applique une suggestion à un CV ; renvoie null si elle ne s'applique plus (élément absent, ordre incomplet…). */
export function applySuggestion(cv: CvContent, s: Suggestion, profile: ProfileContent): { cv: CvContent; before: unknown } | null {
  const next = structuredClone(cv);
  if (s.kind === "rephrase" && s.targetId && s.text) {
    for (const e of next.experiences) {
      const item = e.items.find((i) => i.sourceId === s.targetId);
      if (item) {
        const before = item.text;
        item.text = s.text.trim();
        return { cv: next, before };
      }
    }
    const project = next.projects.find((p) => p.sourceId === s.targetId);
    if (project) {
      const before = project.description;
      project.description = s.text.trim();
      return { cv: next, before };
    }
    return null;
  }
  if (s.kind === "summary" && s.text) {
    const before = next.summary;
    next.summary = { text: s.text.trim(), sourceIds: s.sourceIds };
    if (!next.sectionOrder.includes("summary")) next.sectionOrder.unshift("summary");
    return { cv: next, before };
  }
  if (s.kind === "reorder_items" && s.targetId && s.order) {
    const exp = next.experiences.find((e) => e.sourceId === s.targetId);
    if (!exp) return null;
    const current = exp.items.map((i) => i.sourceId);
    if (s.order.length !== current.length || [...s.order].sort().join() !== [...current].sort().join()) return null;
    const byId = new Map(exp.items.map((i) => [i.sourceId, i]));
    exp.items = s.order.map((id) => byId.get(id)!);
    return { cv: next, before: current };
  }
  if (s.kind === "include" && s.targetId) {
    const id = s.targetId;
    const skill = profile.skills.find((x) => x.id === id);
    if (skill && !next.skills.includes(id)) {
      next.skills.push(id);
      return { cv: next, before: null };
    }
    for (const e of profile.experiences) {
      const item = e.items.find((i) => i.id === id);
      if (!item) continue;
      let exp = next.experiences.find((x) => x.sourceId === e.id);
      if (!exp) {
        exp = { sourceId: e.id, items: [] };
        next.experiences.push(exp);
      }
      if (exp.items.some((i) => i.sourceId === id)) return null;
      exp.items.push({ sourceId: id, text: item.text });
      return { cv: next, before: null };
    }
    const project = profile.projects.find((p) => p.id === id);
    if (project && !next.projects.some((p) => p.sourceId === id)) {
      next.projects.push({ sourceId: id, description: project.description });
      return { cv: next, before: null };
    }
    const cert = profile.certifications.find((c) => c.id === id);
    if (cert && !next.certifications.includes(id)) {
      next.certifications.push(id);
      return { cv: next, before: null };
    }
    return null;
  }
  return null;
}

/**
 * Annule une suggestion acceptée à partir de l'état mémorisé. Renvoie null si l'élément a été modifié
 * depuis : l'annulation écraserait une saisie de l'utilisateur.
 */
export function revertSuggestion(cv: CvContent, s: Suggestion, before: unknown): CvContent | null {
  const next = structuredClone(cv);
  if (s.kind === "rephrase") {
    if (typeof before !== "string") return null;
    const item = next.experiences.flatMap((e) => e.items).find((i) => i.sourceId === s.targetId);
    const project = next.projects.find((p) => p.sourceId === s.targetId);
    if (item && item.text === s.text) item.text = before;
    else if (project && project.description === s.text) project.description = before;
    else return null;
    return next;
  }
  if (s.kind === "summary") {
    if (next.summary?.text !== s.text) return null;
    next.summary = (before as CvContent["summary"]) ?? null;
    return next;
  }
  if (s.kind === "reorder_items") {
    const exp = next.experiences.find((e) => e.sourceId === s.targetId);
    if (!exp || !Array.isArray(before) || exp.items.map((i) => i.sourceId).join() !== (s.order ?? []).join()) return null;
    const byId = new Map(exp.items.map((i) => [i.sourceId, i]));
    exp.items = (before as string[]).map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
    return next;
  }
  if (s.kind === "include" && s.targetId) {
    const id = s.targetId;
    next.skills = next.skills.filter((x) => x !== id);
    next.projects = next.projects.filter((p) => p.sourceId !== id);
    next.certifications = next.certifications.filter((x) => x !== id);
    for (const e of next.experiences) e.items = e.items.filter((i) => i.sourceId !== id);
    next.experiences = next.experiences.filter((e) => e.items.length > 0 || cv.experiences.find((x) => x.sourceId === e.sourceId)!.items.length === 0);
    return next;
  }
  return null;
}

export type GuardedSuggestion = Suggestion & { state: "pending" | "blocked"; blockReason: string | null };

/**
 * Filtre les suggestions du modèle :
 * - sources inexistantes retirées ; une suggestion sans aucune source vérifiable est écartée, jamais affichée ;
 * - suggestion qui ne s'applique pas au CV actuel écartée ;
 * - suggestion qui introduirait un fait absent de la source bloquée, et affichée comme telle.
 */
export function guardSuggestions(raw: RawSuggestion[], cv: CvContent, profile: ProfileContent, offerTerms: string[], today = new Date()): GuardedSuggestion[] {
  const known = new Set([...evidenceElements(profile).map((e) => e.id), ...profile.skills.map((s) => s.id)]);
  const out: GuardedSuggestion[] = [];
  for (const r of raw) {
    const s: Suggestion = {
      kind: r.kind,
      targetId: r.targetId,
      text: r.text?.trim() || null,
      order: r.order,
      sourceIds: [...new Set([...(r.targetId ? [r.targetId] : []), ...r.sourceIds])].filter((id) => known.has(id)),
      rationale: r.rationale.trim() || "—",
      covers: r.covers?.trim() || null,
    };
    if (s.sourceIds.length === 0) continue;
    const verdict = checkSuggestion(cv, s, profile, offerTerms, today);
    if (verdict === "inapplicable") continue;
    out.push(verdict.ok ? { ...s, state: "pending", blockReason: null } : { ...s, state: "blocked", blockReason: verdict.reason });
  }
  return out;
}

/** Vérifie une suggestion (du modèle ou modifiée par l'utilisateur) avant de l'appliquer au CV. */
export function checkSuggestion(
  cv: CvContent,
  s: Suggestion,
  profile: ProfileContent,
  offerTerms: string[],
  today = new Date(),
): "inapplicable" | { ok: true; cv: CvContent; before: unknown } | { ok: false; reason: string } {
  if (s.kind === "include" && s.targetId) {
    const skill = profile.skills.find((x) => x.id === s.targetId);
    if (skill && skill.level === "unconfirmed") return { ok: false, reason: `« ${skill.name} » n'a aucune preuve dans le profil maître.` };
  }
  const applied = applySuggestion(cv, s, profile);
  if (!applied) return "inapplicable";
  const baseline = new Set(factCheck(cv, profile, offerTerms, today).map((i) => i.message));
  const added = factCheck(applied.cv, profile, offerTerms, today).filter((i) => i.severity === "blocking" && !baseline.has(i.message));
  return added.length ? { ok: false, reason: added.map((i) => i.message).join(" ") } : { ok: true, ...applied };
}
