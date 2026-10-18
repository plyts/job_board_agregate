import { PgBoss, type Job, type Queue } from "pg-boss";
import type { PoolClient } from "pg";

/**
 * Files de tâches déclarées une seule fois. Les reprises (3 essais, temporisation exponentielle)
 * et l'expiration des tâches bloquées (expireInSeconds) sont gérées par pg-boss.
 * Politique « exclusive » : une seule tâche en attente ou en cours par singletonKey, ce qui rend
 * la mise en file idempotente. Une politique ne se modifie pas : changer de politique impose de
 * supprimer puis recréer la file.
 */
export const QUEUES = {
  "offer.analyze": {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 300,
  },
  "profile.extract": {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 300,
  },
  "match.compute": {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 300,
  },
  "cv.suggest": {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 300,
  },
  "letter.draft": {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 300,
  },
  /** Balayage planifié : remet en file les analyses en attente (budget atteint, worker arrêté). */
  "offer.resume": { policy: "exclusive", retryLimit: 0, expireInSeconds: 120 },
} satisfies Record<string, Omit<Queue, "name">>;

export type QueueName = keyof typeof QUEUES;

export function createBoss(connectionString: string, role: "web" | "worker"): PgBoss {
  return new PgBoss({
    connectionString,
    max: role === "web" ? 2 : 5,
    // Seul le worker assure la maintenance et la planification.
    supervise: role === "worker",
    schedule: role === "worker",
  });
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUES)) {
    if (!(await boss.getQueue(name))) await boss.createQueue(name, options);
  }
}

export const SCHEDULES: { queue: QueueName; cron: string }[] = [{ queue: "offer.resume", cron: "*/30 * * * *" }];

export function analysisJobOptions(offerId: string) {
  return { singletonKey: `offer:${offerId}` };
}

export function extractionJobOptions(versionId: string) {
  return { singletonKey: `profile:${versionId}` };
}

export function matchJobOptions(matchId: string) {
  return { singletonKey: `match:${matchId}` };
}

export function suggestJobOptions(draftId: string) {
  return { singletonKey: `cv:${draftId}` };
}

export function letterJobOptions(applicationId: string) {
  return { singletonKey: `letter:${applicationId}` };
}

/** Adaptateur pg-boss sur la connexion d'une transaction en cours. */
export function transactionDb(client: PoolClient) {
  return { executeSql: (text: string, values?: unknown[]) => client.query(text, values as unknown[]) };
}

const globalForBoss = globalThis as unknown as { jobpilotBoss?: Promise<PgBoss> };

/** Instance pg-boss du processus web (envoi uniquement). */
export function getBoss(): Promise<PgBoss> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas définie");
  globalForBoss.jobpilotBoss ??= (async () => {
    const boss = createBoss(url, "web");
    boss.on("error", () => {});
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })();
  return globalForBoss.jobpilotBoss;
}

export type { Job };
