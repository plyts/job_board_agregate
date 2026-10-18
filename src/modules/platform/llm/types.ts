import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** « personal » : CV, profil, candidatures. Seuls les fournisseurs explicitement autorisés les reçoivent. */
export type DataClass = "public" | "personal";

export type StructuredRequest<T> = {
  /** Usage métier, ex. « offer.extract ». */
  purpose: string;
  promptVersion: string;
  schemaVersion: number;
  dataClass: DataClass;
  system: string;
  /** Contenu utilisateur déjà encadré par untrustedDocument() pour les données importées. */
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: Effort;
  /** Données personnelles : noms connus du candidat, masqués en plus des motifs génériques. */
  privacy?: { names?: (string | null | undefined)[] };
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type LlmResult<T> = {
  output: T;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
  /** Coût réel annoncé par le fournisseur, s'il le communique. */
  reportedCostUsd?: number;
};

export interface LlmClient {
  /** Identifiant du fournisseur : « anthropic », « groq », « openrouter »… */
  readonly provider: string;
  readonly model: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>>;
  /** Coût estimé d'un usage pour ce client (0 pour une offre gratuite). */
  estimateCostUsd(model: string, usage: LlmUsage): number;
}

export type LlmErrorCode =
  | "refused"
  | "truncated"
  | "invalid_output"
  | "api_error"
  | "rate_limited"
  | "budget_exceeded"
  | "quota_exhausted"
  | "no_provider";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    /** Vrai si un nouvel essai plus tard a une chance d'aboutir. */
    readonly retryable: boolean,
    readonly usage?: LlmUsage,
    readonly latencyMs?: number,
    /** Délai demandé par le fournisseur avant un nouvel appel (en-tête retry-after). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
