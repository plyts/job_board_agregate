"use client";

import { useState, useTransition } from "react";
import { finalizeCvAction } from "@/app/(app)/offres/[id]/cv/actions";
import { Button } from "@/components/ui/Button";

export function FinalizeButton({ versionId, disabled }: { versionId: string; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="primary"
        disabled={pending || disabled}
        onClick={() => {
          if (!window.confirm("Finaliser cette version ? Elle ne pourra plus être modifiée.")) return;
          startTransition(async () => {
            const r = await finalizeCvAction(versionId);
            setProblems(r.problems ?? []);
          });
        }}
      >
        {pending ? "Finalisation…" : "Finaliser cette version"}
      </Button>
      {problems.length ? (
        <div role="alert" className="flex flex-col gap-1 text-sm text-danger">
          <p className="font-semibold">Finalisation impossible :</p>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
