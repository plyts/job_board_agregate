import "server-only";
import { getDb, getPool } from "@/db/client";
import type { ApplicationsDeps } from "@/modules/applications";
import { getStorage } from "@/modules/platform";

export function getApplicationsDeps(): ApplicationsDeps {
  return { db: getDb(), pool: getPool(), storage: getStorage() };
}
