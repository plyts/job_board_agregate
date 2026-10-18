/**
 * Évalue l'extraction des offres sur le jeu de référence (eval/offers/*.json).
 * Appelle réellement le modèle : coûte de l'argent. Usage : ANTHROPIC_API_KEY=… npm run eval:offers -- --yes
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { buildExtractionUserMessage, EXTRACTION_PROMPT_VERSION, EXTRACTION_SYSTEM } from "../src/modules/analysis/prompt";
import { OfferExtraction } from "../src/modules/analysis/schema";
import { verifyExtraction } from "../src/modules/analysis/verify";
import { AnthropicLlmClient } from "../src/modules/platform/llm/anthropic";
import { costUsd } from "../src/modules/platform/llm/pricing";
import { scoreCase, type CaseScore, type EvalCase } from "./score";

if (!process.argv.includes("--yes")) {
  console.error("Cette évaluation appelle l'API Claude et coûte de l'argent. Relancer avec --yes pour confirmer.");
  process.exit(1);
}

const dir = path.resolve("eval/offers");
const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
const llm = new AnthropicLlmClient();
let totalCost = 0;
const scores: CaseScore[] = [];
for (const file of files) {
  const c = JSON.parse(await readFile(path.join(dir, file), "utf8")) as EvalCase;
  const result = await llm.generateStructured({
    purpose: "eval.offer.extract",
    promptVersion: EXTRACTION_PROMPT_VERSION,
    schemaVersion: 1,
    system: EXTRACTION_SYSTEM,
    user: buildExtractionUserMessage(c.text),
    schema: OfferExtraction,
    maxTokens: 16000,
    effort: "medium",
  });
  const cost = costUsd(result.model, result.usage);
  totalCost += cost;
  const score = scoreCase(c, verifyExtraction(c.text, result.output));
  scores.push(score);
  console.log(JSON.stringify({ ...score, latencyMs: result.latencyMs, costUsd: cost }));
}
const avg = (k: "recall" | "importanceAgreement") => scores.reduce((s, x) => s + x[k], 0) / scores.length;
console.log(
  JSON.stringify({
    promptVersion: EXTRACTION_PROMPT_VERSION,
    model: llm.model,
    cases: scores.length,
    recall: Number(avg("recall").toFixed(3)),
    importanceAgreement: Number(avg("importanceAgreement").toFixed(3)),
    invalidQuotes: scores.reduce((s, x) => s + x.invalidQuotes, 0),
    forbiddenFound: scores.flatMap((x) => x.forbiddenFound.map((f) => `${x.id}:${f}`)),
    totalCostUsd: Number(totalCost.toFixed(4)),
  }),
);
