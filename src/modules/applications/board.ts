import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { boardColumns } from "@/db/schema";
import { APPLICATION_STATUSES, COLUMN_LABEL_MAX, type ApplicationStatus } from "./rules";

/** Réglage d'une colonne : `label` null = nom par défaut de l'étape. */
export type ColumnSetting = { status: ApplicationStatus; label: string | null; hidden: boolean };

/** Les 12 colonnes dans l'ordre du parcours, avec le réglage de l'utilisateur s'il en a un. */
export async function getColumnSettings(db: Db, userId: string): Promise<ColumnSetting[]> {
  const rows = await db.select().from(boardColumns).where(eq(boardColumns.userId, userId));
  const byStatus = new Map(rows.map((r) => [r.status, r]));
  return APPLICATION_STATUSES.map((status) => ({ status, label: byStatus.get(status)?.label ?? null, hidden: byStatus.get(status)?.hidden ?? false }));
}

export type ColumnsValidation = { ok: true; columns: ColumnSetting[] } | { ok: false; error: string };

/**
 * Normalise et vérifie un réglage complet : les 12 étapes une fois chacune, noms de 40 caractères au plus,
 * deux colonnes ne portent pas le même nom, au moins une colonne affichée.
 */
export function validateColumns(input: ColumnSetting[], defaults: Record<ApplicationStatus, string>): ColumnsValidation {
  const byStatus = new Map(input.map((c) => [c.status, c]));
  if (input.length !== APPLICATION_STATUSES.length || APPLICATION_STATUSES.some((s) => !byStatus.has(s))) {
    return { ok: false, error: "Réglage incomplet : les 12 étapes sont attendues." };
  }
  const columns = APPLICATION_STATUSES.map((status) => {
    const c = byStatus.get(status)!;
    const label = (c.label ?? "").replace(/\s+/g, " ").trim();
    return { status, label: label && label !== defaults[status] ? label : null, hidden: c.hidden };
  });
  const tooLong = columns.find((c) => (c.label?.length ?? 0) > COLUMN_LABEL_MAX);
  if (tooLong) return { ok: false, error: `Le nom de la colonne « ${defaults[tooLong.status]} » dépasse ${COLUMN_LABEL_MAX} caractères.` };
  const seen = new Map<string, ApplicationStatus>();
  for (const c of columns) {
    const name = c.label ?? defaults[c.status];
    const key = name.toLocaleLowerCase("fr");
    if (seen.has(key)) return { ok: false, error: `Deux colonnes portent le même nom : « ${name} ».` };
    seen.set(key, c.status);
  }
  if (columns.every((c) => c.hidden)) return { ok: false, error: "Garde au moins une colonne affichée." };
  return { ok: true, columns };
}

/** Enregistre un réglage validé : seules les colonnes modifiées ont une ligne. */
export async function saveColumnSettings(db: Db, userId: string, columns: ColumnSetting[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(boardColumns).where(eq(boardColumns.userId, userId));
    const changed = columns.filter((c) => c.label !== null || c.hidden);
    if (changed.length) await tx.insert(boardColumns).values(changed.map((c) => ({ userId, status: c.status, label: c.label, hidden: c.hidden })));
  });
}

export async function resetColumnSettings(db: Db, userId: string): Promise<void> {
  await db.delete(boardColumns).where(eq(boardColumns.userId, userId));
}
