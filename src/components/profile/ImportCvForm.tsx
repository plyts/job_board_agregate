"use client";

import { useActionState } from "react";
import { importCvAction, type ImportCvState } from "@/app/(app)/profil/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

export function ImportCvForm() {
  const [state, action, pending] = useActionState<ImportCvState, FormData>(importCvAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Label className="min-w-0 flex-[1_1_320px]">
          CV au format PDF ou DOCX (10 Mo maximum)
          <Input name="file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required className="py-2" />
        </Label>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Import…" : "Importer mon CV"}
        </Button>
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground">
        Le CV est une donnée personnelle : il n&apos;est envoyé qu&apos;à un fournisseur IA autorisé, sans tes coordonnées. Le résultat est un brouillon que tu vérifies avant de le valider.
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
