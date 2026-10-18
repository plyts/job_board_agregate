"use client";

import { useActionState, useState, useTransition } from "react";
import { resetBoardColumnsAction, saveBoardColumnsAction, type ApplicationActionState } from "@/app/(app)/candidatures/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import type { ColumnSetting } from "@/modules/applications/board";
import { COLUMN_LABEL_MAX } from "@/modules/applications/rules";
import { STATUS_META } from "./labels";

/**
 * Réglage des colonnes : nom affiché et masquage. L'ordre des étapes ne change pas (les règles d'envoi en dépendent) ;
 * une colonne masquée qui contient des candidatures reste affichée.
 */
export function BoardColumnsForm({ settings }: { settings: ColumnSetting[] }) {
  const [state, action, pending] = useActionState<ApplicationActionState, FormData>(saveBoardColumnsAction, {});
  const [rows, setRows] = useState(() => settings.map((s) => ({ status: s.status, label: s.label ?? "", shown: !s.hidden })));
  const [resetting, startReset] = useTransition();
  const [resetError, setResetError] = useState<string | null>(null);
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <form action={action} className="flex flex-col gap-3">
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, i) => {
          const name = STATUS_META[row.status].label;
          return (
            <li key={row.status} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2">
              <span className="w-6 font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <Input
                name={`label:${row.status}`}
                aria-label={`Nom affiché pour « ${name} »`}
                placeholder={name}
                maxLength={COLUMN_LABEL_MAX}
                value={row.label}
                onChange={(e) => update(i, { label: e.target.value })}
                className="min-h-10 min-w-0 flex-1"
              />
              <label className="flex min-h-10 items-center gap-1.5 text-[13px]">
                <input type="checkbox" name={`shown:${row.status}`} checked={row.shown} onChange={(e) => update(i, { shown: e.target.checked })} className="size-4" />
                Afficher<span className="sr-only"> « {name} »</span>
              </label>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending || resetting}>
          {pending ? "Enregistrement…" : "Enregistrer les colonnes"}
        </Button>
        <Button
          type="button"
          disabled={pending || resetting}
          onClick={() =>
            startReset(async () => {
              const r = await resetBoardColumnsAction();
              setResetError(r.error ?? null);
              if (!r.error) setRows(rows.map((row) => ({ ...row, label: "", shown: true })));
            })
          }
        >
          Rétablir les colonnes par défaut
        </Button>
      </div>
      {state.error || resetError ? (
        <p role="alert" className="text-sm text-danger">
          {state.error ?? resetError}
        </p>
      ) : state.ok ? (
        <p role="status" className="text-sm text-accent">
          Colonnes enregistrées.
        </p>
      ) : null}
      <p className="text-[12px] leading-5 text-muted-foreground">
        Nom vide : nom par défaut de l&apos;étape. Une colonne masquée qui contient des candidatures reste affichée ; le clavier saute les colonnes masquées.
        L&apos;ordre des étapes est celui du parcours et ne change pas.
      </p>
    </form>
  );
}
