import type { Tone } from "@/components/ui/StatusBadge";
import type { OfferStatus } from "@/modules/offers";

export const OFFER_STATUS_LABELS: Record<OfferStatus, { label: string; tone: Tone }> = {
  queued: { label: "En file", tone: "neutral" },
  analyzing: { label: "Analyse en cours", tone: "neutral" },
  analyzed: { label: "Analysée", tone: "accent" },
  failed: { label: "Échec", tone: "signal" },
  qualified: { label: "Qualifiée", tone: "accent" },
  discarded: { label: "Écartée", tone: "neutral" },
};

export const OFFER_SOURCE_LABELS = { url: "URL", text: "Texte collé", file: "Fichier" } as const;
