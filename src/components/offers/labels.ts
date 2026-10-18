import type { Tone } from "@/components/ui/StatusBadge";

export const KIND_LABELS: Record<string, string> = {
  mission: "Mission",
  hard_skill: "Compétence technique",
  soft_skill: "Savoir-être",
  tech: "Technologie",
  years: "Expérience",
  seniority: "Séniorité",
  degree: "Diplôme",
  certification: "Certification",
  language: "Langue",
  contract: "Contrat",
  location: "Lieu",
  remote: "Télétravail",
  availability: "Disponibilité",
  salary: "Salaire",
  clearance: "Habilitation",
};

export const PROVENANCE: Record<string, { label: string; tone: Tone }> = {
  explicit: { label: "Explicite", tone: "accent" },
  inferred: { label: "Déduit", tone: "neutral" },
  uncertain: { label: "Incertain", tone: "signal" },
};

export const IMPORTANCE_GROUPS = [
  { id: "mandatory", title: "Exigences obligatoires" },
  { id: "preferred", title: "Critères souhaités" },
  { id: "condition", title: "Conditions" },
] as const;
