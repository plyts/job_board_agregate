import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { LlmError, ZERO_USAGE, type LlmClient, type LlmResult, type LlmUsage, type StructuredRequest } from "./types";

export const DEFAULT_MODEL = "claude-opus-5-5";

function toUsage(usage: Anthropic.Beta.BetaUsage | undefined): LlmUsage {
  if (!usage) return ZERO_USAGE;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Client Claude : sortie JSON contrainte par le schéma Zod, effort explicite,
 * repli serveur automatique quand un classifieur de sécurité refuse la requête.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    readonly model: string = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    client?: Anthropic,
  ) {
    // Délai court et 2 nouvelles tentatives SDK (429, 5xx, réseau) ; pg-boss gère les reprises longues.
    this.client = client ?? new Anthropic({ timeout: 120_000, maxRetries: 2 });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
    } catch (err) {
      const latencyMs = Date.now() - started;
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new LlmError("api_error", `Requête refusée par l'API (${err.status})`, false, undefined, latencyMs);
      }
      if (err instanceof Anthropic.APIError) {
        throw new LlmError("api_error", `Erreur de l'API (${err.status ?? "réseau"})`, true, undefined, latencyMs);
      }
      // Sortie non conforme au schéma détectée par le SDK pendant l'analyse.
      throw new LlmError("invalid_output", err instanceof Error ? err.message : "Sortie invalide", true, undefined, latencyMs);
    }
    const latencyMs = Date.now() - started;
    const usage = toUsage(response.usage);
    if (response.stop_reason === "refusal") {
      throw new LlmError("refused", "Le modèle a refusé de traiter ce contenu", false, usage, latencyMs);
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmError("truncated", "Réponse tronquée (limite de jetons)", true, usage, latencyMs);
    }
    const parsed = req.schema.safeParse(response.parsed_output);
    if (!parsed.success) {
      throw new LlmError("invalid_output", "Sortie non conforme au schéma", true, usage, latencyMs);
    }
    return { output: parsed.data, model: response.model, usage, latencyMs };
  }
}
