import { z } from "zod";
import type { ProfileContent } from "@/modules/profile/content";

const SourceId = z.string().min(4).max(32);
const Text = (max: number) => z.string().trim().max(max);

export const CV_SECTIONS = ["summary", "experiences", "skills", "projects", "education", "certifications", "languages"] as const;
export type CvSection = (typeof CV_SECTIONS)[number];

/**
 * CV personnalisé : une sélection ordonnée d'éléments du profil maître, dont seules les formulations
 * peuvent changer. Chaque élément garde l'identifiant de sa source ; intitulés, entreprises et dates
 * sont toujours relus dans le profil, jamais saisis ici.
 */
export const CvContent = z.object({
  headline: Text(160),
  summary: z.object({ text: Text(1500), sourceIds: z.array(SourceId).max(30) }).nullable(),
  sectionOrder: z.array(z.enum(CV_SECTIONS)).max(CV_SECTIONS.length),
  experiences: z.array(z.object({ sourceId: SourceId, items: z.array(z.object({ sourceId: SourceId, text: Text(600).min(1) })).max(40) })).max(40),
  skills: z.array(SourceId).max(150),
  projects: z.array(z.object({ sourceId: SourceId, description: Text(1200) })).max(40),
  education: z.array(SourceId).max(20),
  certifications: z.array(SourceId).max(40),
  languages: z.array(SourceId).max(15),
});
export type CvContent = z.infer<typeof CvContent>;

/** CV initial : tout le profil prouvé, dans son ordre, avec ses formulations d'origine. */
export function cvFromProfile(profile: ProfileContent): CvContent {
  return {
    headline: profile.identity.headline,
    summary: profile.summary ? { text: profile.summary, sourceIds: [] } : null,
    sectionOrder: [...CV_SECTIONS],
    experiences: profile.experiences.map((e) => ({ sourceId: e.id, items: e.items.map((i) => ({ sourceId: i.id, text: i.text })) })),
    // Une compétence sans preuve n'est montrée que si l'utilisateur l'ajoute lui-même.
    skills: profile.skills.filter((s) => s.level !== "unconfirmed").map((s) => s.id),
    projects: profile.projects.map((p) => ({ sourceId: p.id, description: p.description })),
    education: profile.education.map((d) => d.id),
    certifications: profile.certifications.filter((c) => c.status === "obtained").map((c) => c.id),
    languages: profile.languages.map((l) => l.id),
  };
}

/**
 * Profil restreint au contenu du CV (éléments retenus, formulations du CV), pour recalculer
 * la correspondance avec l'offre sur ce que le recruteur verra réellement.
 */
export function cvAsProfile(cv: CvContent, profile: ProfileContent): ProfileContent {
  const exps = new Map(profile.experiences.map((e) => [e.id, e]));
  const experiences = cv.experiences.flatMap((ce) => {
    const e = exps.get(ce.sourceId);
    if (!e) return [];
    const kinds = new Map(e.items.map((i) => [i.id, i.kind]));
    return [{ ...e, items: ce.items.filter((i) => kinds.has(i.sourceId)).map((i) => ({ id: i.sourceId, kind: kinds.get(i.sourceId)!, text: i.text })) }];
  });
  const projects = new Map(profile.projects.map((p) => [p.id, p]));
  const keep = <T extends { id: string }>(list: T[], ids: string[]) => {
    const byId = new Map(list.map((x) => [x.id, x]));
    return ids.map((id) => byId.get(id)).filter((x): x is T => Boolean(x));
  };
  const visible = new Set<string>([
    ...experiences.flatMap((e) => [e.id, ...e.items.map((i) => i.id)]),
    ...cv.projects.map((p) => p.sourceId),
    ...cv.education,
    ...cv.certifications,
  ]);
  return {
    ...profile,
    summary: cv.summary?.text ?? null,
    experiences,
    projects: cv.projects.flatMap((cp) => {
      const p = projects.get(cp.sourceId);
      return p ? [{ ...p, description: cp.description }] : [];
    }),
    education: keep(profile.education, cv.education),
    certifications: keep(profile.certifications, cv.certifications),
    languages: keep(profile.languages, cv.languages),
    // Une compétence ne vaut que par ses preuves encore visibles dans le CV.
    skills: keep(profile.skills, cv.skills).map((s) => ({ ...s, evidence: s.evidence.filter((id) => visible.has(id)) })),
  };
}

export type RenderedCv = { title: string; lines: string[] }[];

function period(e: { start: string | null; end: string | null; current: boolean }) {
  const f = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : "?");
  return `${f(e.start)} – ${e.current ? "aujourd'hui" : f(e.end)}`;
}

const PROJECT_CONTEXT = { professional: null, personal: "projet personnel", academic: "projet académique" } as const;
const CERT_STATUS = { obtained: "obtenue", in_progress: "en cours", planned: "prévue" } as const;

const SECTION_TITLES: Record<CvSection, string> = {
  summary: "Résumé",
  experiences: "Expérience professionnelle",
  skills: "Compétences",
  projects: "Projets",
  education: "Formation",
  certifications: "Certifications",
  languages: "Langues",
};

/** Rendu texte du CV, base de l'aperçu, du diff et des exports. Les faits viennent toujours du profil. */
export function renderCv(cv: CvContent, profile: ProfileContent): RenderedCv {
  const p = cvAsProfile(cv, profile);
  const out: RenderedCv = [];
  for (const section of cv.sectionOrder) {
    const lines: string[] = [];
    if (section === "summary" && p.summary) lines.push(p.summary);
    if (section === "experiences") {
      for (const e of p.experiences) {
        lines.push(`${e.title} — ${e.company}${e.location ? `, ${e.location}` : ""} (${period(e)})`);
        for (const i of e.items) lines.push(`• ${i.text}`);
      }
    }
    if (section === "skills" && p.skills.length) lines.push(p.skills.map((s) => s.name).join(" · "));
    if (section === "projects") {
      // Le contexte d'un projet personnel ou académique reste visible : il ne passe pas pour une expérience professionnelle.
      for (const pr of p.projects) {
        const meta = [PROJECT_CONTEXT[pr.context], pr.year].filter(Boolean).join(", ");
        lines.push(`${pr.name}${meta ? ` (${meta})` : ""} : ${pr.description}`);
      }
    }
    if (section === "education") for (const d of p.education) lines.push([d.degree, d.school, d.year].filter(Boolean).join(" — "));
    if (section === "certifications") {
      for (const c of p.certifications) lines.push(`${c.name}${c.status === "obtained" ? (c.year ? ` (${c.year})` : "") : ` (${CERT_STATUS[c.status]})`}`);
    }
    if (section === "languages") for (const l of p.languages) lines.push(`${l.name}${l.level ? ` : ${l.level}` : ""}`);
    if (lines.length) out.push({ title: SECTION_TITLES[section], lines });
  }
  return out;
}

export { SECTION_TITLES };
