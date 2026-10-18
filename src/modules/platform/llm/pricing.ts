import type { LlmUsage } from "./types";

/** Tarifs publics en USD par million de jetons (entrée, sortie, lecture de cache). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  // Modèle de repli possible côté serveur ; lecture de cache estimée à 0,1 × l'entrée.
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
};

/** Modèle inconnu (nouveau repli serveur) : tarif le plus élevé connu, pour ne jamais sous-estimer le budget. */
const CONSERVATIVE = { input: 5, output: 25, cacheRead: 0.5 };

/** Écriture de cache facturée 1,25 × le tarif d'entrée. */
const CACHE_WRITE_MULTIPLIER = 1.25;

export function costUsd(model: string, usage: LlmUsage): number {
  const p = PRICES[model] ?? CONSERVATIVE;
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.input * CACHE_WRITE_MULTIPLIER) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function hasPricing(model: string): boolean {
  return model in PRICES;
}
