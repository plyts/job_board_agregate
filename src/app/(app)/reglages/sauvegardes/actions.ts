"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { BACKUP_JOB_OPTIONS, getBoss, logger } from "@/modules/platform";

export type BackupActionState = { error?: string; ok?: boolean };

/** Demande une sauvegarde immédiate au worker (une seule en attente ou en cours à la fois). */
export async function requestBackupAction(): Promise<BackupActionState> {
  await requireUser();
  try {
    const boss = await getBoss();
    const id = await boss.send("backup.run", { trigger: "manual" }, BACKUP_JOB_OPTIONS);
    refresh();
    return id ? { ok: true } : { error: "Une sauvegarde est déjà en attente ou en cours." };
  } catch (err) {
    logger.error({ err }, "demande de sauvegarde en échec");
    return { error: "La demande n'a pas pu être enregistrée. Réessaie dans un instant." };
  }
}
