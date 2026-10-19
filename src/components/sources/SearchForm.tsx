"use client";

import { useActionState, useState } from "react";
import { runSearchAction, saveSearchAction, type SearchFormState } from "@/app/(app)/recherche/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

const CONTRACTS = { CDI: "CDI", CDD: "CDD", MIS: "Intérim", SAI: "Saisonnier", LIB: "Indépendant", ALT: "Alternance" } as const;
const PUBLISHED = [
  ["1", "24 heures"],
  ["3", "3 jours"],
  ["7", "7 jours"],
  ["14", "14 jours"],
  ["31", "31 jours"],
] as const;

export type SearchCriteria = { keywords: string; location: string; radiusKm: string; publishedWithinDays: string; contracts: string[]; sourceIds: string[] };

/**
 * Critères d'une recherche combinée : lancée tout de suite, ou enregistrée pour que le worker la relance.
 * Champs contrôlés : la saisie reste en place après une erreur.
 */
export function SearchForm({ sources, initial }: { sources: { id: string; label: string }[]; initial: SearchCriteria }) {
  const [c, setC] = useState(initial);
  const [saved, setSaved] = useState({ name: "", intervalHours: "6", maxPerRun: "20" });
  const [runState, run, running] = useActionState<SearchFormState, FormData>(runSearchAction, {});
  const [saveState, save, saving] = useActionState<SearchFormState, FormData>(saveSearchAction, {});
  const toggle = (key: "contracts" | "sourceIds", value: string) =>
    setC((prev) => ({ ...prev, [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value] }));
  const error = runState.error ?? saveState.error;

  return (
    <form className="flex flex-col gap-3">
      <div className="grid gap-2.5 md:grid-cols-[2fr_1fr_8rem_10rem]">
        <Label>
          Mots-clés
          <Input name="keywords" required maxLength={200} value={c.keywords} onChange={(e) => setC({ ...c, keywords: e.target.value })} placeholder="data engineer, ingénieur données" />
        </Label>
        <Label>
          Lieu
          <Input name="location" maxLength={100} value={c.location} onChange={(e) => setC({ ...c, location: e.target.value })} placeholder="Lyon, 69 ou Rhône" />
        </Label>
        <Label>
          Rayon (km)
          <Input name="radiusKm" inputMode="numeric" value={c.radiusKm} onChange={(e) => setC({ ...c, radiusKm: e.target.value })} />
        </Label>
        <Label>
          Publiées depuis
          <select name="publishedWithinDays" value={c.publishedWithinDays} onChange={(e) => setC({ ...c, publishedWithinDays: e.target.value })} className="min-h-11 rounded-lg border border-border bg-panel px-3 text-sm">
            {PUBLISHED.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Label>
      </div>
      <p className="text-[12px] leading-5 text-muted-foreground">Une virgule sépare des variantes : « data engineer, ingénieur données » cherche l&apos;une ou l&apos;autre.</p>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
        <legend className="mb-1 text-sm font-medium">Contrat (tous si aucun)</legend>
        {Object.entries(CONTRACTS).map(([code, label]) => (
          <label key={code} className="flex min-h-10 items-center gap-1.5 text-sm">
            <input type="checkbox" name="contracts" value={code} checked={c.contracts.includes(code)} onChange={() => toggle("contracts", code)} className="size-4" />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
        <legend className="mb-1 text-sm font-medium">Sources (toutes si aucune)</legend>
        {sources.map((s) => (
          <label key={s.id} className="flex min-h-10 items-center gap-1.5 text-sm">
            <input type="checkbox" name="sourceIds" value={s.id} checked={c.sourceIds.includes(s.id)} onChange={() => toggle("sourceIds", s.id)} className="size-4" />
            {s.label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" formAction={run} disabled={running || saving}>
          {running ? "Recherche sur toutes les sources…" : "Rechercher maintenant"}
        </Button>
      </div>
      <details className="rounded-lg border border-border bg-background p-3">
        <summary className="cursor-pointer text-sm font-semibold">Enregistrer cette recherche (relancée automatiquement)</summary>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-[2fr_1fr_1fr]">
          <Label>
            Nom
            <Input name="name" maxLength={80} value={saved.name} onChange={(e) => setSaved({ ...saved, name: e.target.value })} placeholder="Data à Lyon" />
          </Label>
          <Label>
            Fréquence
            <select name="intervalHours" value={saved.intervalHours} onChange={(e) => setSaved({ ...saved, intervalHours: e.target.value })} className="min-h-11 rounded-lg border border-border bg-panel px-3 text-sm">
              <option value="3">Toutes les 3 h</option>
              <option value="6">Toutes les 6 h</option>
              <option value="12">Toutes les 12 h</option>
              <option value="24">Une fois par jour</option>
            </select>
          </Label>
          <Label>
            Offres importées au plus par passage
            <Input name="maxPerRun" inputMode="numeric" value={saved.maxPerRun} onChange={(e) => setSaved({ ...saved, maxPerRun: e.target.value })} />
          </Label>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
          Chaque offre complète importée part en analyse : le plafond protège tes quotas IA. Les offres au-delà sont importées au passage suivant.
        </p>
        <Button type="submit" formAction={save} disabled={running || saving} className="mt-2">
          {saving ? "Enregistrement…" : "Enregistrer la recherche"}
        </Button>
      </details>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : saveState.ok ? (
        <p role="status" className="text-sm text-accent">
          {saveState.ok}
        </p>
      ) : null}
    </form>
  );
}
