import { z } from "zod";

/**
 * Identifiant court et stable d'un élément du profil, cité comme preuve par les compétences, le matching et le CV.
 * Utilisable côté serveur comme dans le navigateur (Web Crypto).
 */
export function newElementId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const Id = z.string().min(4).max(32).regex(/^[A-Za-z0-9_-]+$/);
const Text = (max: number) => z.string().trim().max(max);
const MonthOrNull = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Date au format AAAA-MM")
  .nullable();

export const SKILL_LEVELS = ["mastered", "occasional", "learning", "unconfirmed"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const ExperienceItem = z.object({ id: Id, kind: z.enum(["mission", "achievement"]), text: Text(600).min(1) });

export const Experience = z.object({
  id: Id,
  title: Text(160).min(1),
  company: Text(160).min(1),
  location: Text(120).nullable(),
  start: MonthOrNull,
  end: MonthOrNull,
  current: z.boolean(),
  items: z.array(ExperienceItem).max(40),
});

export const Education = z.object({ id: Id, degree: Text(200).min(1), school: Text(200).nullable(), year: Text(20).nullable() });
export const Certification = z.object({
  id: Id,
  name: Text(200).min(1),
  issuer: Text(120).nullable(),
  year: Text(20).nullable(),
  status: z.enum(["obtained", "in_progress", "planned"]),
});
export const Project = z.object({
  id: Id,
  name: Text(160).min(1),
  context: z.enum(["professional", "personal", "academic"]),
  description: Text(1200),
  year: Text(20).nullable(),
});
export const Language = z.object({ id: Id, name: Text(60).min(1), level: Text(60).nullable() });
export const Skill = z.object({
  id: Id,
  name: Text(80).min(1),
  level: z.enum(SKILL_LEVELS),
  /** Identifiants d'expériences, d'éléments d'expérience, de projets, de formations ou de certifications. */
  evidence: z.array(Id).max(20),
});

export const ProfileContent = z.object({
  identity: z.object({
    fullName: Text(120),
    headline: Text(160),
    location: Text(120).nullable(),
    // Coordonnées : conservées pour le CV, jamais envoyées à un modèle.
    email: Text(200).nullable(),
    phone: Text(40).nullable(),
    links: z.array(Text(300)).max(10),
  }),
  summary: Text(2000).nullable(),
  experiences: z.array(Experience).max(40),
  education: z.array(Education).max(20),
  certifications: z.array(Certification).max(40),
  projects: z.array(Project).max(40),
  languages: z.array(Language).max(15),
  skills: z.array(Skill).max(150),
  preferences: z.object({
    targetTitles: z.array(Text(120)).max(10),
    locations: z.array(Text(120)).max(10),
    remote: Text(200).nullable(),
    contracts: z.array(Text(60)).max(10),
    minSalary: Text(60).nullable(),
    exclusions: z.array(Text(120)).max(20),
  }),
});
export type ProfileContent = z.infer<typeof ProfileContent>;

export function emptyProfile(): ProfileContent {
  return {
    identity: { fullName: "", headline: "", location: null, email: null, phone: null, links: [] },
    summary: null,
    experiences: [],
    education: [],
    certifications: [],
    projects: [],
    languages: [],
    skills: [],
    preferences: { targetTitles: [], locations: [], remote: null, contracts: [], minSalary: null, exclusions: [] },
  };
}

export type ElementRef = { id: string; kind: "experience" | "experience_item" | "education" | "certification" | "project"; label: string; text: string };

/** Tous les éléments citables comme preuve, avec un libellé lisible. */
export function evidenceElements(content: ProfileContent): ElementRef[] {
  const out: ElementRef[] = [];
  for (const e of content.experiences) {
    out.push({ id: e.id, kind: "experience", label: `${e.title} · ${e.company}`, text: `${e.title} chez ${e.company}` });
    for (const item of e.items) out.push({ id: item.id, kind: "experience_item", label: `${e.company} : ${item.text.slice(0, 60)}`, text: item.text });
  }
  for (const p of content.projects) out.push({ id: p.id, kind: "project", label: `Projet ${p.name}`, text: `${p.name} : ${p.description}` });
  for (const d of content.education) out.push({ id: d.id, kind: "education", label: d.degree, text: [d.degree, d.school].filter(Boolean).join(", ") });
  for (const c of content.certifications) out.push({ id: c.id, kind: "certification", label: c.name, text: c.name });
  return out;
}

/** Durée d'une expérience en mois (fin incluse), ou null si les dates sont inconnues. */
export function experienceMonths(e: { start: string | null; end: string | null; current: boolean }, today = new Date()): number | null {
  if (!e.start) return null;
  const [sy, sm] = e.start.split("-").map(Number) as [number, number];
  let ey: number;
  let em: number;
  if (e.current || !e.end) {
    if (!e.current) return null;
    ey = today.getFullYear();
    em = today.getMonth() + 1;
  } else {
    [ey, em] = e.end.split("-").map(Number) as [number, number];
  }
  const months = (ey - sy) * 12 + (em - sm) + 1;
  return months > 0 ? months : null;
}

/**
 * Règles qui bloquent la validation d'une version : identité minimale, dates cohérentes,
 * identifiants uniques, et aucune compétence revendiquée sans preuve.
 */
export function validationProblems(content: ProfileContent): string[] {
  const problems: string[] = [];
  if (!content.identity.fullName) problems.push("Renseigne ton nom.");
  const ids = new Set<string>();
  const all = evidenceElements(content).map((e) => e.id).concat(content.skills.map((s) => s.id), content.languages.map((l) => l.id));
  for (const id of all) {
    if (ids.has(id)) problems.push(`Identifiant en double : ${id}.`);
    ids.add(id);
  }
  for (const e of content.experiences) {
    if (e.current && e.end) problems.push(`« ${e.title} » : un poste en cours n'a pas de date de fin.`);
    if (e.start && e.end && e.end < e.start) problems.push(`« ${e.title} » : la date de fin précède la date de début.`);
  }
  const citable = new Set(evidenceElements(content).map((e) => e.id));
  for (const s of content.skills) {
    const unknown = s.evidence.filter((id) => !citable.has(id));
    if (unknown.length) problems.push(`Compétence « ${s.name} » : preuve introuvable.`);
    if (s.level !== "unconfirmed" && s.evidence.length === 0) {
      problems.push(`Compétence « ${s.name} » : un niveau autre que « non confirmée » exige au moins une preuve.`);
    }
  }
  return problems;
}
