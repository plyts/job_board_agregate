"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Field";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Label>
        E-mail
        <Input name="email" type="email" autoComplete="username" required defaultValue={state.email} aria-describedby="login-error" />
      </Label>
      <Label>
        Mot de passe
        <Input name="password" type="password" autoComplete="current-password" required aria-describedby="login-error" />
      </Label>
      <FieldError id="login-error">{state.error}</FieldError>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}
