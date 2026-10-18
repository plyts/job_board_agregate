import { z } from "zod";

export const EXTRACTION_SCHEMA_VERSION = 1;

export const REQUIREMENT_KINDS = [
  "mission",
  "hard_skill",
  "soft_skill",
  "tech",
  "years",
  "seniority",
  "degree",
  "certification",
  "language",
  "contract",
  "location",
  "remote",
  "availability",
  "salary",
  "clearance",
] as const;

export const ExtractedRequirement = z.object({
  kind: z.enum(REQUIREMENT_KINDS),
  importance: z.enum(["mandatory", "preferred", "condition"]),
  label: z.string().describe("Intitulé court de l'exigence, dans la langue de l'annonce"),
  value: z.string().nullable().describe("Précision utile (niveau, durée, lieu, montant), null si aucune"),
  minYears: z.number().int().nullable().describe("Nombre minimal d'années, uniquement pour kind = years"),
  provenance: z.enum(["explicit", "inferred", "uncertain"]),
  quote: z.string().nullable().describe("Extrait recopié mot pour mot de l'annonce ; obligatoire si explicit"),
  rationale: z.string().nullable().describe("Justification ; obligatoire si inferred ou uncertain"),
});

export const OfferExtraction = z.object({
  title: z.string(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  requirements: z.array(ExtractedRequirement),
  notMentioned: z.array(z.enum(REQUIREMENT_KINDS)).describe("Types d'information absents de l'annonce"),
});

export type OfferExtraction = z.infer<typeof OfferExtraction>;
export type ExtractedRequirement = z.infer<typeof ExtractedRequirement>;
