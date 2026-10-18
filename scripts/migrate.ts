import { createDb, createPool } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL n'est pas définie");
  process.exit(1);
}
const pool = createPool(url);
try {
  await runMigrations(createDb(pool));
  console.log("Migrations appliquées.");
} finally {
  await pool.end();
}
