import { costUsd } from "./pricing";
import { LlmError, ZERO_USAGE, type LlmClient, type LlmResult, type LlmUsage, type StructuredRequest } from "./types";

type Scripted = { output: unknown } | { error: LlmError };

/** Client de test : renvoie des réponses programmées et mémorise les requêtes reçues. */
export class FakeLlmClient implements LlmClient {
  readonly requests: StructuredRequest<unknown>[] = [];
  private readonly queue: Scripted[] = [];

  constructor(
    readonly model = "claude-opus-5-5",
    private readonly usage = { inputTokens: 2000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0 },
    readonly provider = "anthropic",
  ) {}

  estimateCostUsd(model: string, usage: LlmUsage): number {
    return this.provider === "anthropic" ? costUsd(model, usage) : 0;
  }

  respondWith(output: unknown): this {
    this.queue.push({ output });
    return this;
  }

  failWith(error: LlmError): this {
    this.queue.push({ error });
    return this;
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>> {
    this.requests.push(req as StructuredRequest<unknown>);
    const next = this.queue.shift();
    if (!next) throw new Error("FakeLlmClient : aucune réponse programmée");
    if ("error" in next) throw next.error;
    const parsed = req.schema.safeParse(next.output);
    if (!parsed.success) throw new LlmError("invalid_output", "Sortie non conforme au schéma", true, ZERO_USAGE, 5);
    return { output: parsed.data, model: this.model, usage: this.usage, latencyMs: 5 };
  }
}
