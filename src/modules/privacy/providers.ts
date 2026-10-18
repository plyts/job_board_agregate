import type { Db } from "@/db/client";
import { providerStatuses, type ProviderStatus } from "@/modules/platform/llm/providers";
import { consentedProviders, NO_CONSENT_NEEDED } from "./consent";

/** Fournisseurs qui peuvent réellement recevoir des données personnelles : configurés, autorisés et consentis. */
export async function personalDataProviders(db: Db, userId: string): Promise<{ usable: ProviderStatus[]; awaitingConsent: ProviderStatus[] }> {
  const consented = await consentedProviders(db, userId);
  const allowed = providerStatuses().filter((p) => p.enabled && p.policy.allowsPersonalData);
  return {
    usable: allowed.filter((p) => NO_CONSENT_NEEDED.has(p.id) || consented.has(p.id)),
    awaitingConsent: allowed.filter((p) => !NO_CONSENT_NEEDED.has(p.id) && !consented.has(p.id)),
  };
}
