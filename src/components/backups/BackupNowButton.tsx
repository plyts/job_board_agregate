"use client";

import { useState, useTransition } from "react";
import { requestBackupAction } from "@/app/(app)/reglages/sauvegardes/actions";
import { Button } from "@/components/ui/Button";

export function BackupNowButton({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string; ok?: boolean }>({});
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="primary"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            setState(await requestBackupAction());
          })
        }
      >
        {pending ? "Demande…" : "Sauvegarder maintenant"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : state.ok ? (
        <p role="status" className="text-sm text-accent">
          Sauvegarde demandée : le worker la lance dans quelques secondes. Recharge la page pour voir le résultat.
        </p>
      ) : null}
    </div>
  );
}
