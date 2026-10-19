import type { IncomingOffer } from "@/modules/offers";

/** Critères d'une recherche combinée, traduits par chaque connecteur dans les paramètres de sa source. */
export type SearchQuery = {
  keywords: string;
  location: string | null;
  radiusKm: number | null;
  /** Codes de contrat France Travail : CDI, CDD, MIS (intérim), SAI (saisonnier), LIB (libéral) ; ALT = alternance. */
  contracts: string[];
  publishedWithinDays: number | null;
  /** Nombre maximal d'offres demandées à la source (quotas). */
  limit: number;
};

export const CONTRACTS = { CDI: "CDI", CDD: "CDD", MIS: "Intérim", SAI: "Saisonnier", LIB: "Indépendant", ALT: "Alternance" } as const;
export type ContractCode = keyof typeof CONTRACTS;

export type SearchOutcome = { offers: IncomingOffer[]; total: number | null };

/** Erreur d'une source, avec un message lisible par l'utilisateur (jamais de secret). */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "quota" | "unavailable" | "invalid" = "unavailable",
  ) {
    super(message);
    this.name = "SourceError";
  }
}

/** Source interrogeable par mots-clés (API officielle ou page carrières). */
export interface SearchConnector {
  search(query: SearchQuery): Promise<SearchOutcome>;
  /** Vérifie les identifiants ou l'adresse avec un appel minimal. */
  test(): Promise<void>;
}
