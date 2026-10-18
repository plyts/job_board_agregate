"use client";

import { useState, useTransition } from "react";
import { setConsentAction } from "@/app/(app)/reglages/ia/actions";
import { Button } from "@/components/ui/Button";

export function ConsentButton({ provider, label, region, granted }: { provider: string; label: string; region: string; granted: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-start gap-1">
      <Button
        className="min-h-9 px-3"
        variant={granted ? "secondary" : "primary"}
        disabled={pending}
        aria-label={granted ? `Retirer mon consentement pour ${label}` : `Consentir à l'envoi de mon CV masqué à ${label}`}
        onClick={() => {
          if (!granted && !window.confirm(`Autoriser l'envoi de ton CV et de tes candidatures, données personnelles masquées, à ${label} ? Lieu de traitement déclaré : ${region}. Tu peux retirer ce consentement à tout moment.`)) return;
          startTransition(async () => {
            const r = await setConsentAction(provider, !granted);
            setError(r.error ?? null);
          });
        }}
      >
        {pending ? "…" : granted ? "Retirer" : "Consentir"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
