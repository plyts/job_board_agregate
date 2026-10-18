/**
 * Évalue l'extraction des offres sur le jeu de référence (eval/offers/*.json), fournisseur par fournisseur.
 * Appelle réellement les modèles configurés. Les offres gratuites ne coûtent rien mais consomment les quotas ;
 * Anthropic est payant. Usage : npm run eval:offers -- --yes [--provider groq]
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildExtractionUserMessage, EXTRACTION_PROMPT_VERSION, EXTRACTION_SYSTEM } from "../src/modules/analysis/prompt";
import { OfferExtraction } from "../src/modules/analysis/schema";
import { verifyExtraction } from "../src/modules/analysis/verify";
import { createRouterFromEnv } from "../src/modules/platform/llm/providers";
import { LlmError } from "../src/modules/platform/llm/types";
import { scoreCase, type CaseScore, type EvalCase } from "./score";

const { values } = parseArgs({ options: { yes: { type: "boolean" }, provider: { type: "string" } } });
if (!values.yes) {
  console.error("Cette évaluation appelle réellement les fournisseurs configurés (quotas gratuits, ou coût pour Anthropic). Relancer avec --yes.");
  process.exit(1);
}
const router = createRouterFromEnv();
const providers = (router?.providers ?? []).filter((p) => !values.provider || p.client.provider === values.provider);
if (!providers.length) {
  console.error("Aucun fournisseur configuré (voir .env.example et npm run llm:check).");
  process.exit(1);
}

const dir = path.resolve("eval/offers");
const cases: EvalCase[] = [];
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
  cases.push(JSON.parse(await readFile(path.join(dir, file), "utf8")) as EvalCase);
}

for (const { client } of providers) {
  const scores: CaseScore[] = [];
  const errors: string[] = [];
  let latency = 0;
  let cost = 0;
  for (const c of cases) {
    try {
      const result = await client.generateStructured({
        purpose: "eval.offer.extract",
        promptVersion: EXTRACTION_PROMPT_VERSION,
        schemaVersion: 1,
        dataClass: "public",
        system: EXTRACTION_SYSTEM,
        user: buildExtractionUserMessage(c.text),
        schema: OfferExtraction,
        maxTokens: 16000,
        effort: "medium",
      });
      latency += result.latencyMs;
      cost += result.reportedCostUsd ?? client.estimateCostUsd(result.model, result.usage);
      const score = scoreCase(c, verifyExtraction(c.text, result.output));
      scores.push(score);
      console.log(JSON.stringify({ provider: client.provider, ...score, latencyMs: result.latencyMs }));
    } catch (err) {
      errors.push(`${c.id}: ${err instanceof LlmError ? `${err.code} ${err.message}` : String(err)}`);
    }
  }
  const avg = (k: "recall" | "importanceAgreement") => (scores.length ? scores.reduce((s, x) => s + x[k], 0) / scores.length : 0);
  console.log(
    JSON.stringify({
      summary: true,
      provider: client.provider,
      model: client.model,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      cases: cases.length,
      succeeded: scores.length,
      recall: Number(avg("recall").toFixed(3)),
      importanceAgreement: Number(avg("importanceAgreement").toFixed(3)),
      invalidQuotes: scores.reduce((s, x) => s + x.invalidQuotes, 0),
      forbiddenFound: scores.flatMap((x) => x.forbiddenFound.map((f) => `${x.id}:${f}`)),
      avgLatencyMs: scores.length ? Math.round(latency / scores.length) : null,
      totalCostUsd: Number(cost.toFixed(4)),
      errors,
    }),
  );
}
