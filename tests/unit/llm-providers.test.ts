import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { toStrictJsonSchema } from "@/modules/platform/llm/json-schema";
import { extractJson, OpenAICompatibleLlmClient } from "@/modules/platform/llm/openai-compatible";
import { createRouterFromEnv, providerStatuses } from "@/modules/platform/llm/providers";
import { LlmRouter } from "@/modules/platform/llm/router";
import type { StructuredRequest } from "@/modules/platform/llm/types";
import { FakeLlmClient } from "@/modules/platform/llm/fake";

const Schema = z.object({ title: z.string(), years: z.number().int().min(0).nullable(), tags: z.array(z.object({ name: z.string() })) });
const req: StructuredRequest<z.infer<typeof Schema>> = {
  purpose: "test",
  promptVersion: "v1",
  schemaVersion: 1,
  dataClass: "public",
  system: "Extrait.",
  user: "<document>Data Engineer</document>",
  schema: Schema,
};

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
// Corps JSON libre, lu champ par champ dans les assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

describe("schéma JSON strict", () => {
  it("ferme chaque objet, rend toutes les propriétés requises et retire les contraintes non prises en charge", () => {
    const schema = toStrictJsonSchema(Schema) as Loose;
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["title", "years", "tags"]);
    expect(schema.properties.tags.items).toMatchObject({ additionalProperties: false, required: ["name"] });
    expect(JSON.stringify(schema)).not.toMatch(/"minimum"|"maximum"/);
  });

  it("extrait le JSON d'une réponse entourée de raisonnement ou de clôtures Markdown", () => {
    expect(extractJson('<think>je réfléchis</think>\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('  {"a":1} ')).toBe('{"a":1}');
  });
});

describe("client compatible OpenAI", () => {
  let server: Server;
  let baseUrl = "";
  let replies: Reply[] = [];
  let received: { headers: IncomingMessage["headers"]; body: Loose; url: string }[] = [];

  beforeAll(async () => {
    server = createServer((rq, rs) => {
      let raw = "";
      rq.on("data", (c) => (raw += c));
      rq.on("end", () => {
        received.push({ headers: rq.headers, body: JSON.parse(raw || "{}"), url: rq.url ?? "" });
        const reply = replies.shift() ?? { status: 500, body: {} };
        rs.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
        rs.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    replies = [];
    received = [];
  });

  const ok = (content: string, extra: Record<string, unknown> = {}) => ({
    status: 200,
    body: { model: "llama-test", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30 }, ...extra },
  });
  const client = (over: Partial<ConstructorParameters<typeof OpenAICompatibleLlmClient>[0]> = {}) =>
    new OpenAICompatibleLlmClient({ provider: "groq", baseUrl, apiKey: "cle-secrete", model: "llama-test", ...over });

  it("envoie une requête structurée stricte et valide la réponse", async () => {
    replies.push(ok('{"title":"Data Engineer","years":5,"tags":[{"name":"python"}]}'));
    const r = await client().generateStructured(req);
    expect(r.output).toEqual({ title: "Data Engineer", years: 5, tags: [{ name: "python" }] });
    expect(r.usage).toMatchObject({ inputTokens: 120, outputTokens: 30 });
    const sent = received[0]!;
    expect(sent.url).toBe("/v1/chat/completions");
    expect(sent.headers.authorization).toBe("Bearer cle-secrete");
    expect(sent.body).toMatchObject({ model: "llama-test", temperature: 0, response_format: { type: "json_schema", json_schema: { strict: true } } });
    expect(sent.body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });

  it("bascule en mode JSON simple si le modèle refuse le schéma, puis s'y tient", async () => {
    replies.push({ status: 400, body: { error: { message: "response_format json_schema not supported" } } });
    replies.push(ok('```json\n{"title":"A","years":null,"tags":[]}\n```'));
    replies.push(ok('{"title":"B","years":null,"tags":[]}'));
    const c = client();
    expect((await c.generateStructured(req)).output.title).toBe("A");
    expect(received[1]!.body.response_format).toEqual({ type: "json_object" });
    expect(received[1]!.body.messages[0].content).toContain("JSON Schema");
    await c.generateStructured(req);
    expect(received[2]!.body.response_format).toEqual({ type: "json_object" });
  });

  it.each([
    [{ status: 429, body: {}, headers: { "retry-after": "7" } }, { code: "rate_limited", retryable: true, retryAfterMs: 7000 }],
    [{ status: 401, body: {} }, { code: "api_error", retryable: false }],
    [{ status: 404, body: { error: { message: "model not found" } } }, { code: "api_error", retryable: false }],
    [{ status: 503, body: {} }, { code: "api_error", retryable: true }],
  ])("classe l'erreur HTTP %#", async (reply, expected) => {
    replies.push(reply as Reply);
    await expect(client({ jsonMode: "json_object" }).generateStructured(req)).rejects.toMatchObject(expected);
  });

  it.each([
    ["pas du json", "invalid_output", "stop"],
    ['{"title":42}', "invalid_output", "stop"],
    ['{"title":"x"', "truncated", "length"],
    ["", "refused", "content_filter"],
  ])("rejette une réponse inexploitable : %s", async (content, code, finish) => {
    replies.push({ status: 200, body: { choices: [{ message: { content }, finish_reason: finish }] } });
    await expect(client({ jsonMode: "json_object" }).generateStructured(req)).rejects.toMatchObject({ code });
  });

  it("compte 0 $ pour une offre gratuite et reprend le coût annoncé par le fournisseur", async () => {
    const free = client();
    expect(free.estimateCostUsd("x", { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
    const priced = client({ pricing: { inputPerMTok: 0.5, outputPerMTok: 1 } });
    expect(priced.estimateCostUsd("x", { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(1.5);
    replies.push(ok('{"title":"A","years":null,"tags":[]}', { usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0042 } }));
    expect((await free.generateStructured(req)).reportedCostUsd).toBe(0.0042);
  });
});

describe("configuration des fournisseurs", () => {
  it("n'active que les fournisseurs complets, dans l'ordre demandé, sans exposer les clés", () => {
    const env = {
      LLM_PROVIDERS: "openrouter, groq, inconnu",
      GROQ_API_KEY: "gsk-secret",
      GROQ_MODEL: "un-modele",
      OPENROUTER_API_KEY: "sk-or-secret",
    };
    const statuses = providerStatuses(env);
    expect(statuses.map((s) => [s.id, s.enabled])).toEqual([
      ["openrouter", false],
      ["groq", true],
    ]);
    expect(statuses[0]?.missing).toEqual(["OPENROUTER_MODEL"]);
    expect(JSON.stringify(statuses)).not.toMatch(/secret/);
    expect(createRouterFromEnv(env)?.providers.map((p) => p.client.provider)).toEqual(["groq"]);
  });

  it("refuse les données personnelles par défaut, sauf en local, et lit les limites", () => {
    const env = {
      GROQ_API_KEY: "k",
      GROQ_MODEL: "m",
      GROQ_RPD: "0",
      GEMINI_API_KEY: "k",
      GEMINI_MODEL: "m",
      GEMINI_ALLOW_PERSONAL_DATA: "true",
      GEMINI_RPM: "12",
      LOCAL_MODEL: "llama",
    };
    const byId = Object.fromEntries(providerStatuses(env).map((s) => [s.id, s]));
    expect(byId.local?.policy).toEqual({ allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null });
    expect(byId.local?.enabled).toBe(true);
    expect(byId.groq?.policy).toEqual({ allowsPersonalData: false, requestsPerMinute: 30, requestsPerDay: null });
    expect(byId.gemini?.policy).toMatchObject({ allowsPersonalData: true, requestsPerMinute: 12 });
    expect(createRouterFromEnv({})).toBeNull();
  });
});

describe("routeur", () => {
  it("filtre les fournisseurs pour les données personnelles", () => {
    const router = new LlmRouter([
      { client: new FakeLlmClient("m", undefined, "groq"), policy: { allowsPersonalData: false, requestsPerMinute: null, requestsPerDay: null } },
      { client: new FakeLlmClient("m", undefined, "local"), policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } },
    ]);
    expect(router.eligible("public").map((p) => p.client.provider)).toEqual(["groq", "local"]);
    expect(router.eligible("personal").map((p) => p.client.provider)).toEqual(["local"]);
  });

  it("respecte la limite par minute et la pause après un refus pour quota", () => {
    let t = 0;
    const p = { client: new FakeLlmClient("m", undefined, "groq"), policy: { allowsPersonalData: false, requestsPerMinute: 2, requestsPerDay: null } };
    const router = new LlmRouter([p], () => t);
    expect([router.tryAcquire(p), router.tryAcquire(p), router.tryAcquire(p)]).toEqual([true, true, false]);
    t = 60_001;
    expect(router.tryAcquire(p)).toBe(true);
    router.markRateLimited("groq", 5_000);
    t += 4_000;
    expect(router.tryAcquire(p)).toBe(false);
    t += 2_000;
    expect(router.tryAcquire(p)).toBe(true);
  });
});
