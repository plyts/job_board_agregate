/**
 * Masquage des données personnelles avant tout envoi à un modèle, et inspection de ses réponses.
 * Tout se fait localement, sans appel réseau. Les règles sont versionnées pour que chaque rapport
 * enregistré dise avec quelles règles il a été produit.
 */
export const PII_RULES_VERSION = 1;

export const PII_CATEGORIES = [
  "name",
  "email",
  "phone",
  "address",
  "postal_code",
  "birth_date",
  "age",
  "nationality",
  "family",
  "nir",
  "iban",
  "personal_link",
  "sensitive",
] as const;
export type PiiCategory = (typeof PII_CATEGORIES)[number];

export const PII_LABELS: Record<PiiCategory, string> = {
  name: "nom et prénom",
  email: "adresse e-mail",
  phone: "numéro de téléphone",
  address: "adresse postale",
  postal_code: "code postal",
  birth_date: "date de naissance",
  age: "âge",
  nationality: "nationalité",
  family: "situation familiale",
  nir: "numéro de sécurité sociale",
  iban: "coordonnées bancaires",
  personal_link: "lien personnel (LinkedIn, GitHub…)",
  sensitive: "donnée sensible (santé, religion, opinions…)",
};

export const PII_PLACEHOLDERS: Record<PiiCategory, string> = {
  name: "[CANDIDAT]",
  email: "[E-MAIL]",
  phone: "[TÉLÉPHONE]",
  address: "[ADRESSE]",
  postal_code: "[CODE POSTAL]",
  birth_date: "[DATE DE NAISSANCE]",
  age: "[ÂGE]",
  nationality: "[NATIONALITÉ]",
  family: "[SITUATION FAMILIALE]",
  nir: "[N° SÉCURITÉ SOCIALE]",
  iban: "[IBAN]",
  personal_link: "[LIEN PERSONNEL]",
  sensitive: "[DONNÉE SENSIBLE]",
};

export type PiiCounts = Partial<Record<PiiCategory, number>>;
export type RedactionResult = {
  text: string;
  counts: PiiCounts;
  /** Valeurs relevées localement pour être réinjectées après l'appel ; jamais envoyées ni journalisées. */
  found: { email: string | null; phone: string | null; name: string | null };
};

const MONTHS = "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december";
const DATE = `\\d{1,2}[\\/.\\- ](?:\\d{1,2}|${MONTHS})[\\/.\\- ]\\d{2,4}`;
const STREET = "rue|avenue|av\\.|boulevard|bd|chemin|allée|allee|impasse|place|quai|route|cours|square|résidence|residence|lotissement|lieu-dit|street|st\\.|road|rd\\.|lane";

/** Ordre d'application : les motifs les plus spécifiques d'abord (un NIR ne doit pas devenir un téléphone). */
const RULES: { category: PiiCategory; pattern: RegExp; keep?: (m: string) => boolean }[] = [
  { category: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { category: "personal_link", pattern: /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:linkedin\.com\/in|github\.com|gitlab\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|behance\.net|dribbble\.com|medium\.com\/@)[^\s,;)]*/gi },
  { category: "iban", pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  // NIR : sexe, année, mois, département (dont 2A/2B), commune, ordre, clé facultative.
  { category: "nir", pattern: /\b[12][ .]?\d{2}[ .]?(?:0[1-9]|1[0-2]|[2-9]\d)[ .]?(?:\d{2}|2[AB])[ .]?\d{3}[ .]?\d{3}(?:[ .]?\d{2})?\b/g },
  { category: "birth_date", pattern: new RegExp(`(?:n[ée]e?\\s+le|date\\s+de\\s+naissance|born(?:\\s+on)?|date\\s+of\\s+birth|DOB)\\s*:?\\s*${DATE}`, "gi") },
  { category: "age", pattern: /\b(?:âge|age)\s*:?\s*\d{2}\s*ans\b/gi },
  { category: "nationality", pattern: /\b(?:nationalit[ée]|nationality|citizenship)\s*:?\s*[\p{L}][\p{L} -]{2,40}/giu },
  {
    category: "family",
    pattern: /\b(?:situation\s+(?:familiale|matrimoniale)\s*:?\s*[\p{L} ,]{3,40}|marital\s+status\s*:?\s*\p{L}+|marié(?:e|es|s)?|married|célibataire|pacsé(?:e|es|s)?|divorcé(?:e|es|s)?|veu(?:f|ve)|\d+\s+enfants?|sans\s+enfant)(?![\p{L}])/giu,
  },
  {
    category: "sensitive",
    pattern:
      /\b(?:RQTH|reconnaissance\s+de\s+la\s+qualit[ée]\s+de\s+travailleur\s+handicap[ée]|travailleur\s+handicap[ée]|en\s+situation\s+de\s+handicap|handicap[ée]?|religion\s*:?\s*\p{L}+|confession\s*:?\s*\p{L}+|orientation\s+sexuelle|groupe\s+sanguin|affiliation\s+politique|adhérent\s+(?:du|au)\s+parti|appartenance\s+syndicale)\b/giu,
  },
  { category: "address", pattern: new RegExp(`\\b\\d{1,4}\\s?(?:bis|ter)?,?\\s+(?:${STREET})\\s+[^\\n,;·|]{2,60}`, "giu") },
  {
    category: "phone",
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){3,5}\d{2,4}/g,
    // Une suite d'années (« 2019 – 2021 2022 ») ou un nombre court n'est pas un numéro.
    keep: (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length < 9 || digits.length > 15 || /^(?:(?:19|20)\d{2}[\s.-]*)+$/.test(m.trim());
    },
  },
];

/** Code postal suivi d'une ville : seulement dans l'en-tête du CV, où il fait partie de l'adresse. */
const POSTAL = /\b(?:F-)?(?:0[1-9]|[1-8]\d|9[0-5]|97)\d{3}(?=\s+\p{Lu})/gu;
const SECTION = /^\s*(?:exp[ée]riences?|parcours|formations?|education|comp[ée]tences|skills|profil|summary|r[ée]sum[ée]|projets?|langues|languages|certifications?|centres?\s+d'int[ée]r[êe]t)\b/i;
const JOB_WORDS = /\b(?:engineer|ing[ée]nieur|d[ée]veloppeu|developer|manager|chef|consultant|analyste?|designer|architecte?|data|product|responsable|directeur|directrice|technicien|assistant|charg[ée]|lead|senior|junior|stagiaire|alternant|cv|curriculum)\b/i;

/** Zone d'en-tête : lignes avant le premier titre de section (au plus 12). */
function headerLength(lines: string[]): number {
  const idx = lines.findIndex((l, i) => i > 0 && SECTION.test(l));
  return Math.min(idx === -1 ? 12 : idx, 12, lines.length);
}

/** Nom probable : première ligne de l'en-tête faite de 2 à 4 mots en lettres, sans intitulé de poste. */
export function guessName(text: string): string | null {
  const lines = text.split("\n");
  for (const raw of lines.slice(0, headerLength(lines))) {
    // « Camille Martin, Data Engineer à Lyon » : le nom est souvent le premier segment de la ligne.
    for (const segment of raw.split(/[,|·•–—]/)) {
      const line = segment.trim();
      if (!line || JOB_WORDS.test(line) || /\d|@/.test(line)) continue;
      const words = line.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 && words.every((w) => /^\p{Lu}[\p{L}'-]*$/u.test(w))) return line;
    }
  }
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nameTerms(names: string[]): string[] {
  const terms = new Set<string>();
  for (const n of names) {
    const full = n.trim();
    if (full.length < 3) continue;
    terms.add(full);
    // Prénom composé entier (« Jean-Pierre »), puis chacune de ses parties.
    for (const word of full.split(/\s+/)) {
      if (word.length >= 3) terms.add(word);
      for (const part of word.split("-")) if (part.length >= 3) terms.add(part);
    }
  }
  // Les formes longues d'abord : « Camille Martin » avant « Camille ».
  return [...terms].sort((a, b) => b.length - a.length);
}

/**
 * Masque les données personnelles d'un texte. `names` : nom(s) connus du candidat (profil, saisie) ;
 * `cv` : le texte est un CV entier, son en-tête est traité plus strictement (code postal, nom deviné).
 */
export function redactPii(text: string, opts: { names?: (string | null | undefined)[]; cv?: boolean } = {}): RedactionResult {
  const counts: PiiCounts = {};
  const found: RedactionResult["found"] = { email: null, phone: null, name: null };
  const bump = (c: PiiCategory) => void (counts[c] = (counts[c] ?? 0) + 1);
  let out = text;

  // Identifiants structurés d'abord (un nom masqué casserait la détection de « prenom.nom@… »), puis le nom.
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (m) => {
      if (rule.keep?.(m)) return m;
      if (rule.category === "email") found.email ??= m;
      if (rule.category === "phone") found.phone ??= m.trim();
      bump(rule.category);
      return PII_PLACEHOLDERS[rule.category];
    });
  }

  const guessed = opts.cv ? guessName(text) : null;
  const names = [...(opts.names ?? []), guessed].filter((n): n is string => Boolean(n && n.trim()));
  found.name = guessed ?? names[0] ?? null;
  for (const term of nameTerms(names)) {
    out = out.replace(new RegExp(`(?<![\\p{L}])${escape(term)}(?![\\p{L}])`, "giu"), () => {
      bump("name");
      return PII_PLACEHOLDERS.name;
    });
  }

  if (opts.cv) {
    const lines = out.split("\n");
    const n = headerLength(lines);
    for (let i = 0; i < n; i++) {
      lines[i] = lines[i]!.replace(POSTAL, () => {
        bump("postal_code");
        return PII_PLACEHOLDERS.postal_code;
      }).replace(/^\s*\d{2}\s*ans\s*$/i, () => {
        bump("age");
        return PII_PLACEHOLDERS.age;
      });
    }
    out = lines.join("\n");
  }
  return { text: out, counts, found };
}

/** Données personnelles restantes dans un texte (réponse d'un modèle), sans les modifier. */
export function detectPii(text: string, opts: { names?: (string | null | undefined)[] } = {}): PiiCounts {
  return redactPii(text, { names: opts.names }).counts;
}

export function totalCount(counts: PiiCounts): number {
  return Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
}

/**
 * Nettoie récursivement les chaînes d'une réponse structurée : toute donnée personnelle qui aurait
 * survécu ou été inventée par le modèle est masquée. Renvoie la valeur nettoyée et le décompte.
 */
export function sanitizeOutput<T>(value: T, opts: { names?: (string | null | undefined)[] } = {}): { value: T; counts: PiiCounts } {
  const counts: PiiCounts = {};
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redactPii(v, { names: opts.names });
      for (const [k, n] of Object.entries(r.counts)) counts[k as PiiCategory] = (counts[k as PiiCategory] ?? 0) + (n ?? 0);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, counts };
}

export type PrivacyReport = {
  rulesVersion: number;
  /** Données masquées avant l'envoi, par catégorie (décomptes seulement, jamais les valeurs). */
  before: PiiCounts;
  /** Données personnelles trouvées et retirées dans la réponse du modèle. */
  after: PiiCounts | null;
  /** Une donnée sensible (art. 9 RGPD) figure dans le document source. */
  sensitive: boolean;
  sentChars: number;
};

/**
 * Réinjection locale après l'appel : la balise [CANDIDAT] redevient le nom (donnée de l'utilisateur,
 * restée sur sa machine). Les autres balises reprises par le modèle sont signalées pour vérification.
 */
export function restorePlaceholders<T>(value: T, name: string | null): { value: T; leftovers: PiiCategory[] } {
  const leftovers = new Set<PiiCategory>();
  const placeholders = Object.entries(PII_PLACEHOLDERS).filter(([c]) => c !== "name") as [PiiCategory, string][];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      for (const [c, p] of placeholders) if (v.includes(p)) leftovers.add(c);
      return name ? v.replaceAll(PII_PLACEHOLDERS.name, name) : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, leftovers: [...leftovers] };
}

export function mergeCounts(...all: (PiiCounts | null | undefined)[]): PiiCounts {
  const out: PiiCounts = {};
  for (const c of all) for (const [k, n] of Object.entries(c ?? {})) out[k as PiiCategory] = (out[k as PiiCategory] ?? 0) + (n ?? 0);
  return out;
}
