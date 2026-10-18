import { normalizeForHash } from "@/lib/text";
import { professionalMonths } from "@/modules/matching/rules";
import { evidenceElements, type ProfileContent } from "@/modules/profile/content";
import type { CvContent } from "./content";

export type FactIssue = { severity: "blocking" | "warning"; sourceId: string | null; message: string };

const NUMBER = /\d+(?:[.,]\d+)?/g;

function numbers(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((n) => n.replace(",", "."));
}

export function containsTerm(text: string, term: string): boolean {
  const t = normalizeForHash(term);
  return t.length > 1 && ` ${normalizeForHash(text)} `.includes(` ${t} `);
}

/**
 * Contrôle des faits d'un CV personnalisé par rapport au profil maître :
 * - bloquant : élément sans source, chiffre absent de la source, mot-clé de l'offre ajouté sans preuve ;
 * - avertissement : compétence non confirmée mise en avant, résumé sans source.
 */
export function factCheck(cv: CvContent, profile: ProfileContent, offerTerms: string[] = [], today = new Date()): FactIssue[] {
  const issues: FactIssue[] = [];
  const elements = new Map(evidenceElements(profile).map((e) => [e.id, e]));
  const skills = new Map(profile.skills.map((s) => [s.id, s]));
  const languages = new Set(profile.languages.map((l) => l.id));

  const checkText = (text: string, sourceText: string, sourceId: string | null, where: string, extraNumbers: string[] = []) => {
    const allowed = new Set([...numbers(sourceText), ...extraNumbers]);
    for (const n of numbers(text)) {
      if (!allowed.has(n)) issues.push({ severity: "blocking", sourceId, message: `${where} : le chiffre « ${n} » n'apparaît pas dans la source.` });
    }
    for (const term of offerTerms) {
      if (containsTerm(text, term) && !containsTerm(sourceText, term)) {
        issues.push({ severity: "blocking", sourceId, message: `${where} : « ${term} » est ajouté sans preuve dans la source.` });
      }
    }
  };

  for (const ce of cv.experiences) {
    const exp = profile.experiences.find((e) => e.id === ce.sourceId);
    if (!exp) {
      issues.push({ severity: "blocking", sourceId: ce.sourceId, message: "Expérience absente du profil maître." });
      continue;
    }
    for (const item of ce.items) {
      const source = exp.items.find((i) => i.id === item.sourceId);
      if (!source) {
        issues.push({ severity: "blocking", sourceId: item.sourceId, message: `${exp.company} : élément sans source dans le profil maître.` });
        continue;
      }
      // Les années de début et de fin du poste sont des faits du profil.
      const years = [exp.start, exp.end].filter((m): m is string => Boolean(m)).map((m) => String(Number(m.slice(0, 4))));
      checkText(item.text, source.text, item.sourceId, exp.company, years);
    }
  }
  for (const p of cv.projects) {
    const source = profile.projects.find((x) => x.id === p.sourceId);
    if (!source) issues.push({ severity: "blocking", sourceId: p.sourceId, message: "Projet absent du profil maître." });
    else checkText(p.description, source.description, p.sourceId, `Projet ${source.name}`);
  }
  for (const id of [...cv.education, ...cv.certifications]) {
    if (!elements.has(id)) issues.push({ severity: "blocking", sourceId: id, message: "Formation ou certification absente du profil maître." });
  }
  for (const id of cv.languages) if (!languages.has(id)) issues.push({ severity: "blocking", sourceId: id, message: "Langue absente du profil maître." });
  for (const id of cv.skills) {
    const s = skills.get(id);
    if (!s) issues.push({ severity: "blocking", sourceId: id, message: "Compétence absente du profil maître." });
    else if (s.level === "unconfirmed") issues.push({ severity: "warning", sourceId: id, message: `Compétence « ${s.name} » mise en avant sans preuve dans le profil.` });
  }
  if (cv.summary) {
    const sources = cv.summary.sourceIds.map((id) => elements.get(id)?.text).filter((t): t is string => Boolean(t));
    const base = [profile.summary ?? "", ...sources, ...profile.skills.filter((s) => s.level !== "unconfirmed").map((s) => s.name)].join(" \n ");
    // Durée d'expérience calculée sur les dates : « 5 ans d'expérience » est un fait vérifiable.
    const totalYears = Math.floor(professionalMonths(profile, today).months / 12);
    const yearsFacts = [String(totalYears), ...profile.experiences.flatMap((e) => [e.start, e.end]).filter((m): m is string => Boolean(m)).map((m) => String(Number(m.slice(0, 4))))];
    checkText(cv.summary.text, base, null, "Résumé", yearsFacts);
    if (!profile.summary && sources.length === 0) issues.push({ severity: "warning", sourceId: null, message: "Résumé sans source : vérifie chaque affirmation." });
  }
  return issues;
}

export function hasBlocking(issues: FactIssue[]): boolean {
  return issues.some((i) => i.severity === "blocking");
}

const TERM_KINDS = new Set(["hard_skill", "tech", "certification", "degree", "language"]);

/**
 * Mots-clés de l'offre à ne pas ajouter sans preuve : intitulés des exigences techniques, découpés
 * (« Spark (Databricks) » → Spark, Databricks). Déterministe, volontairement court.
 */
export function offerTermsFrom(requirements: { kind: string; label: string }[]): string[] {
  const out = new Set<string>();
  for (const r of requirements) {
    if (!TERM_KINDS.has(r.kind)) continue;
    // Un intitulé composé (« Python et SQL ») vaut par ses composants : chacun doit avoir sa preuve.
    const parts = r.label.split(/[()/,;+&]|\s(?:et|ou|and|or)\s/i);
    for (const p of parts) {
      const t = p.trim();
      if (t.length >= 2 && t.length <= 40 && t.split(/\s+/).length <= 4) out.add(t);
    }
  }
  return [...out];
}

/**
 * Contrôle des faits d'une lettre de motivation : texte libre, mais chaque chiffre doit apparaître dans le
 * profil maître (ou être une année ou une durée calculée sur ses dates), et chaque mot-clé de l'offre doit y
 * avoir une preuve.
 */
export function letterFactCheck(text: string, profile: ProfileContent, offerTerms: string[] = [], today = new Date()): FactIssue[] {
  const issues: FactIssue[] = [];
  const sources = [
    profile.summary ?? "",
    ...evidenceElements(profile).map((e) => e.text),
    ...profile.projects.map((p) => p.year ?? ""),
    ...profile.education.map((d) => d.year ?? ""),
    ...profile.certifications.map((c) => c.year ?? ""),
    ...profile.skills.filter((s) => s.level !== "unconfirmed").map((s) => s.name),
    ...profile.languages.map((l) => `${l.name} ${l.level ?? ""}`),
  ].join(" \n ");
  const years = profile.experiences.flatMap((e) => [e.start, e.end]).filter((m): m is string => Boolean(m)).map((m) => String(Number(m.slice(0, 4))));
  const allowed = new Set([...numbers(sources), ...years, String(Math.floor(professionalMonths(profile, today).months / 12))]);
  for (const n of new Set(numbers(text))) {
    if (!allowed.has(n)) issues.push({ severity: "blocking", sourceId: null, message: `Lettre : le chiffre « ${n} » n'apparaît pas dans le profil maître.` });
  }
  for (const term of offerTerms) {
    if (containsTerm(text, term) && !containsTerm(sources, term)) {
      issues.push({ severity: "blocking", sourceId: null, message: `Lettre : « ${term} » est mis en avant sans preuve dans le profil maître.` });
    }
  }
  return issues;
}
