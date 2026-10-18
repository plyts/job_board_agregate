import { sql } from "drizzle-orm";
import { createDb, createPool, type Db } from "@/db/client";
import { runMigrations } from "@/db/migrate";

export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@localhost:5432/jobpilot_test";
const url = TEST_DATABASE_URL;

let state: { db: Db; close: () => Promise<void> } | undefined;

/** Base de test migrée, partagée par les fichiers d'intégration (exécutés en série). */
export async function getTestDb(): Promise<Db> {
  if (!state) {
    const pool = createPool(url);
    const db = createDb(pool);
    await runMigrations(db);
    state = { db, close: () => pool.end() };
  }
  return state.db;
}

export async function resetDb(db: Db): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const tables = rows.rows.map((r) => `"public"."${r.tablename}"`);
  if (tables.length) await db.execute(sql.raw(`truncate ${tables.join(", ")} restart identity cascade`));
}

export async function closeTestDb(): Promise<void> {
  await state?.close();
  state = undefined;
}
