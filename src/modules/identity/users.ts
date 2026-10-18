import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, PASSWORD_MIN_LENGTH } from "./password";

export const NewUserInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("E-mail invalide")),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Au moins ${PASSWORD_MIN_LENGTH} caractères`).max(256),
});

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Création réservée au script d'administration : il n'existe pas d'inscription publique. */
export async function createUser(db: Db, input: z.input<typeof NewUserInput>): Promise<{ id: string; email: string }> {
  const data = NewUserInput.parse(input);
  const [row] = await db
    .insert(users)
    .values({ email: data.email, displayName: data.displayName, passwordHash: await hashPassword(data.password) })
    .returning({ id: users.id, email: users.email });
  if (!row) throw new Error("Création de l'utilisateur impossible");
  return row;
}

export async function findUserByEmail(db: Db, email: string) {
  const rows = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  return rows[0] ?? null;
}
