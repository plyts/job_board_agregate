"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { deleteAccount } from "@/modules/account";
import { getStorage, logger } from "@/modules/platform";

/** En cas d'erreur, l'e-mail et la confirmation sont rendus au formulaire ; le mot de passe est à ressaisir. */
export type DeleteAccountState = { error?: string; email?: string; confirmed?: boolean };

/** Suppression définitive : confirmée par l'e-mail et le mot de passe, puis déconnexion. */
export async function deleteAccountAction(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const user = await requireUser();
  const email = formData.get("email");
  const password = formData.get("password");
  const confirmed = formData.get("confirm") === "on";
  if (typeof email !== "string" || typeof password !== "string" || !confirmed) {
    return { error: "Coche la confirmation et renseigne ton e-mail et ton mot de passe.", email: typeof email === "string" ? email : "", confirmed };
  }
  const result = await deleteAccount({ db: getDb(), storage: getStorage() }, user.id, { email, password });
  if (!result.ok) return { error: result.error, email, confirmed };
  logger.info({ filesDeleted: result.filesDeleted }, "compte supprimé");
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login?compte=supprime");
}
