"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/** Bouton qui déclenche une Server Action liée côté serveur et affiche son erreur éventuelle. */
export function ActionButton({
  action,
  label,
  pendingLabel = "…",
  variant = "secondary",
  confirm,
  className,
}: {
  action: () => Promise<{ error?: string } | void>;
  label: string;
  pendingLabel?: string;
  variant?: Variant;
  confirm?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            setError(null);
            const r = await action();
            if (r && r.error) setError(r.error);
          });
        }}
      >
        {pending ? pendingLabel : label}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
