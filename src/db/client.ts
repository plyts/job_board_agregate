import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export function createDb(client: Pool | PoolClient): Db {
  return drizzle(client, { schema });
}

const globalForDb = globalThis as unknown as { jobpilotPool?: Pool };

/** Pool partagé du processus (web ou worker), créé à la première utilisation. */
export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas définie");
  globalForDb.jobpilotPool ??= createPool(url);
  return globalForDb.jobpilotPool;
}

export function getDb(): Db {
  return createDb(getPool());
}
