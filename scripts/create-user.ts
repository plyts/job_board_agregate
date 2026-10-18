/**
 * Crée le compte propriétaire (pas d'inscription publique).
 * Usage : JOBPILOT_PASSWORD=… npm run user:create -- --email moi@exemple.fr --name "Mon nom"
 */
import { parseArgs } from "node:util";
import { createDb, createPool } from "../src/db/client";
import { createUser } from "../src/modules/identity";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const password = process.env.JOBPILOT_PASSWORD;
if (!values.email || !values.name || !password || !process.env.DATABASE_URL) {
  console.error('Usage : DATABASE_URL=… JOBPILOT_PASSWORD=… npm run user:create -- --email <e-mail> --name "<nom>"');
  process.exit(1);
}
const pool = createPool(process.env.DATABASE_URL);
try {
  const user = await createUser(createDb(pool), { email: values.email, displayName: values.name, password });
  console.log(`Compte créé : ${user.email}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
