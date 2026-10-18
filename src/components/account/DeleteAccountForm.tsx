"use client";

import { useActionState } from "react";
import { deleteAccountAction, type DeleteAccountState } from "@/app/(app)/reglages/compte/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(deleteAccountAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Label>
          E-mail du compte
          <Input name="email" type="email" autoComplete="email" required defaultValue={state.email ?? ""} />
        </Label>
        <Label>
          Mot de passe
          <Input name="password" type="password" autoComplete="current-password" required />
        </Label>
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" required defaultChecked={state.confirmed ?? false} className="size-4 accent-[var(--danger)]" />
        Je comprends que la suppression est définitive, documents envoyés compris.
      </label>
      <Button type="submit" variant="danger" disabled={pending} className="self-start">
        {pending ? "Suppression…" : "Supprimer définitivement mon compte"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
