import type { Job } from "pg-boss";
import type { QueueName } from "@/modules/platform/queue";

export type JobHandler = (jobs: Job<Record<string, unknown>>[]) => Promise<void>;

/** Associe chaque file à son traitement. Rempli par les modules métier. */
export const handlers: Partial<Record<QueueName, JobHandler>> = {};
