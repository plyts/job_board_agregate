import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { llmCalls } from "@/db/schema";
import { createUser } from "@/modules/identity";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { generateJournaled, providerUsageToday } from "@/modules/platform/llm/journal";
import { LlmRouter, type ProviderPolicy } from "@/modules/platform/llm/router";
import { LlmError, type StructuredRequest } from "@/modules/platform/llm/types";
import { closeTestDb, getTestDb, resetDb } from "./db";

const Schema = z.object({ title: z.string() });
const request = (dataClass: "public" | "personal" = "public"): StructuredRequest<z.infer<typeof Schema>> => ({
  purpose: "test.route",
  promptVersion: "v1",
  schemaVersion: 1,
  dataClass,
  system: "Extrait le titre.",
  user: "<document>Data Engineer</document>",
  schema: Schema,
});

const policy = (p: Partial<ProviderPolicy> = {}): ProviderPolicy => ({ allowsPersonalData: false, requestsPerMinute: null, requestsPerDay: null, ...p });
const free = (provider: string) => new FakeLlmClient(`${provider}-model`, undefined, provider);

describe("routage entre fournisseurs", async () => {
  const db = await getTestDb();
  let userId = "";
  beforeEach(async () => {
    await resetDb(db);
    userId = (await createUser(db, { email: "r@exemple.fr", displayName: "R", password: "un mot de passe solide" })).id;
  });
  afterAll(() => closeTestDb());

  async function statuses() {
    return (await db.select().from(llmCalls)).map((c) => `${c.provider}:${c.status}`).sort();
  }

  it("passe au fournisseur suivant après un refus pour quota, journalise les deux tentatives et met le premier en pause", async () => {
    const groq = free("groq").failWith(new LlmError("rate_limited", "429", true, undefined, 10, 60_000));
    const openrouter = free("openrouter").respondWith({ title: "A" }).respondWith({ title: "B" });
    const router = new LlmRouter([
      { client: groq, policy: policy() },
      { client: openrouter, policy: policy() },
    ]);
    const first = await generateJournaled(db, router, userId, request());
    expect(first).toMatchObject({ provider: "openrouter", costUsd: 0, output: { title: "A" } });
    expect(await statuses()).toEqual(["groq:rate_limited", "openrouter:ok"]);

    // Groq est en pause : il n'est pas rappelé.
    await generateJournaled(db, router, userId, request());
    expect(groq.requests).toHaveLength(1);
    expect(openrouter.requests).toHaveLength(2);
  });

  it("n'envoie jamais de données personnelles à un fournisseur non autorisé", async () => {
    const groq = free("groq").respondWith({ title: "A" });
    const router = new LlmRouter([{ client: groq, policy: policy() }]);
    await expect(generateJournaled(db, router, userId, request("personal"))).rejects.toMatchObject({ code: "no_provider", retryable: false });
    expect(groq.requests).toHaveLength(0);
    expect(await statuses()).toEqual([]);

    const local = free("local").respondWith({ title: "B" });
    const mixed = new LlmRouter([
      { client: groq, policy: policy() },
      { client: local, policy: policy({ allowsPersonalData: true }) },
    ]);
    expect((await generateJournaled(db, mixed, userId, request("personal"))).provider).toBe("local");
    expect(groq.requests).toHaveLength(0);
  });

  it("respecte le quota journalier persistant et signale l'épuisement de tous les quotas", async () => {
    const groq = free("groq").respondWith({ title: "A" });
    const mistral = free("mistral").respondWith({ title: "B" });
    const router = new LlmRouter([
      { client: groq, policy: policy({ requestsPerDay: 1 }) },
      { client: mistral, policy: policy({ requestsPerDay: 1 }) },
    ]);
    expect((await generateJournaled(db, router, userId, request())).provider).toBe("groq");
    expect((await generateJournaled(db, router, userId, request())).provider).toBe("mistral");
    await expect(generateJournaled(db, router, userId, request())).rejects.toMatchObject({ code: "quota_exhausted", retryable: true });
    expect(groq.requests).toHaveLength(1);
    expect(mistral.requests).toHaveLength(1);
  });

  it("signale l'échec de tous les fournisseurs en conservant le caractère reprenable", async () => {
    const router = new LlmRouter([
      { client: free("groq").failWith(new LlmError("invalid_output", "Sortie non conforme", true)), policy: policy() },
      { client: free("gemini").failWith(new LlmError("api_error", "Clé refusée", false)), policy: policy() },
    ]);
    const err = await generateJournaled(db, router, userId, request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: "api_error", retryable: true });
    expect((err as Error).message).toContain("Tous les fournisseurs ont échoué");
    expect(await statuses()).toEqual(["gemini:api_error", "groq:invalid_output"]);
  });

  it("résume la consommation du jour par fournisseur", async () => {
    const router = new LlmRouter([
      { client: free("groq").failWith(new LlmError("rate_limited", "429", true)), policy: policy() },
      { client: free("openrouter").respondWith({ title: "A" }), policy: policy() },
    ]);
    await generateJournaled(db, router, userId, request());
    const usage = Object.fromEntries((await providerUsageToday(db)).map((u) => [u.provider, u]));
    expect(usage.groq).toMatchObject({ calls: 1, ok: 0, failed: 1, avgLatencyMs: null, costUsd: 0 });
    expect(usage.openrouter).toMatchObject({ calls: 1, ok: 1, failed: 0, costUsd: 0 });
    expect(usage.openrouter?.avgLatencyMs).toBe(5);
  });
});
