import { evidenceElements, type ProfileContent } from "@/modules/profile/content";
import { cvAsProfile, type CvContent } from "./content";
import { containsTerm } from "./factcheck";

/**
 * Bonnes pratiques de rédaction des expériences. Les règles sont versionnées : un rapport enregistré
 * avec une version du profil ou du CV garde la version de règles qui l'a produit.
 */
export const QUALITY_RULES_VERSION = 1;

export const QUALITY_RULES = ["order", "bullets", "action_verb", "quantified", "length", "keywords"] as const;
export type QualityRule = (typeof QUALITY_RULES)[number];
export type QualityStatus = "ok" | "info" | "warn";

export type QualityCheck = { rule: QualityRule; status: QualityStatus; message: string; sourceId: string | null; hint?: string };
export type RuleSummary = { status: QualityStatus; passed: number; total: number; summary: string };
export type KeywordStatus = { term: string; status: "used" | "available" | "gap"; provenBy: { id: string; label: string }[] };
export type QualityReport = {
  rulesVersion: number;
  /** 0–100 : part des vérifications respectées (une recommandation compte pour moitié). */
  score: number;
  rules: Partial<Record<QualityRule, RuleSummary>>;
  checks: QualityCheck[];
  keywords: KeywordStatus[] | null;
};

type Exp = { id: string; label: string; start: string | null; end: string | null; current: boolean; items: { id: string; text: string }[] };

// ---------------------------------------------------------------------------------------------
// Verbe d'action en tête de puce

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const WEAK_START =
  /^(en charge|responsable (de|des|du)|charg[ée]e?s? (de|des|du)|participation|particip[ée]|aide (a|à)|aid[ée]|travail sur|travaill[ée]|j['’]|je |nous |on |missions?\b|t[âa]ches?\b|divers|diff[ée]rente?s|plusieurs|responsible for|in charge|worked on|helped|duties|tasks)/i;
const NOUNS = new Set(
  [
    "refonte", "mise", "analyse", "conduite", "veille", "creation", "lancement", "suivi", "audit", "revue", "redaction", "pilotage", "gestion",
    "coordination", "animation", "formation", "accompagnement", "support", "deploiement", "industrialisation", "automatisation", "migration",
    "ingestion", "conception", "developpement", "encadrement", "negociation", "optimisation", "realisation", "amelioration", "reduction",
    "augmentation", "mentorat", "recrutement", "organisation", "supervision", "administration", "modelisation", "construction", "integration",
    "securisation", "documentation", "maintenance", "exploitation", "architecture", "direction", "elaboration", "definition", "preparation",
  ],
);
const NOMINAL_SUFFIX = /(tion|sion|ment|age|ance|ence|ure|yse)$/;
const FR_PARTICIPLE = /(é|ée|és|ées)$/;
const FR_IRREGULAR = new Set(["conçu", "obtenu", "fait", "produit", "construit", "traduit", "résolu", "acquis", "atteint", "réduit", "mis", "pris", "conduit", "écrit", "ouvert", "promu"]);
const EN_IRREGULAR = new Set(["led", "built", "ran", "drove", "grew", "won", "made", "wrote", "cut", "set", "took", "began", "brought", "sold", "taught", "oversaw", "shipped"]);
const INFINITIVE = /(er|ir|re)$/;

/** Classe le premier mot d'une puce : verbe d'action ou nom d'action, infinitif, formule faible ou autre. */
export function actionStart(text: string): "action" | "infinitive" | "weak" | "other" {
  const t = text.trim();
  if (WEAK_START.test(t)) return "weak";
  const first = (t.match(/^[\p{L}'’-]+/u)?.[0] ?? "").toLowerCase();
  if (!first) return "other";
  const plain = strip(first);
  if (NOUNS.has(plain) || NOMINAL_SUFFIX.test(plain) || FR_PARTICIPLE.test(first) || FR_IRREGULAR.has(first)) return "action";
  if (EN_IRREGULAR.has(first) || (/ed$/.test(first) && first.length > 4)) return "action";
  if (INFINITIVE.test(plain) && first.length > 4) return "infinitive";
  return "other";
}

// ---------------------------------------------------------------------------------------------
// Ordre antéchronologique

const sortKey = (e: Pick<Exp, "start" | "end" | "current">) => (e.current ? "9999-99" : (e.end ?? e.start ?? ""));

/** Identifiants dans l'ordre antéchronologique (poste en cours d'abord, puis par date de fin, puis de début). */
export function reverseChronological<T extends Pick<Exp, "id" | "start" | "end" | "current">>(list: T[]): string[] {
  return [...list]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => sortKey(b.e).localeCompare(sortKey(a.e)) || (b.e.start ?? "").localeCompare(a.e.start ?? "") || a.i - b.i)
    .map(({ e }) => e.id);
}

const excerpt = (text: string) => (text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text);

function monthsAgo(m: string, today: Date): number {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return (today.getUTCFullYear() - y) * 12 + (today.getUTCMonth() + 1 - mo);
}

// ---------------------------------------------------------------------------------------------

function analyse(exps: Exp[], today: Date, keywords: KeywordStatus[] | null): QualityReport {
  const checks: QualityCheck[] = [];
  const rules: Partial<Record<QualityRule, RuleSummary>> = {};
  const bullets = exps.flatMap((e) => e.items.map((i) => ({ ...i, exp: e })));

  // 1. Ordre antéchronologique.
  const expected = reverseChronological(exps);
  const actual = exps.map((e) => e.id);
  const misplaced = actual.findIndex((id, i) => id !== expected[i]);
  if (misplaced >= 0) {
    const shouldBeFirst = exps.find((e) => e.id === expected[misplaced])!;
    checks.push({
      rule: "order",
      status: "warn",
      sourceId: shouldBeFirst.id,
      message: `Ordre non antéchronologique : « ${shouldBeFirst.label} » devrait venir avant « ${exps[misplaced]!.label} ».`,
      hint: "Commence par l'expérience la plus récente : c'est elle que le recruteur lit en premier.",
    });
  }
  const undated = exps.filter((e) => !e.current && !e.end && !e.start);
  for (const e of undated) checks.push({ rule: "order", status: "info", sourceId: e.id, message: `« ${e.label} » n'a pas de dates : l'ordre ne peut pas être vérifié.` });
  rules.order = {
    status: misplaced >= 0 ? "warn" : undated.length ? "info" : "ok",
    passed: misplaced >= 0 ? 0 : 1,
    total: 1,
    summary: misplaced >= 0 ? "Expériences à remettre dans l'ordre antéchronologique." : "Expériences de la plus récente à la plus ancienne.",
  };

  // 2. 3 à 5 puces par poste (1 à 3 suffisent pour un poste terminé depuis plus de 10 ans).
  let bulletsOk = 0;
  for (const e of exps) {
    const n = e.items.length;
    const old = !e.current && e.end !== null && monthsAgo(e.end, today) > 120;
    if (n === 0) checks.push({ rule: "bullets", status: "warn", sourceId: e.id, message: `« ${e.label} » : aucune puce. Décris 3 à 5 réalisations.` });
    else if (old ? n > 3 : n > 5) checks.push({ rule: "bullets", status: "warn", sourceId: e.id, message: `« ${e.label} » : ${n} puces. Garde les ${old ? 3 : 5} plus pertinentes${old ? " pour un poste ancien" : ""}.` });
    else if (!old && n < 3) checks.push({ rule: "bullets", status: "info", sourceId: e.id, message: `« ${e.label} » : ${n} puce${n > 1 ? "s" : ""}. Vise 3 à 5 réalisations si tu en as de réelles.` });
    else bulletsOk++;
  }
  rules.bullets = {
    status: checks.some((c) => c.rule === "bullets" && c.status === "warn") ? "warn" : bulletsOk === exps.length ? "ok" : "info",
    passed: bulletsOk,
    total: exps.length,
    summary: `${bulletsOk}/${exps.length} poste${exps.length > 1 ? "s" : ""} avec 3 à 5 puces (1 à 3 pour un poste de plus de 10 ans).`,
  };

  // 3. Verbe d'action au début de chaque puce.
  let verbOk = 0;
  for (const b of bullets) {
    const kind = actionStart(b.text);
    if (kind === "action") verbOk++;
    else if (kind === "weak") {
      checks.push({
        rule: "action_verb",
        status: "warn",
        sourceId: b.id,
        message: `${b.exp.label} : « ${excerpt(b.text)} » commence par une formule passive.`,
        hint: "Remplace « En charge de », « Responsable de », « Participation à » par l'action menée : Pilotage, Conception, Négociation, Optimisation…",
      });
    } else {
      checks.push({
        rule: "action_verb",
        status: "info",
        sourceId: b.id,
        message: `${b.exp.label} : « ${excerpt(b.text)} » ${kind === "infinitive" ? "commence par un infinitif" : "ne commence pas par une action reconnue"}.`,
        hint: "Commence par un nom d'action ou un verbe au passé : Réalisation, Pilotage, Développé, Conçu…",
      });
    }
  }
  rules.action_verb = {
    status: checks.some((c) => c.rule === "action_verb" && c.status === "warn") ? "warn" : verbOk === bullets.length ? "ok" : "info",
    passed: verbOk,
    total: bullets.length,
    summary: `${verbOk}/${bullets.length} puce${bullets.length > 1 ? "s" : ""} commençant par une action.`,
  };

  // 4. Résultats chiffrés : au moins la moitié des puces, sans jamais inventer.
  const quantified = bullets.filter((b) => /\d/.test(b.text));
  for (const b of bullets) {
    if (!/\d/.test(b.text)) {
      checks.push({
        rule: "quantified",
        status: "info",
        sourceId: b.id,
        message: `${b.exp.label} : « ${excerpt(b.text)} » sans résultat chiffré.`,
        hint: "Si tu as un chiffre réel (volume, %, délai, budget, équipe), ajoute-le d'abord au profil maître : un chiffre absent de la source est bloqué dans le CV.",
      });
    }
  }
  const enough = bullets.length > 0 && quantified.length * 2 >= bullets.length;
  rules.quantified = {
    status: enough ? "ok" : "info",
    passed: quantified.length,
    total: bullets.length,
    summary: `${quantified.length}/${bullets.length} puce${bullets.length > 1 ? "s" : ""} avec un résultat chiffré (cible : au moins la moitié).`,
  };

  // 5. Longueur : une à deux lignes par puce, pas de bloc de texte.
  let lengthOk = 0;
  for (const b of bullets) {
    const n = b.text.length;
    if (n > 350) checks.push({ rule: "length", status: "warn", sourceId: b.id, message: `${b.exp.label} : bloc de ${n} caractères. Découpe-le en plusieurs puces.` });
    else if (n > 220) checks.push({ rule: "length", status: "info", sourceId: b.id, message: `${b.exp.label} : puce de ${n} caractères. Vise une à deux lignes.` });
    else lengthOk++;
  }
  rules.length = {
    status: checks.some((c) => c.rule === "length" && c.status === "warn") ? "warn" : lengthOk === bullets.length ? "ok" : "info",
    passed: lengthOk,
    total: bullets.length,
    summary: `${lengthOk}/${bullets.length} puce${bullets.length > 1 ? "s" : ""} d'une à deux lignes.`,
  };

  // 6. Mots-clés de l'offre : repris quand le profil les prouve, jamais ajoutés sinon.
  if (keywords) {
    for (const k of keywords) {
      if (k.status === "available") {
        checks.push({
          rule: "keywords",
          status: "warn",
          sourceId: k.provenBy[0]?.id ?? null,
          message: `« ${k.term} » : prouvé par ${k.provenBy.map((p) => p.label).join(", ")}, mais absent du CV.`,
          hint: "Reprends ce terme dans la puce ou l'élément qui le prouve, ou inclus cet élément.",
        });
      } else if (k.status === "gap") {
        checks.push({
          rule: "keywords",
          status: "info",
          sourceId: null,
          message: `« ${k.term} » : aucune preuve dans ton profil. Ne l'ajoute pas ; prépare-toi à en parler en entretien.`,
        });
      }
    }
    const provable = keywords.filter((k) => k.status !== "gap");
    const used = keywords.filter((k) => k.status === "used");
    rules.keywords = {
      status: keywords.some((k) => k.status === "available") ? "warn" : "ok",
      passed: used.length,
      total: provable.length,
      summary: `${used.length}/${provable.length} mot${provable.length > 1 ? "s" : ""}-clé${provable.length > 1 ? "s" : ""} prouvé${provable.length > 1 ? "s" : ""} repris ; ${keywords.length - provable.length} lacune${keywords.length - provable.length > 1 ? "s" : ""} non ajoutée${keywords.length - provable.length > 1 ? "s" : ""}.`,
    };
  }

  // Score : chaque règle applicable pèse autant ; une recommandation (info) compte pour moitié.
  const weights = { ok: 1, info: 0.5, warn: 0 } as const;
  const applicable = Object.values(rules).filter((r) => r.total > 0);
  const score = applicable.length ? Math.round((applicable.reduce((s, r) => s + weights[r.status], 0) / applicable.length) * 100) : 0;
  return { rulesVersion: QUALITY_RULES_VERSION, score, rules, checks, keywords };
}

function profileExps(profile: ProfileContent): Exp[] {
  return profile.experiences.map((e) => ({ id: e.id, label: `${e.title} · ${e.company}`, start: e.start, end: e.end, current: e.current, items: e.items.map((i) => ({ id: i.id, text: i.text })) }));
}

/** Bonnes pratiques appliquées au profil maître (sans offre). */
export function profileQuality(profile: ProfileContent, today = new Date()): QualityReport {
  return analyse(profileExps(profile), today, null);
}

/** Mots-clés de l'offre : repris dans le CV, prouvés par le profil mais absents du CV, ou sans preuve. */
export function keywordCoverage(cv: CvContent, profile: ProfileContent, offerTerms: string[]): KeywordStatus[] {
  const shown = cvAsProfile(cv, profile);
  const cvText = [
    cv.headline,
    shown.summary ?? "",
    ...shown.experiences.flatMap((e) => [e.title, ...e.items.map((i) => i.text)]),
    ...shown.projects.map((p) => `${p.name} ${p.description}`),
    ...shown.skills.map((s) => s.name),
    ...shown.certifications.map((c) => c.name),
    ...shown.education.map((d) => d.degree),
  ].join(" \n ");
  const elements = evidenceElements(profile);
  return offerTerms.map((term) => {
    const provenBy = [
      ...elements.filter((e) => e.kind !== "experience" && containsTerm(e.text, term)).map((e) => ({ id: e.id, label: e.label })),
      ...profile.skills.filter((s) => s.level !== "unconfirmed" && s.evidence.length > 0 && containsTerm(s.name, term)).map((s) => ({ id: s.id, label: `compétence ${s.name}` })),
    ];
    const status = containsTerm(cvText, term) ? "used" : provenBy.length ? "available" : "gap";
    return { term, status, provenBy };
  });
}

/** Bonnes pratiques appliquées au CV personnalisé, tel que le recruteur le verra, avec les mots-clés de l'offre. */
export function cvQuality(cv: CvContent, profile: ProfileContent, offerTerms: string[], today = new Date()): QualityReport {
  const exps = profileExps(cvAsProfile(cv, profile));
  return analyse(exps, today, offerTerms.length ? keywordCoverage(cv, profile, offerTerms) : null);
}
