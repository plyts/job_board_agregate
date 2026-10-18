"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { SESSION_COOKIE, safeNextPath, sessionCookieOptions } from "@/lib/auth/cookie";
import { invalidateSession, login } from "@/modules/identity";

export type LoginState = { error?: string; email?: string };

const LoginInput = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  if (!parsed.success) return { error: "Renseigne ton e-mail et ton mot de passe.", email };

  const result = await login(getDb(), parsed.data.email, parsed.data.password);
  if (!result.ok) {
    return {
      email,
      error:
        result.reason === "locked"
          ? "Trop de tentatives échouées. Réessaie dans 15 minutes."
          : "E-mail ou mot de passe incorrect.",
    };
  }
  (await cookies()).set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
  redirect(safeNextPath(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(getDb(), token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
