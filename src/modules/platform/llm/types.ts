import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type StructuredRequest<T> = {
  /** Usage métier, ex. « offer.extract ». */
  purpose: string;
  promptVersion: string;
  schemaVersion: number;
  system: string;
  /** Contenu utilisateur déjà encadré par untrustedDocument() pour les données importées. */
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: Effort;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type LlmResult<T> = { output: T; model: string; usage: LlmUsage; latencyMs: number };

export interface LlmClient {
  readonly model: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>>;
}

type LlmErrorCode = "refused" | "truncated" | "invalid_output" | "api_error" | "budget_exceeded";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    /** Vrai si un nouvel essai plus tard a une chance d'aboutir. */
    readonly retryable: boolean,
    readonly usage?: LlmUsage,
    readonly latencyMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
