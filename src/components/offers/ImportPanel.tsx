"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { importOfferAction, type ImportState } from "@/app/(app)/offres/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";

type Mode = "url" | "text" | "file";
const MODES: { id: Mode; label: string }[] = [
  { id: "url", label: "URL" },
  { id: "text", label: "Texte collé" },
  { id: "file", label: "Fichier" },
];

export function ImportPanel() {
  const [mode, setMode] = useState<Mode>("url");
  const [state, formAction, pending] = useActionState<ImportState, FormData>(async (prev, formData) => {
    const next = await importOfferAction(prev, formData);
    if (next.suggestText) setMode("text");
    return next;
  }, { status: "idle" });

  return (
    <Panel aria-labelledby="import-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="import-title" className="text-lg font-semibold tracking-tight">
          Importer une offre
        </h2>
        <div role="tablist" aria-label="Mode d'import" className="flex gap-1 rounded-lg border border-border bg-background p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              id={`tab-${m.id}`}
              aria-selected={mode === m.id}
              aria-controls="import-form"
              onClick={() => setMode(m.id)}
              className={cn(
                "min-h-9 rounded-md px-3 text-sm",
                mode === m.id ? "bg-panel font-semibold text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <form id="import-form" role="tabpanel" aria-labelledby={`tab-${mode}`} action={formAction} className="flex flex-col gap-3" key={mode}>
        <input type="hidden" name="mode" value={mode} />
        {mode === "url" ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Label className="min-w-0 flex-[1_1_360px]">
                URL de l&apos;annonce
                <Input name="url" type="url" inputMode="url" placeholder="https://…" required defaultValue={state.url} />
              </Label>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Import en cours…" : "Importer et analyser"}
              </Button>
            </div>
            <p className="text-[13px] leading-5 text-muted-foreground">
              La page n&apos;est récupérée que si le site l&apos;autorise (robots.txt, conditions d&apos;utilisation). Sinon, colle le texte : l&apos;URL d&apos;origine est conservée.
            </p>
          </>
        ) : null}
        {mode === "text" ? (
          <>
            <Label>
              Texte de l&apos;annonce
              <Textarea name="text" rows={8} required placeholder="Colle ici l'intégralité de l'annonce" defaultValue={state.text} />
            </Label>
            <div className="flex flex-wrap items-end gap-3">
              <Label className="min-w-0 flex-[1_1_320px]">
                URL d&apos;origine (recommandée)
                <Input name="url" type="url" inputMode="url" placeholder="https://…" defaultValue={state.url} />
              </Label>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Import en cours…" : "Analyser"}
              </Button>
            </div>
          </>
        ) : null}
        {mode === "file" ? (
          <div className="flex flex-wrap items-end gap-3">
            <Label className="min-w-0 flex-[1_1_360px]">
              Fichier PDF ou texte (10 Mo maximum)
              <Input name="file" type="file" accept=".pdf,.txt,application/pdf,text/plain" required className="py-2" />
            </Label>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Import en cours…" : "Importer"}
            </Button>
          </div>
        ) : null}
      </form>

      <div aria-live="polite">
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        ) : null}
        {state.status === "duplicate" && state.offerId ? (
          <p className="text-sm">
            {state.message}{" "}
            <Link href={`/offres/${state.offerId}`} className="font-semibold text-accent">
              Ouvrir l&apos;offre existante
            </Link>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
