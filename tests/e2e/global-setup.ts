import { eq } from "drizzle-orm";
import { createDb, createPool } from "../../src/db/client";
import { loginAttempts } from "../../src/db/schema";
import { runMigrations } from "../../src/db/migrate";
import { createUser, findUserByEmail } from "../../src/modules/identity";
import { E2E_USER } from "./fixtures";

/** Prépare la base e2e : migrations et compte de test. */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL est requise pour les tests e2e");
  const pool = createPool(url);
  try {
    const db = createDb(pool);
    await runMigrations(db);
    if (!(await findUserByEmail(db, E2E_USER.email))) await createUser(db, E2E_USER);
    // Les échecs volontaires des scénarios précédents ne doivent pas verrouiller le compte.
    await db.delete(loginAttempts).where(eq(loginAttempts.email, E2E_USER.email));
  } finally {
    await pool.end();
  }
}
