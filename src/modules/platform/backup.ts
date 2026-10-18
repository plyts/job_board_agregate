import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { backupRuns } from "@/db/schema";

type Env = Record<string, string | undefined>;

/** Tous les jours à 03:15, heure de `APP_TIME_ZONE` : en dehors des heures d'usage. */
export const DEFAULT_BACKUP_CRON = "15 3 * * *";
/** Au-delà, la dernière sauvegarde réussie est signalée comme trop ancienne. */
export const BACKUP_MAX_AGE_HOURS = 26;
const SCRIPT_TIMEOUT_MS = 30 * 60 * 1000;

export type BackupConfig =
  | { enabled: true; dir: string; retentionDays: number; cron: string; timeZone: string; offsite: boolean }
  | { enabled: false; missing: string[]; cron: string; timeZone: string };

/** Configuration lue dans l'environnement ; la phrase de passe n'est jamais renvoyée. */
export function backupConfig(env: Env = process.env): BackupConfig {
  const cron = env.BACKUP_CRON?.trim() || DEFAULT_BACKUP_CRON;
  const timeZone = env.APP_TIME_ZONE ?? "Europe/Paris";
  const missing = ["DATABASE_URL", "BACKUP_DIR", "BACKUP_PASSPHRASE"].filter((k) => !env[k]);
  if (missing.length) return { enabled: false, missing, cron, timeZone };
  const retention = Number(env.BACKUP_RETENTION_DAYS ?? 30);
  return {
    enabled: true,
    dir: env.BACKUP_DIR!,
    retentionDays: Number.isInteger(retention) && retention > 0 ? retention : 30,
    cron,
    timeZone,
    offsite: Boolean(env.BACKUP_COPY_COMMAND),
  };
}

/** Retire d'un message d'erreur ce qui pourrait révéler un secret (identifiants d'une URL, phrase de passe). */
export function redactSecrets(message: string, env: Env = process.env): string {
  let out = message.replace(/(\w+:\/\/)[^\s/@]+@/g, "$1***@");
  if (env.BACKUP_PASSPHRASE) out = out.replaceAll(env.BACKUP_PASSPHRASE, "***");
  return out.trim().slice(-600);
}

/** Lance la sauvegarde ; renvoie le chemin de l'archive produite. */
export type BackupExec = () => Promise<string>;

/** Exécute `scripts/backup.sh` (pg_dump, tar, openssl) avec l'environnement du worker. */
export function scriptExec(script = path.resolve("scripts/backup.sh"), env: Env = process.env): BackupExec {
  return () =>
    new Promise((resolve, reject) => {
      const child = spawn("bash", [script], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), SCRIPT_TIMEOUT_MS);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        const archive = out.trim().split("\n").at(-1) ?? "";
        if (code === 0 && archive) resolve(archive);
        else reject(new Error(err.trim() || `sauvegarde interrompue (${signal ?? `code ${code}`})`));
      });
    });
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export type BackupRun = typeof backupRuns.$inferSelect;

/** Une sauvegarde : ligne « en cours », exécution, puis résultat (taille, empreinte) ou erreur sans secret. */
export async function runBackup(db: Db, exec: BackupExec, trigger: BackupRun["trigger"], env: Env = process.env): Promise<BackupRun> {
  const [run] = await db.insert(backupRuns).values({ trigger }).returning();
  try {
    const archive = await exec();
    const [info, sha256] = await Promise.all([stat(archive), sha256File(archive)]);
    const [done] = await db
      .update(backupRuns)
      .set({ status: "ok", finishedAt: new Date(), fileName: path.basename(archive), sizeBytes: info.size, sha256 })
      .where(eq(backupRuns.id, run!.id))
      .returning();
    return done!;
  } catch (e) {
    const [failed] = await db
      .update(backupRuns)
      .set({ status: "failed", finishedAt: new Date(), error: redactSecrets(e instanceof Error ? e.message : String(e), env) })
      .where(eq(backupRuns.id, run!.id))
      .returning();
    return failed!;
  }
}

/** Une sauvegarde « en cours » depuis plus de 2 heures a été interrompue (worker arrêté) : elle est marquée en échec. */
export async function closeInterruptedBackups(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .update(backupRuns)
    .set({ status: "failed", finishedAt: now, error: "Interrompue (worker arrêté pendant la sauvegarde)." })
    .where(and(eq(backupRuns.status, "running"), lt(backupRuns.startedAt, new Date(now.getTime() - 2 * 60 * 60 * 1000))))
    .returning({ id: backupRuns.id });
  return rows.length;
}

export async function listBackupRuns(db: Db, limit = 20): Promise<BackupRun[]> {
  return db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(limit);
}

/** Dernière sauvegarde réussie, et si elle est trop ancienne pour une planification quotidienne. */
export async function backupFreshness(db: Db, now = new Date()): Promise<{ last: BackupRun | null; stale: boolean }> {
  const [last] = await db.select().from(backupRuns).where(eq(backupRuns.status, "ok")).orderBy(desc(backupRuns.startedAt)).limit(1);
  return { last: last ?? null, stale: !last || now.getTime() - last.startedAt.getTime() > BACKUP_MAX_AGE_HOURS * 60 * 60 * 1000 };
}
