"use client";

import { useActionState, useState, useTransition } from "react";
import {
  confirmSendAction,
  moveApplicationAction,
  saveNotesAction,
  setNextActionAction,
  type ApplicationActionState,
} from "@/app/(app)/candidatures/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { APPLICATION_STATUSES, moveRefusal, type ApplicationStatus } from "@/modules/applications/rules";
import { STATUS_META } from "./labels";

const select = "min-h-11 w-full rounded-lg border border-border bg-panel px-2 text-sm text-foreground";

function Feedback({ state, ok }: { state: ApplicationActionState; ok?: string }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  return ok && state.ok ? (
    <p role="status" className="text-sm text-accent">
      {ok}
    </p>
  ) : null;
}

/** Changement de statut accessible sans glisser-déposer (clavier, mobile). */
export function StatusForm({ id, status, sent }: { id: string; status: ApplicationStatus; sent: boolean }) {
  const [to, setTo] = useState<ApplicationStatus>(status);
  const [state, setState] = useState<ApplicationActionState>({});
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const refusal = moveRefusal(to, sent);
        if (refusal) return setState({ error: refusal });
        startTransition(async () => setState(await moveApplicationAction({ id, to })));
      }}
    >
      <Label>
        Étape
        <select className={select} value={to} onChange={(e) => setTo(e.target.value as ApplicationStatus)}>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
      </Label>
      <Button type="submit" disabled={pending || to === status} className="self-start">
        {pending ? "Déplacement…" : "Déplacer"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export type VersionOption = { id: string; label: string };

/**
 * Confirmation d'envoi en deux temps : l'utilisateur envoie lui-même, puis déclare la date, le canal
 * et le fichier exact. Le fichier est alors copié, haché et figé.
 */
export function SendForm({ id, today, versions, channels }: { id: string; today: string; versions: VersionOption[]; channels: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(versions[0]?.id ?? "upload");
  const [state, action, pending] = useActionState<ApplicationActionState, FormData>(confirmSendAction.bind(null, id), {});
  if (!open) {
    return (
      <Button variant="primary" className="self-start" onClick={() => setOpen(true)}>
        J&apos;ai envoyé ma candidature
      </Button>
    );
  }
  return (
    <form action={action} aria-labelledby="confirmer-envoi" className="flex flex-col gap-4 rounded-lg border border-foreground bg-background p-4">
      <h3 id="confirmer-envoi" className="text-base font-semibold">
        Confirmer l&apos;envoi
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        <Label>
          Date d&apos;envoi
          <Input type="date" name="sentAt" defaultValue={today} max={today} required />
        </Label>
        <Label>
          Canal
          <select name="channel" className={select} defaultValue="career_site">
            {Object.entries(channels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">Fichier envoyé</legend>
        {versions.map((v) => (
          <label key={v.id} className="flex min-h-10 items-center gap-2 text-sm">
            <input type="radio" name="file" value={v.id} checked={file === v.id} onChange={() => setFile(v.id)} className="size-4 accent-[var(--accent)]" />
            {v.label}
          </label>
        ))}
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="radio" name="file" value="upload" checked={file === "upload"} onChange={() => setFile("upload")} className="size-4 accent-[var(--accent)]" />
          Un autre fichier (PDF ou DOCX)
        </label>
        {file === "upload" ? (
          <Label>
            Fichier
            <Input type="file" name="upload" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required className="py-2" />
          </Label>
        ) : null}
        {versions.length === 0 ? <p className="text-[13px] text-muted-foreground">Aucune version finalisée du CV de cette offre : finalise-la depuis l&apos;éditeur, ou joins le fichier envoyé.</p> : null}
      </fieldset>
      <p className="text-[13px] text-muted-foreground">
        Une copie exacte du fichier est enregistrée avec son empreinte SHA-256 et ne pourra plus être remplacée. Une relance est proposée selon le délai choisi.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Confirmation…" : "Confirmer l'envoi"}
        </Button>
        <Button onClick={() => setOpen(false)} disabled={pending}>
          Annuler
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function NextActionForm({
  id,
  nextAction,
  nextActionAt,
  followUpDays,
}: {
  id: string;
  nextAction: string | null;
  nextActionAt: string | null;
  followUpDays: number | null;
}) {
  const [state, action, pending] = useActionState<ApplicationActionState, FormData>(setNextActionAction.bind(null, id), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <Label>
        Action
        <Input name="nextAction" defaultValue={nextAction ?? ""} maxLength={200} placeholder="Ex. relancer le recruteur" />
      </Label>
      <Label>
        Échéance
        <Input type="date" name="nextActionAt" defaultValue={nextActionAt ?? ""} />
      </Label>
      <Label>
        Relance après envoi
        <select name="followUpDays" className={select} defaultValue={followUpDays ? String(followUpDays) : ""}>
          <option value="7">7 jours</option>
          <option value="10">10 jours</option>
          <option value="14">14 jours</option>
          <option value="">Aucune</option>
        </select>
      </Label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
      <Feedback state={state} ok="Prochaine action enregistrée." />
    </form>
  );
}

export function NotesForm({ id, notes }: { id: string; notes: string }) {
  const [state, action, pending] = useActionState<ApplicationActionState, FormData>(saveNotesAction.bind(null, id), {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <Label>
        <span className="sr-only">Notes</span>
        <Textarea name="notes" rows={5} maxLength={10_000} defaultValue={notes} placeholder="Contacts, questions à poser, impressions…" />
      </Label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Enregistrement…" : "Enregistrer les notes"}
      </Button>
      <Feedback state={state} ok="Notes enregistrées." />
    </form>
  );
}
