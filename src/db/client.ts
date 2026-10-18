import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

const globalForDb = globalThis as unknown as { jobpilotPool?: Pool };

/** Connexion partagée du processus (web ou worker), créée à la première utilisation. */
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas définie");
  globalForDb.jobpilotPool ??= createPool(url);
  return createDb(globalForDb.jobpilotPool);
}
