import { AnthropicLlmClient, DEFAULT_MODEL } from "./anthropic";
import { OpenAICompatibleLlmClient, type JsonMode } from "./openai-compatible";
import { LlmRouter, type ProviderPolicy } from "./router";
import type { LlmClient } from "./types";

export type ProviderId = "local" | "groq" | "cerebras" | "gemini" | "mistral" | "openrouter" | "anthropic";

type Preset = {
  id: ProviderId;
  label: string;
  envPrefix: string;
  baseUrl?: string;
  /** Limites indicatives de l'offre gratuite relevées le 18/10/2026 (sources secondaires) : à ajuster sur la console. */
  rpm: number | null;
  rpd: number | null;
  /** Usage des données sur l'offre gratuite, tel que rapporté publiquement. À vérifier avant toute donnée personnelle. */
  dataNote: string;
  /** Lieu de traitement déclaré par le fournisseur (transferts hors UE) : à vérifier dans ses conditions. */
  region: string;
  headers?: Record<string, string>;
};

export const PROVIDER_PRESETS: Preset[] = [
  { id: "local", label: "Modèle local (Ollama, LM Studio)", envPrefix: "LOCAL", baseUrl: "http://localhost:11434/v1", rpm: null, rpd: null, dataNote: "Les données restent sur ta machine.", region: "Ta machine (aucun transfert)" },
  { id: "groq", label: "Groq", envPrefix: "GROQ", baseUrl: "https://api.groq.com/openai/v1", rpm: 30, rpd: 1000, dataNote: "Conditions d'usage des données à vérifier.", region: "États-Unis" },
  { id: "cerebras", label: "Cerebras", envPrefix: "CEREBRAS", baseUrl: "https://api.cerebras.ai/v1", rpm: 5, rpd: null, dataNote: "Offre gratuite destinée à l'expérimentation ; usage des données à vérifier.", region: "États-Unis" },
  { id: "gemini", label: "Google Gemini", envPrefix: "GEMINI", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", rpm: null, rpd: null, dataNote: "Offre gratuite : contenus utilisés pour améliorer les produits Google.", region: "Google, infrastructure mondiale (hors UE possible)" },
  { id: "mistral", label: "Mistral (La Plateforme)", envPrefix: "MISTRAL", baseUrl: "https://api.mistral.ai/v1", rpm: 60, rpd: null, dataNote: "Offre Experiment : accord pour l'entraînement sur tes données requis.", region: "Union européenne (France)" },
  {
    id: "openrouter",
    label: "OpenRouter",
    envPrefix: "OPENROUTER",
    baseUrl: "https://openrouter.ai/api/v1",
    rpm: 20,
    rpd: 50,
    dataNote: "Modèles « :free » : selon l'hébergeur, les requêtes peuvent être journalisées.",
    region: "États-Unis, puis l'hébergeur du modèle choisi",
    headers: { "X-Title": "JobPilot" },
  },
  { id: "anthropic", label: "Anthropic Claude (payant)", envPrefix: "ANTHROPIC", rpm: null, rpd: null, dataNote: "API payante : pas d'entraînement sur les données par défaut.", region: "États-Unis" },
];

/** Ordre par défaut : local, puis gratuits, puis payant. */
const DEFAULT_ORDER: ProviderId[] = ["local", "groq", "cerebras", "gemini", "mistral", "openrouter", "anthropic"];

type Env = Record<string, string | undefined>;

function intOrNull(raw: string | undefined, fallback: number | null): number | null {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "0" || raw.toLowerCase() === "none") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  enabled: boolean;
  /** Raison pour laquelle le fournisseur est inactif (clé ou modèle manquant). */
  missing: string[];
  model: string | null;
  policy: ProviderPolicy;
  dataNote: string;
  /** Lieu de traitement déclaré (transferts hors UE, RGPD chap. V) ; à vérifier dans les conditions du fournisseur. */
  region: string;
};

function describe(preset: Preset, env: Env): ProviderStatus & { client: LlmClient | null } {
  const p = preset.envPrefix;
  const apiKey = env[`${p}_API_KEY`] || (preset.id === "anthropic" ? env.ANTHROPIC_AUTH_TOKEN : undefined) || null;
  const model = env[`${p}_MODEL`] || (preset.id === "anthropic" ? DEFAULT_MODEL : null);
  const missing: string[] = [];
  if (!model) missing.push(`${p}_MODEL`);
  if (!apiKey && preset.id !== "local") missing.push(`${p}_API_KEY`);
  const policy: ProviderPolicy = {
    // Données personnelles : refusées par défaut, sauf pour un modèle local.
    allowsPersonalData: (env[`${p}_ALLOW_PERSONAL_DATA`] ?? (preset.id === "local" ? "true" : "false")) === "true",
    requestsPerMinute: intOrNull(env[`${p}_RPM`], preset.rpm),
    requestsPerDay: intOrNull(env[`${p}_RPD`], preset.rpd),
  };
  let client: LlmClient | null = null;
  if (missing.length === 0 && model) {
    client =
      preset.id === "anthropic"
        ? new AnthropicLlmClient(model)
        : new OpenAICompatibleLlmClient({
            provider: preset.id,
            baseUrl: env[`${p}_BASE_URL`] || preset.baseUrl!,
            apiKey,
            model,
            jsonMode: (env[`${p}_JSON_MODE`] as JsonMode | undefined) ?? "json_schema",
            maxTokens: intOrNull(env[`${p}_MAX_TOKENS`], 4096) ?? undefined,
            pricing:
              env[`${p}_PRICE_INPUT_PER_MTOK`] || env[`${p}_PRICE_OUTPUT_PER_MTOK`]
                ? { inputPerMTok: Number(env[`${p}_PRICE_INPUT_PER_MTOK`] ?? 0), outputPerMTok: Number(env[`${p}_PRICE_OUTPUT_PER_MTOK`] ?? 0) }
                : undefined,
            headers: preset.headers,
            extraBody:
              preset.id === "openrouter" && env.OPENROUTER_DATA_COLLECTION
                ? { provider: { data_collection: env.OPENROUTER_DATA_COLLECTION === "deny" ? "deny" : "allow" } }
                : undefined,
          });
  }
  return { id: preset.id, label: preset.label, enabled: client !== null, missing, model, policy, dataNote: preset.dataNote, region: preset.region, client };
}

export function providerOrder(env: Env): ProviderId[] {
  const raw = env.LLM_PROVIDERS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!raw?.length) return DEFAULT_ORDER;
  return raw.filter((id): id is ProviderId => DEFAULT_ORDER.includes(id as ProviderId));
}

/** État de chaque fournisseur (pour l'écran de réglages et `npm run llm:check`), sans jamais exposer de clé. */
export function providerStatuses(env: Env = process.env): ProviderStatus[] {
  const order = providerOrder(env);
  return order.map((id) => {
    const { id: pid, label, enabled, missing, model, policy, dataNote, region } = describe(PROVIDER_PRESETS.find((p) => p.id === id)!, env);
    return { id: pid, label, enabled, missing, model, policy, dataNote, region };
  });
}

/** Routeur construit depuis l'environnement ; null si aucun fournisseur n'est configuré. */
export function createRouterFromEnv(env: Env = process.env): LlmRouter | null {
  const providers = providerOrder(env)
    .map((id) => describe(PROVIDER_PRESETS.find((p) => p.id === id)!, env))
    .filter((d) => d.client !== null)
    .map((d) => ({ client: d.client!, policy: d.policy }));
  return providers.length ? new LlmRouter(providers) : null;
}
