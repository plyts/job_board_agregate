"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { PROVIDER_PRESETS } from "@/modules/platform";
import { grantConsent, NO_CONSENT_NEEDED, revokeConsent } from "@/modules/privacy";

export type ConsentState = { error?: string };

/** Consentement explicite (RGPD art. 7) ou retrait, pour un fournisseur connu. */
export async function setConsentAction(provider: string, granted: boolean): Promise<ConsentState> {
  const user = await requireUser();
  if (!PROVIDER_PRESETS.some((p) => p.id === provider) || NO_CONSENT_NEEDED.has(provider)) return { error: "Fournisseur inconnu." };
  if (granted) await grantConsent(getDb(), user.id, provider);
  else await revokeConsent(getDb(), user.id, provider);
  refresh();
  return {};
}
