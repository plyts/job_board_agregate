import type { Tone } from "@/components/ui/StatusBadge";
import type { MatchCategory } from "@/modules/matching/score";

export const CATEGORY_META: Record<MatchCategory, { label: string; tone: Tone; glyph: string }> = {
  confirmed: { label: "Confirmée", tone: "accent", glyph: "✓" },
  partial: { label: "Partielle", tone: "signal", glyph: "◐" },
  to_confirm: { label: "À confirmer", tone: "signal", glyph: "?" },
  not_demonstrated: { label: "Non démontrée", tone: "neutral", glyph: "○" },
  potential_incompatibility: { label: "Incompatibilité potentielle", tone: "danger", glyph: "!" },
  not_applicable: { label: "Non applicable", tone: "neutral", glyph: "–" },
};

export const FACTOR_LABELS = {
  mandatory: "Exigences obligatoires",
  preferred: "Critères souhaités",
  experience: "Séniorité et expérience",
  conditions: "Conditions (lieu, contrat)",
} as const;
