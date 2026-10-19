"use client";

import { useActionState } from "react";
import {
  connectAdzunaAction,
  connectCareerPageAction,
  connectEmailAlertsAction,
  connectFranceTravailAction,
  type SourceFormState,
} from "@/app/(app)/sources/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

function Feedback({ state, ok }: { state: SourceFormState; ok: string }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  }
  return state.ok ? (
    <p role="status" className="text-sm text-accent">
      {ok}
    </p>
  ) : null;
}

export function FranceTravailForm({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(connectFranceTravailAction, {});
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Label>
          Identifiant client (client_id)
          <Input name="clientId" required autoComplete="off" defaultValue={state.values?.clientId ?? ""} />
        </Label>
        <Label>
          Clé secrète (client_secret)
          <Input name="clientSecret" type="password" required autoComplete="off" />
        </Label>
      </div>
      <Button type="submit" variant={connected ? "secondary" : "primary"} disabled={pending} className="self-start">
        {pending ? "Test de la connexion…" : connected ? "Remplacer les identifiants" : "Connecter et tester"}
      </Button>
      <Feedback state={state} ok="France Travail est connecté." />
    </form>
  );
}

export function AdzunaForm({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(connectAdzunaAction, {});
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Label>
          app_id
          <Input name="appId" required autoComplete="off" defaultValue={state.values?.appId ?? ""} />
        </Label>
        <Label>
          app_key
          <Input name="appKey" type="password" required autoComplete="off" />
        </Label>
      </div>
      <Button type="submit" variant={connected ? "secondary" : "primary"} disabled={pending} className="self-start">
        {pending ? "Test de la connexion…" : connected ? "Remplacer les identifiants" : "Connecter et tester"}
      </Button>
      <Feedback state={state} ok="Adzuna est connecté." />
    </form>
  );
}

export function CareerPageForm() {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(connectCareerPageAction, {});
  return (
    <form action={action} key={state.ok ? "ajoutee" : "saisie"} className="flex flex-col gap-2.5">
      <div className="grid gap-2.5 sm:grid-cols-[2fr_1fr]">
        <Label>
          Adresse de la page carrières
          <Input name="url" type="url" inputMode="url" required placeholder="https://jobs.lever.co/entreprise" defaultValue={state.values?.url ?? ""} />
        </Label>
        <Label>
          Entreprise
          <Input name="company" maxLength={120} defaultValue={state.values?.company ?? ""} />
        </Label>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Vérification…" : "Suivre cette page"}
      </Button>
      <Feedback state={state} ok="Page carrières ajoutée." />
    </form>
  );
}

export function EmailAlertsForm({ defaults }: { defaults: { host: string; port: string; security: string; user: string; folder: string; autoFetch: boolean } | null }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(connectEmailAlertsAction, {});
  const v = state.values ?? (defaults ? { ...defaults, autoFetch: defaults.autoFetch ? "on" : "" } : { host: "", port: "993", security: "tls", user: "", folder: "INBOX", autoFetch: "on" });
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <div className="grid gap-2.5 sm:grid-cols-[2fr_1fr_1fr]">
        <Label>
          Serveur IMAP
          <Input name="host" required placeholder="imap.exemple.fr" defaultValue={v.host} autoComplete="off" />
        </Label>
        <Label>
          Sécurité
          <select name="security" defaultValue={v.security} className="min-h-11 rounded-lg border border-border bg-panel px-3 text-sm">
            <option value="tls">TLS (port 993)</option>
            <option value="starttls">STARTTLS (port 143)</option>
          </select>
        </Label>
        <Label>
          Port
          <Input name="port" inputMode="numeric" required defaultValue={v.port} />
        </Label>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Label>
          Adresse de la boîte dédiée
          <Input name="user" required autoComplete="off" defaultValue={v.user} />
        </Label>
        <Label>
          Mot de passe d&apos;application
          <Input name="password" type="password" required autoComplete="off" />
        </Label>
        <Label>
          Dossier
          <Input name="folder" defaultValue={v.folder} />
        </Label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="autoFetch" defaultChecked={v.autoFetch === "on"} className="mt-1 size-4" />
        <span>
          Récupérer le texte complet des annonces quand le site l&apos;autorise (robots.txt) ; jamais pour LinkedIn ni Indeed, dont les conditions l&apos;interdisent.
        </span>
      </label>
      <Button type="submit" variant={defaults ? "secondary" : "primary"} disabled={pending} className="self-start">
        {pending ? "Test de la connexion…" : defaults ? "Mettre à jour et tester" : "Connecter et tester"}
      </Button>
      <Feedback state={state} ok="Boîte d'alertes connectée : elle est lue toutes les 15 minutes." />
    </form>
  );
}
