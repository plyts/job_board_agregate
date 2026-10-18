import mammoth from "mammoth";
import { z } from "zod";
import { FileImportError } from "@/modules/offers/files";
import { cleanText, normalizeForHash } from "@/modules/offers/normalize";
import { UNTRUSTED_DATA_RULE, untrustedDocument } from "@/modules/platform/llm/untrusted";
import { extractText, getDocumentProxy } from "unpdf";
import type { ProfileUncertainty } from "@/db/schema";
import { emptyProfile, newElementId, SKILL_LEVELS, type ProfileContent } from "./content";

export const MAX_CV_BYTES = 10 * 1024 * 1024;
export const PROFILE_PROMPT_VERSION = "profile-extract-v1";
export const PROFILE_SCHEMA_VERSION = 1;

export type CvFile = { text: string; extension: "pdf" | "docx" };

/** Lit un CV PDF ou DOCX ; le type est déduit de la signature du fichier, jamais de son nom. */
export async function readCvFile(bytes: Buffer): Promise<CvFile> {
  if (bytes.byteLength > MAX_CV_BYTES) throw new FileImportError("too_large", "Fichier trop volumineux (10 Mo maximum)");
  let text: string;
  let extension: CvFile["extension"];
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    extension = "pdf";
    try {
      const result = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } catch {
      throw new FileImportError("unreadable", "PDF illisible ou protégé");
    }
  } else if (bytes.subarray(0, 4).toString("latin1") === "PK\u0003\u0004") {
    extension = "docx";
    try {
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } catch {
      throw new FileImportError("unreadable", "Document Word illisible");
    }
  } else {
    throw new FileImportError("unsupported_type", "Format non pris en charge : PDF ou DOCX uniquement");
  }
  const cleaned = cleanText(text);
  if (cleaned.length < 80) {
    throw new FileImportError("empty", extension === "pdf" ? "Aucun texte trouvé : le PDF est peut-être une image scannée" : "Document vide");
  }
  return { text: cleaned, extension };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Numéros français et internationaux (+33 6 12 34 56 78, 06.12.34.56.78, +1 415 555 0100…).
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){3,5}\d{2,4}/g;

/**
 * Retire e-mails et téléphones avant tout envoi à un modèle (minimisation) ; ils sont relevés localement.
 */
export function redactContacts(text: string): { redacted: string; email: string | null; phone: string | null } {
  const email = text.match(EMAIL)?.[0] ?? null;
  let phone: string | null = null;
  const redacted = text.replace(EMAIL, "[e-mail]").replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, "");
    // Une suite d'années (« 2019 – 2021 2022 ») n'est pas un numéro.
    if (digits.length < 9 || digits.length > 15 || /^(?:(?:19|20)\d{2}[\s.-]*)+$/.test(m.trim())) return m;
    phone ??= m.trim();
    return "[téléphone]";
  });
  return { redacted, email, phone };
}

const Month = z.string().nullable().describe("Format AAAA-MM, null si inconnu");

export const ProfileExtraction = z.object({
  fullName: z.string(),
  headline: z.string().describe("Titre professionnel tel qu'écrit dans le CV"),
  location: z.string().nullable(),
  summary: z.string().nullable(),
  experiences: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string().nullable(),
      start: Month,
      end: Month,
      current: z.boolean(),
      missions: z.array(z.string()),
      achievements: z.array(z.string()).describe("Réalisations concrètes, chiffrées si le CV les chiffre"),
    }),
  ),
  education: z.array(z.object({ degree: z.string(), school: z.string().nullable(), year: z.string().nullable() })),
  certifications: z.array(
    z.object({ name: z.string(), issuer: z.string().nullable(), year: z.string().nullable(), status: z.enum(["obtained", "in_progress", "planned"]) }),
  ),
  projects: z.array(z.object({ name: z.string(), context: z.enum(["professional", "personal", "academic"]), description: z.string(), year: z.string().nullable() })),
  languages: z.array(z.object({ name: z.string(), level: z.string().nullable() })),
  skills: z.array(
    z.object({
      name: z.string(),
      level: z.enum(SKILL_LEVELS),
      evidence: z
        .array(z.object({ section: z.enum(["experience", "project", "education", "certification"]), index: z.number().int() }))
        .describe("Éléments du CV qui démontrent la compétence (index dans la liste correspondante)"),
    }),
  ),
  uncertainties: z.array(z.object({ field: z.string(), note: z.string() })),
});
export type ProfileExtraction = z.infer<typeof ProfileExtraction>;

export const PROFILE_SYSTEM = `Tu structures le CV d'un candidat pour en faire un profil professionnel vérifiable.

Règles :
- Reprends uniquement ce qui est écrit dans le CV. N'invente ni expérience, ni compétence, ni diplôme, ni chiffre.
- Dates au format AAAA-MM ; null si le mois ou l'année manquent. current = true seulement si le poste est indiqué comme en cours.
- Sépare les missions (ce que la personne faisait) des réalisations (résultats concrets).
- Compétences : niveau "mastered" si elle est utilisée de façon répétée dans des expériences professionnelles,
  "occasional" si elle apparaît ponctuellement, "learning" si le CV indique une formation en cours ou un projet d'apprentissage,
  "unconfirmed" si elle est seulement listée sans élément qui la démontre. Pour chaque compétence, cite dans evidence
  les expériences, projets, formations ou certifications qui la démontrent ; liste vide si aucune.
- Signale dans uncertainties tout point ambigu (date illisible, poste peut-être terminé, intitulé incertain).
- Les coordonnées ont été masquées : ne les reconstitue pas.

${UNTRUSTED_DATA_RULE}`;

export function buildProfileUserMessage(redactedCv: string): string {
  return `Structure le CV suivant.\n\n${untrustedDocument("cv", redactedCv).block}`;
}

function month(v: string | null): string | null {
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

function mentioned(source: string, value: string): boolean {
  const n = normalizeForHash(value);
  return n.length < 2 || normalizeForHash(source).includes(n);
}

/**
 * Convertit l'extraction en contenu de profil avec identifiants stables, et relève ce qui doit être vérifié :
 * entreprises ou compétences absentes du CV source, dates illisibles, preuves invalides.
 */
export function toProfileContent(
  extraction: ProfileExtraction,
  sourceText: string,
  contacts: { email: string | null; phone: string | null },
): { content: ProfileContent; uncertainties: ProfileUncertainty[] } {
  const uncertainties: ProfileUncertainty[] = extraction.uncertainties.map((u) => ({ id: newElementId(), field: u.field, note: u.note }));
  const flag = (field: string, note: string) => uncertainties.push({ id: newElementId(), field, note });
  const content = emptyProfile();
  content.identity = {
    fullName: extraction.fullName.trim(),
    headline: extraction.headline.trim(),
    location: extraction.location?.trim() || null,
    email: contacts.email,
    phone: contacts.phone,
    links: [],
  };
  content.summary = extraction.summary?.trim() || null;

  const ids = { experience: [] as string[], project: [] as string[], education: [] as string[], certification: [] as string[] };
  for (const e of extraction.experiences) {
    const id = newElementId();
    ids.experience.push(id);
    if (!mentioned(sourceText, e.company)) flag(`Expérience ${e.title}`, `Entreprise « ${e.company} » introuvable dans le CV source.`);
    if ((e.start && !month(e.start)) || (e.end && !month(e.end))) flag(`Expérience ${e.title}`, "Dates illisibles : à compléter.");
    content.experiences.push({
      id,
      title: e.title.trim() || "Poste sans intitulé",
      company: e.company.trim() || "Entreprise inconnue",
      location: e.location?.trim() || null,
      start: month(e.start),
      end: e.current ? null : month(e.end),
      current: e.current,
      items: [
        ...e.missions.filter((t) => t.trim()).map((text) => ({ id: newElementId(), kind: "mission" as const, text: text.trim() })),
        ...e.achievements.filter((t) => t.trim()).map((text) => ({ id: newElementId(), kind: "achievement" as const, text: text.trim() })),
      ],
    });
  }
  for (const p of extraction.projects) {
    const id = newElementId();
    ids.project.push(id);
    content.projects.push({ id, name: p.name.trim(), context: p.context, description: p.description.trim(), year: p.year?.trim() || null });
  }
  for (const d of extraction.education) {
    const id = newElementId();
    ids.education.push(id);
    content.education.push({ id, degree: d.degree.trim(), school: d.school?.trim() || null, year: d.year?.trim() || null });
  }
  for (const c of extraction.certifications) {
    const id = newElementId();
    ids.certification.push(id);
    if (!mentioned(sourceText, c.name)) flag(`Certification ${c.name}`, "Certification introuvable dans le CV source.");
    content.certifications.push({ id, name: c.name.trim(), issuer: c.issuer?.trim() || null, year: c.year?.trim() || null, status: c.status });
  }
  content.languages = extraction.languages.map((l) => ({ id: newElementId(), name: l.name.trim(), level: l.level?.trim() || null }));

  const seen = new Set<string>();
  for (const s of extraction.skills) {
    const key = normalizeForHash(s.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const evidence = s.evidence
      .map((ev) => ids[ev.section][ev.index])
      .filter((id): id is string => typeof id === "string");
    // Règle : sans preuve, une compétence n'est jamais présentée comme maîtrisée.
    const level = evidence.length === 0 ? "unconfirmed" : s.level;
    if (!mentioned(sourceText, s.name)) flag(`Compétence ${s.name}`, "Compétence absente du CV source : à confirmer ou supprimer.");
    content.skills.push({ id: newElementId(), name: s.name.trim(), level, evidence: [...new Set(evidence)] });
  }
  return { content, uncertainties };
}
