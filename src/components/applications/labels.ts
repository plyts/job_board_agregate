import type { Tone } from "@/components/ui/StatusBadge";
import type { ApplicationStatus } from "@/modules/applications/rules";

export const STATUS_META: Record<ApplicationStatus, { label: string; tone: Tone; glyph: string }> = {
  new_offer: { label: "Nouvelle offre", tone: "neutral", glyph: "○" },
  to_analyze: { label: "À analyser", tone: "signal", glyph: "?" },
  qualified: { label: "Offre qualifiée", tone: "accent", glyph: "◐" },
  cv_to_adapt: { label: "CV à adapter", tone: "signal", glyph: "◐" },
  ready: { label: "Prête à envoyer", tone: "accent", glyph: "✓" },
  sent: { label: "Envoyée", tone: "ink", glyph: "→" },
  followed_up: { label: "Relance", tone: "ink", glyph: "↻" },
  hr_interview: { label: "Entretien RH", tone: "accent", glyph: "●" },
  tech_interview: { label: "Entretien technique", tone: "accent", glyph: "●" },
  offer_received: { label: "Offre reçue", tone: "accent", glyph: "★" },
  rejected: { label: "Refus", tone: "danger", glyph: "–" },
  abandoned: { label: "Abandonnée ou expirée", tone: "neutral", glyph: "–" },
};

export const EVENT_LABELS = {
  created: "Candidature créée",
  status_changed: "Statut modifié",
  sent: "Envoi confirmé",
  next_action_set: "Prochaine action",
} as const;
