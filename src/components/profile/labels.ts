import type { Tone } from "@/components/ui/StatusBadge";
import type { SkillLevel } from "@/modules/profile/content";

export const SKILL_LEVEL_LABELS: Record<SkillLevel, { label: string; tone: Tone; hint: string }> = {
  mastered: { label: "Maîtrisée", tone: "accent", hint: "Utilisée de façon répétée en contexte professionnel" },
  occasional: { label: "Ponctuelle", tone: "neutral", hint: "Utilisée ponctuellement" },
  learning: { label: "En apprentissage", tone: "signal", hint: "Formation ou projet d'apprentissage" },
  unconfirmed: { label: "Non confirmée", tone: "danger", hint: "Listée sans preuve" },
};

export const CERT_STATUS_LABELS = { obtained: "Obtenue", in_progress: "En préparation", planned: "Planifiée" } as const;
export const PROJECT_CONTEXT_LABELS = { professional: "Professionnel", personal: "Personnel", academic: "Académique" } as const;

const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "2-digit", year: "numeric" });

export function formatPeriod(start: string | null, end: string | null, current: boolean): string {
  const f = (m: string | null) => (m ? monthFmt.format(new Date(`${m}-01T12:00:00Z`)) : "?");
  return `${f(start)} – ${current ? "aujourd'hui" : f(end)}`;
}
