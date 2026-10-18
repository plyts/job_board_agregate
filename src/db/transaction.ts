import type { Pool, PoolClient } from "pg";
import { createDb, type Db } from "./client";

export type TxContext = {
  db: Db;
  /** Connexion brute de la transaction, transmise à pg-boss pour une mise en file atomique. */
  client: PoolClient;
};

/**
 * Exécute `fn` dans une transaction : l'écriture métier et la mise en file d'une tâche
 * sont validées ou annulées ensemble.
 */
export async function withTransaction<T>(pool: Pool, fn: (tx: TxContext) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn({ db: createDb(client), client });
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
