import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

export const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
