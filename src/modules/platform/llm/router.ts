import type { DataClass, LlmClient } from "./types";

export type ProviderPolicy = {
  allowsPersonalData: boolean;
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
};

export type RoutedProvider = { client: LlmClient; policy: ProviderPolicy };

const MINUTE = 60_000;
/** Pause appliquée après un 429 sans en-tête retry-after. */
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Ordre de priorité des fournisseurs, filtre des données personnelles et limites de débit locales.
 * Les limites journalières sont vérifiées par le journal à partir de `llm_calls` (persistant).
 */
export class LlmRouter {
  private readonly recent = new Map<string, number[]>();
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    readonly providers: RoutedProvider[],
    private readonly now: () => number = Date.now,
  ) {}

  eligible(dataClass: DataClass): RoutedProvider[] {
    return this.providers.filter((p) => dataClass === "public" || p.policy.allowsPersonalData);
  }

  /** Réserve un appel dans la fenêtre glissante d'une minute ; faux si le fournisseur est en pause ou saturé. */
  tryAcquire(p: RoutedProvider): boolean {
    const key = p.client.provider;
    const t = this.now();
    if ((this.cooldownUntil.get(key) ?? 0) > t) return false;
    const window = (this.recent.get(key) ?? []).filter((ts) => t - ts < MINUTE);
    if (p.policy.requestsPerMinute !== null && window.length >= p.policy.requestsPerMinute) {
      this.recent.set(key, window);
      return false;
    }
    window.push(t);
    this.recent.set(key, window);
    return true;
  }

  markRateLimited(provider: string, retryAfterMs?: number): void {
    this.cooldownUntil.set(provider, this.now() + (retryAfterMs ?? DEFAULT_COOLDOWN_MS));
  }
}
