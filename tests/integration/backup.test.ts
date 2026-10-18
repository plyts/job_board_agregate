import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { backupRuns } from "@/db/schema";
import { backupFreshness, closeInterruptedBackups, listBackupRuns, runBackup, scriptExec } from "@/modules/platform";
import { closeTestDb, getTestDb, resetDb } from "./db";

describe("sauvegardes planifiées", async () => {
  const db = await getTestDb();
  const dir = await mkdtemp(path.join(tmpdir(), "jobpilot-backup-"));

  async function script(name: string, body: string) {
    const file = path.join(dir, name);
    await writeFile(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    await chmod(file, 0o755);
    return file;
  }

  beforeEach(async () => {
    await resetDb(db);
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("journalise une sauvegarde réussie avec le nom, la taille et l'empreinte de l'archive", async () => {
    const ok = await script("ok.sh", `printf 'archive' > "$BACKUP_DIR/jobpilot-test.tar.enc"\necho "progression" >&2\necho "$BACKUP_DIR/jobpilot-test.tar.enc"`);
    const run = await runBackup(db, scriptExec(ok, { ...process.env, BACKUP_DIR: dir }), "schedule");
    expect(run).toMatchObject({
      trigger: "schedule",
      status: "ok",
      fileName: "jobpilot-test.tar.enc",
      sizeBytes: 7,
      sha256: createHash("sha256").update("archive").digest("hex"),
      error: null,
    });
    expect(run.finishedAt).not.toBeNull();
    expect((await backupFreshness(db)).stale).toBe(false);
  });

  it("journalise un échec sans les secrets de l'environnement", async () => {
    const env = { ...process.env, BACKUP_PASSPHRASE: "phrase-tres-secrete", DATABASE_URL: "postgres://jobpilot:motdepasse@db:5432/jobpilot" };
    const fails = await script("fails.sh", `echo "pg_dump: connexion à $DATABASE_URL refusée ; clé $BACKUP_PASSPHRASE" >&2\nexit 1`);
    const run = await runBackup(db, scriptExec(fails, env), "manual", env);
    expect(run.status).toBe("failed");
    expect(run.error).toBe("pg_dump: connexion à postgres://***@db:5432/jobpilot refusée ; clé ***");
    expect((await backupFreshness(db)).stale).toBe(true);
  });

  it("marque en échec une sauvegarde restée « en cours » après un arrêt du worker, et garde l'historique le plus récent d'abord", async () => {
    const now = new Date("2026-10-18T12:00:00Z");
    await db.insert(backupRuns).values([
      { trigger: "schedule", status: "running", startedAt: new Date("2026-10-18T08:00:00Z") },
      { trigger: "manual", status: "running", startedAt: new Date("2026-10-18T11:30:00Z") },
    ]);
    expect(await closeInterruptedBackups(db, now)).toBe(1);
    const runs = await listBackupRuns(db);
    expect(runs.map((r) => [r.trigger, r.status])).toEqual([
      ["manual", "running"],
      ["schedule", "failed"],
    ]);
    const [interrupted] = await db.select().from(backupRuns).where(eq(backupRuns.status, "failed"));
    expect(interrupted!.error).toContain("Interrompue");
  });
});
