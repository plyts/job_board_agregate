import { normalizeForHash } from "@/modules/offers/normalize";
import { type ProfileContent } from "@/modules/profile/content";
import type { MatchCategory } from "./score";

function monthIndex(m: string): number {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return y * 12 + (mo - 1);
}

/**
 * Expérience professionnelle totale en mois : périodes fusionnées pour ne pas compter deux fois
 * des postes simultanés. Les expériences sans dates sont ignorées (et signalées par l'appelant).
 */
export function professionalMonths(content: ProfileContent, today = new Date()): { months: number; undated: number } {
  const now = today.getFullYear() * 12 + today.getMonth();
  const intervals: [number, number][] = [];
  let undated = 0;
  for (const e of content.experiences) {
    if (!e.start || (!e.current && !e.end)) {
      undated++;
      continue;
    }
    const start = monthIndex(e.start);
    const end = e.current ? now : monthIndex(e.end!);
    if (end >= start) intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let current: [number, number] | null = null;
  for (const [s, e] of intervals) {
    if (current && s <= current[1] + 1) current[1] = Math.max(current[1], e);
    else {
      if (current) months += current[1] - current[0] + 1;
      current = [s, e];
    }
  }
  if (current) months += current[1] - current[0] + 1;
  return { months, undated };
}

export function formatDuration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const years = y ? `${y} an${y > 1 ? "s" : ""}` : "";
  const rest = m ? `${m} mois` : "";
  return [years, rest].filter(Boolean).join(" et ") || "0 mois";
}

export type RuleResult = { category: MatchCategory; evidenceIds: string[]; rationale: string; action: string };

/** Années d'expérience : comparaison calculée sur les dates du profil, jamais estimée par le modèle. */
export function yearsRule(minYears: number, content: ProfileContent, today = new Date()): RuleResult {
  const { months, undated } = professionalMonths(content, today);
  const evidenceIds = content.experiences.filter((e) => e.start).map((e) => e.id);
  const have = formatDuration(months);
  const note = undated ? ` (${undated} expérience(s) sans dates non comptée(s))` : "";
  if (months >= minYears * 12) {
    return { category: "confirmed", evidenceIds, rationale: `${have} d'expérience calculés sur tes dates${note}, pour ${minYears} an(s) demandés.`, action: "Rien à faire." };
  }
  if (months >= minYears * 12 * 0.8) {
    return {
      category: "partial",
      evidenceIds,
      rationale: `${have} d'expérience${note}, légèrement sous les ${minYears} an(s) demandés.`,
      action: "Mettre en avant la profondeur des expériences plutôt que leur durée.",
    };
  }
  return {
    category: undated ? "to_confirm" : "not_demonstrated",
    evidenceIds,
    rationale: `${have} d'expérience${note}, pour ${minYears} an(s) demandés.`,
    action: undated ? "Compléter les dates manquantes dans le profil maître." : "Écart réel : à évaluer avant de postuler.",
  };
}

/** Critères d'exclusion de l'utilisateur (« stage », « junior »…) retrouvés dans une exigence. */
export function exclusionHit(requirement: { label: string; value: string | null }, exclusions: string[]): string | null {
  const text = ` ${normalizeForHash(`${requirement.label} ${requirement.value ?? ""}`)} `;
  return exclusions.find((ex) => {
    const n = normalizeForHash(ex);
    return n.length > 1 && text.includes(` ${n} `);
  }) ?? null;
}
