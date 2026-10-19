import type { Tone } from "@/components/ui/StatusBadge";
import type { OfferStatus } from "@/modules/offers";

export const OFFER_STATUS_LABELS: Record<OfferStatus, { label: string; tone: Tone }> = {
  incomplete: { label: "Texte à compléter", tone: "signal" },
  queued: { label: "En file", tone: "neutral" },
  analyzing: { label: "Analyse en cours", tone: "neutral" },
  analyzed: { label: "Analysée", tone: "accent" },
  failed: { label: "Échec", tone: "signal" },
  qualified: { label: "Qualifiée", tone: "accent" },
  discarded: { label: "Écartée", tone: "neutral" },
};

export const OFFER_SOURCE_LABELS = {
  url: "URL",
  text: "Texte collé",
  file: "Fichier",
  france_travail: "France Travail",
  adzuna: "Adzuna",
  career_page: "Page carrières",
  email_alert: "Alerte e-mail",
} as const;

/** Jobboards reconnus (offre vue sur…). */
export const BOARD_LABELS: Record<string, string> = {
  france_travail: "France Travail",
  adzuna: "Adzuna",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  recruitee: "Recruitee",
  smartrecruiters: "SmartRecruiters",
  linkedin: "LinkedIn",
  indeed: "Indeed",
  wttj: "Welcome to the Jungle",
  hellowork: "HelloWork",
  cadremploi: "Cadremploi",
  meteojob: "Meteojob",
  jobteaser: "JobTeaser",
  apec: "APEC",
};
