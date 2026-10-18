import { toStrictJsonSchema } from "./json-schema";
import { LlmError, ZERO_USAGE, type LlmClient, type LlmResult, type LlmUsage, type StructuredRequest } from "./types";

export type JsonMode = "json_schema" | "json_object";

export type OpenAICompatibleConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** Mode de sortie JSON préféré ; « json_schema » repasse automatiquement en « json_object » s'il est refusé. */
  jsonMode?: JsonMode;
  /** Tarif en USD par million de jetons ; 0 pour une offre gratuite. */
  pricing?: { inputPerMTok: number; outputPerMTok: number };
  maxTokens?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Champs propres au fournisseur ajoutés au corps de la requête (ex. préférences de routage OpenRouter). */
  extraBody?: Record<string, unknown>;
};

type ChatResponse = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    cost?: number;
  };
  error?: { message?: string };
};

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 90_000;

function schemaInstruction(schema: Record<string, unknown>): string {
  return `\n\nRéponds uniquement par un objet JSON valide, sans texte autour, conforme à ce JSON Schema :\n${JSON.stringify(schema)}`;
}

/** Retire un éventuel raisonnement <think> et les clôtures Markdown que certains modèles ajoutent autour du JSON. */
export function extractJson(content: string): string {
  let text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1]!.trim();
  return text;
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * Client pour les API compatibles « OpenAI Chat Completions » : Groq, OpenRouter, Gemini, Mistral,
 * Cerebras ou un modèle local (Ollama, LM Studio). La sortie est toujours validée par le schéma Zod.
 */
export class OpenAICompatibleLlmClient implements LlmClient {
  readonly provider: string;
  readonly model: string;
  private jsonMode: JsonMode;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.jsonMode = config.jsonMode ?? "json_schema";
  }

  estimateCostUsd(_model: string, usage: LlmUsage): number {
    const p = this.config.pricing;
    if (!p) return 0;
    const usd = (usage.inputTokens * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
    return Math.round(usd * 1_000_000) / 1_000_000;
  }

  private async post(body: Record<string, unknown>, started: number): Promise<{ res: Response; data: ChatResponse | null }> {
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new LlmError("api_error", timeout ? "Délai dépassé" : "Fournisseur injoignable", true, undefined, Date.now() - started);
    }
    const data = (await res.json().catch(() => null)) as ChatResponse | null;
    return { res, data };
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    const schema = toStrictJsonSchema(req.schema);
    const build = (mode: JsonMode) => ({
      model: this.model,
      temperature: 0,
      max_tokens: Math.min(req.maxTokens ?? DEFAULT_MAX_TOKENS, this.config.maxTokens ?? DEFAULT_MAX_TOKENS),
      messages: [
        { role: "system", content: mode === "json_object" ? req.system + schemaInstruction(schema) : req.system },
        { role: "user", content: req.user },
      ],
      response_format:
        mode === "json_schema" ? { type: "json_schema", json_schema: { name: "result", strict: true, schema } } : { type: "json_object" },
      ...this.config.extraBody,
    });

    let { res, data } = await this.post(build(this.jsonMode), started);
    if (res.status === 400 && this.jsonMode === "json_schema") {
      // Modèle sans « structured outputs » : on bascule une fois pour toutes en mode JSON simple.
      this.jsonMode = "json_object";
      ({ res, data } = await this.post(build("json_object"), started));
    }
    const latencyMs = Date.now() - started;
    const detail = data?.error?.message ? ` : ${data.error.message.slice(0, 200)}` : "";

    if (res.status === 429) {
      throw new LlmError("rate_limited", `Limite de débit atteinte (${this.provider})`, true, undefined, latencyMs, retryAfterMs(res.headers));
    }
    if (res.status === 401 || res.status === 403) throw new LlmError("api_error", `Clé refusée par ${this.provider} (${res.status})`, false, undefined, latencyMs);
    if (res.status === 404) throw new LlmError("api_error", `Modèle introuvable chez ${this.provider}${detail}`, false, undefined, latencyMs);
    if (res.status >= 400 && res.status < 500) throw new LlmError("api_error", `Requête refusée (${res.status})${detail}`, false, undefined, latencyMs);
    if (!res.ok || !data) throw new LlmError("api_error", `Erreur du fournisseur (${res.status})`, true, undefined, latencyMs);

    const usage: LlmUsage = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
          cacheReadTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
        }
      : ZERO_USAGE;
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "content_filter") throw new LlmError("refused", "Contenu refusé par le filtre du fournisseur", false, usage, latencyMs);
    if (choice?.finish_reason === "length") throw new LlmError("truncated", "Réponse tronquée (limite de jetons)", true, usage, latencyMs);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJson(choice?.message?.content ?? ""));
    } catch {
      throw new LlmError("invalid_output", "Réponse qui n'est pas du JSON", true, usage, latencyMs);
    }
    const parsed = req.schema.safeParse(parsedJson);
    if (!parsed.success) throw new LlmError("invalid_output", "Sortie non conforme au schéma", true, usage, latencyMs);
    return {
      output: parsed.data,
      model: data.model ?? this.model,
      usage,
      latencyMs,
      reportedCostUsd: typeof data.usage?.cost === "number" ? data.usage.cost : undefined,
    };
  }
}
