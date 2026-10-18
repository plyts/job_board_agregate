import { normalizeForHash } from "@/modules/offers/normalize";
import type { OfferExtraction } from "./schema";
import type { ExtractedRequirement } from "./schema";

export const MAX_REQUIREMENTS = 80;

/** Texte normalisé caractère par caractère, avec la position d'origine de chaque caractère. */
function indexedNormalize(raw: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const lower = raw[i]!.toLowerCase();
    for (const c of lower) {
      if (/[\p{L}\p{N}]/u.test(c)) {
        text += c;
        map.push(i);
      } else if (text.length > 0 && !text.endsWith(" ")) {
        text += " ";
        map.push(i);
      }
    }
  }
  return { text, map };
}

/**
 * Retrouve une citation dans le texte source, sans tenir compte de la casse ni de la ponctuation.
 * Une citation coupée par « … » doit retrouver chacun de ses fragments, dans l'ordre.
 */
export function locateQuote(raw: string, quote: string): { start: number; end: number } | null {
  const fragments = quote
    .split(/…|\.\.\.|\[\.\.\.\]/)
    .map((f) => normalizeForHash(f))
    .filter((f) => f.length > 0);
  if (fragments.length === 0 || fragments.join("").length < 3) return null;
  const { text, map } = indexedNormalize(raw);
  let from = 0;
  let start = -1;
  let end = -1;
  for (const fragment of fragments) {
    const idx = text.indexOf(fragment, from);
    if (idx === -1) return null;
    if (start === -1) start = map[idx]!;
    end = map[idx + fragment.length - 1]! + 1;
    from = idx + fragment.length;
  }
  return { start, end };
}

export type VerifiedRequirement = ExtractedRequirement & {
  quoteStart: number | null;
  quoteEnd: number | null;
  verificationNote: string | null;
};

export type VerifiedExtraction = Omit<OfferExtraction, "requirements"> & { requirements: VerifiedRequirement[] };

function verifyOne(raw: string, req: ExtractedRequirement): VerifiedRequirement | null {
  const label = req.label.trim();
  if (!label) return null;
  const out: VerifiedRequirement = {
    ...req,
    label,
    value: req.value?.trim() || null,
    quote: req.quote?.trim() || null,
    rationale: req.rationale?.trim() || null,
    minYears: req.kind === "years" && req.minYears !== null && req.minYears >= 0 && req.minYears <= 40 ? req.minYears : null,
    quoteStart: null,
    quoteEnd: null,
    verificationNote: null,
  };
  const located = out.quote ? locateQuote(raw, out.quote) : null;
  if (located) {
    out.quoteStart = located.start;
    out.quoteEnd = located.end;
  }

  if (out.provenance === "explicit") {
    if (!out.quote) {
      out.provenance = "uncertain";
      out.verificationNote = "Présentée comme explicite sans citation : à vérifier.";
    } else if (!located) {
      out.provenance = "uncertain";
      out.verificationNote = "Citation introuvable dans l'annonce : à vérifier.";
      out.quote = null;
    }
  } else {
    if (out.quote && !located) {
      out.verificationNote = "L'extrait cité est introuvable dans l'annonce.";
      out.quote = null;
    }
    if (!out.rationale) {
      out.provenance = "uncertain";
      out.verificationNote = out.verificationNote ?? "Déduction sans justification : à vérifier.";
    }
  }
  return out;
}

/**
 * Contrôle déterministe de la sortie du modèle : toute citation doit exister dans l'annonce,
 * toute déduction doit être justifiée ; sinon l'exigence est déclassée en « incertaine ».
 */
export function verifyExtraction(raw: string, extraction: OfferExtraction): VerifiedExtraction {
  const seen = new Set<string>();
  const requirements: VerifiedRequirement[] = [];
  for (const req of extraction.requirements) {
    const verified = verifyOne(raw, req);
    if (!verified) continue;
    const key = `${verified.kind}:${normalizeForHash(verified.label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push(verified);
    if (requirements.length >= MAX_REQUIREMENTS) break;
  }
  const present = new Set(requirements.map((r) => r.kind));
  return {
    title: extraction.title.trim(),
    company: extraction.company?.trim() || null,
    location: extraction.location?.trim() || null,
    requirements,
    notMentioned: [...new Set(extraction.notMentioned)].filter((k) => !present.has(k)),
  };
}
