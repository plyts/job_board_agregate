"use client";

import { useActionState } from "react";
import { requestMatchAction, type RequestMatchState } from "@/app/(app)/offres/[id]/matching/actions";
import { Button } from "@/components/ui/Button";

export function RequestMatchButton({ offerId, label = "Comparer à mon profil" }: { offerId: string; label?: string }) {
  const [state, action, pending] = useActionState<RequestMatchState, FormData>(() => requestMatchAction(offerId), {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Lancement…" : label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
