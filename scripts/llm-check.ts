/**
 * Vérifie la configuration des fournisseurs IA : clé, modèle et sortie JSON structurée.
 * Envoie une très courte requête à chaque fournisseur actif (consomme 1 requête de quota).
 * Anthropic, payant, n'est testé qu'avec --include-paid.
 * Usage : npm run llm:check [-- --include-paid]
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { createRouterFromEnv, providerStatuses } from "../src/modules/platform/llm/providers";
import { LlmError } from "../src/modules/platform/llm/types";

const { values } = parseArgs({ options: { "include-paid": { type: "boolean" } } });
const Probe = z.object({ title: z.string(), city: z.string().nullable() });

for (const s of providerStatuses()) {
  const policy = `données personnelles : ${s.policy.allowsPersonalData ? "autorisées" : "refusées"} · ${s.policy.requestsPerMinute ?? "∞"}/min · ${s.policy.requestsPerDay ?? "∞"}/jour`;
  console.log(`${s.enabled ? "●" : "○"} ${s.label} — ${s.enabled ? s.model : `inactif (manque ${s.missing.join(", ")})`} — ${policy}`);
  console.log(`    ${s.dataNote}`);
}

const router = createRouterFromEnv();
for (const { client } of router?.providers ?? []) {
  if (client.provider === "anthropic" && !values["include-paid"]) {
    console.log(`- anthropic : non testé (payant, ajouter --include-paid)`);
    continue;
  }
  try {
    const r = await client.generateStructured({
      purpose: "llm.check",
      promptVersion: "check-v1",
      schemaVersion: 1,
      dataClass: "public",
      system: "Extrait l'intitulé du poste et la ville.",
      user: "Offre : Data Engineer confirmé, poste basé à Lyon.",
      schema: Probe,
      maxTokens: 200,
      effort: "low",
    });
    console.log(`✓ ${client.provider} (${r.model}) : ${JSON.stringify(r.output)} en ${r.latencyMs} ms`);
  } catch (err) {
    console.log(`✗ ${client.provider} : ${err instanceof LlmError ? `${err.code} — ${err.message}` : String(err)}`);
    process.exitCode = 1;
  }
}
if (!router) console.log("Aucun fournisseur actif : renseigne au moins une clé et un modèle (voir .env.example).");
