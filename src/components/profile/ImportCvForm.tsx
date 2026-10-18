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
        <Label className="min-w-0 flex-[1_1_220px]">
          Ton nom tel qu&apos;il figure sur le CV (facultatif)
          <Input name="declaredName" maxLength={120} autoComplete="name" />
        </Label>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Import…" : "Importer mon CV"}
        </Button>
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground">
        Le fichier reste sur ton serveur. Avant tout envoi à une IA, un filtre local masque ton identité, tes coordonnées, ton adresse, ta date de naissance,
        tes numéros (sécurité sociale, IBAN), tes liens personnels, ta situation familiale et toute donnée sensible ; seul un fournisseur que tu as autorisé
        (ou un modèle local) reçoit le texte masqué, et sa réponse est vérifiée avant d&apos;être enregistrée. Ton nom, s&apos;il est indiqué, renforce le masquage.
        Le résultat est un brouillon que tu vérifies avant de le valider.
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
