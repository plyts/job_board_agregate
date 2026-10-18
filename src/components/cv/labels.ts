import type { Tone } from "@/components/ui/StatusBadge";

export const SUGGESTION_KIND_LABELS = {
  rephrase: "Reformulation",
  summary: "Résumé",
  reorder_items: "Ordre des puces",
  include: "Ajout",
} as const;

export const SUGGESTION_STATE_META: Record<"pending" | "accepted" | "rejected" | "edited" | "blocked", { label: string; tone: Tone; glyph: string }> = {
  pending: { label: "À décider", tone: "neutral", glyph: "○" },
  accepted: { label: "Acceptée", tone: "accent", glyph: "✓" },
  edited: { label: "Modifiée", tone: "accent", glyph: "✓" },
  rejected: { label: "Refusée", tone: "neutral", glyph: "–" },
  blocked: { label: "Bloquée", tone: "danger", glyph: "!" },
};

export const VERSION_STATUS_META: Record<"draft" | "saved" | "finalized", { label: string; tone: Tone }> = {
  draft: { label: "Brouillon", tone: "signal" },
  saved: { label: "Enregistrée", tone: "neutral" },
  finalized: { label: "Finalisée", tone: "accent" },
};
