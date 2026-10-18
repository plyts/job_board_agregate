"use client";

import { useMemo, useState, useTransition } from "react";
import { recheckCvAction, saveCvDraftAction } from "@/app/(app)/offres/[id]/cv/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { CV_SECTIONS, SECTION_TITLES, type CvContent, type CvSection } from "@/modules/cv/content";
import { factCheck, type FactIssue } from "@/modules/cv/factcheck";
import { cvQuality, reverseChronological } from "@/modules/cv/quality";
import type { ProfileContent } from "@/modules/profile/content";
import { QualityPanel } from "./QualityPanel";
import { SuggestionsPanel, type SuggestionView } from "./SuggestionsPanel";

type Props = {
  offerId: string;
  revision: number;
  initial: CvContent;
  /** Profil maître de référence du brouillon, sans coordonnées. */
  profile: ProfileContent;
  offerTerms: string[];
  today: string;
  savedAt: string;
  suggestions: SuggestionView[];
  suggestStatus: "none" | "queued" | "running" | "done" | "failed";
  suggestReason: string | null;
  aiAvailable: boolean;
  aside: React.ReactNode;
};

const small = "min-h-10 px-3";

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function period(e: { start: string | null; end: string | null; current: boolean }) {
  const f = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : "?");
  return `${f(e.start)} – ${e.current ? "aujourd'hui" : f(e.end)}`;
}

function Arrows({ label, onUp, onDown, first, last }: { label: string; onUp: () => void; onDown: () => void; first: boolean; last: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <Button className="min-h-10 w-10 px-0" aria-label={`Monter ${label}`} onClick={onUp} disabled={first}>
        ↑
      </Button>
      <Button className="min-h-10 w-10 px-0" aria-label={`Descendre ${label}`} onClick={onDown} disabled={last}>
        ↓
      </Button>
    </span>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function Issues({ issues }: { issues: FactIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((i, k) => (
        <li key={k} className={cn("text-[13px]", i.severity === "blocking" ? "text-danger" : "text-signal")}>
          {i.severity === "blocking" ? "! " : "? "}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Éditeur du CV personnalisé : sélection, ordre et formulations des éléments du profil maître.
 * Intitulés, entreprises et dates viennent du profil et ne sont pas modifiables ici.
 */
export function CvWorkspace(props: Props) {
  const { offerId, revision, initial, profile, offerTerms } = props;
  const [cv, setCv] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const edit = (fn: (draft: CvContent) => void) => {
    setCv((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setError(null);
  };

  const issues = useMemo(() => factCheck(cv, profile, offerTerms, new Date(props.today)), [cv, profile, offerTerms, props.today]);
  const bySource = useMemo(() => {
    const m = new Map<string, FactIssue[]>();
    for (const i of issues) if (i.sourceId) m.set(i.sourceId, [...(m.get(i.sourceId) ?? []), i]);
    return m;
  }, [issues]);
  const blocking = issues.filter((i) => i.severity === "blocking");
  const quality = useMemo(() => cvQuality(cv, profile, offerTerms, new Date(props.today)), [cv, profile, offerTerms, props.today]);
  const sortByDate = () =>
    edit((d) => {
      const order = reverseChronological(d.experiences.map((e) => ({ ...profile.experiences.find((p) => p.id === e.sourceId)!, id: e.sourceId })));
      d.experiences = order.map((id) => d.experiences.find((e) => e.sourceId === id)!);
    });

  const save = () =>
    startTransition(async () => {
      const r = await saveCvDraftAction(offerId, revision, cv);
      if (r.error) setError(r.error);
      // En cas de succès, la page est rechargée avec la nouvelle révision.
    });
  const recheck = () =>
    startTransition(async () => {
      const r = await recheckCvAction(offerId);
      if (r?.error) setError(r.error);
    });
  const discard = () => {
    if (!window.confirm("Abandonner les modifications non enregistrées ?")) return;
    setCv(initial);
    setDirty(false);
    setError(null);
  };

  const exps = new Map(profile.experiences.map((e) => [e.id, e]));
  const included = new Set(cv.experiences.map((e) => e.sourceId));
  const sectionsOn = new Set(cv.sectionOrder);
  const sectionList: CvSection[] = [...cv.sectionOrder, ...CV_SECTIONS.filter((s) => !sectionsOn.has(s))];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[15rem_minmax(0,1fr)_21rem]">
      <div className="lg:col-span-2 xl:col-span-1">{props.aside}</div>

      <div className="flex min-w-0 flex-col gap-4">
        <Panel aria-label="En-tête et sections" className="flex flex-col gap-4">
          <Label>
            Titre du CV
            <Input value={cv.headline} maxLength={160} onChange={(e) => edit((d) => void (d.headline = e.target.value))} />
          </Label>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[13px] font-medium">Sections et ordre</legend>
            {sectionList.map((s) => {
              const on = sectionsOn.has(s);
              const i = cv.sectionOrder.indexOf(s);
              return (
                <div key={s} className="flex items-center justify-between gap-2">
                  <Check
                    checked={on}
                    onChange={(v) =>
                      edit((d) => {
                        d.sectionOrder = v ? [...d.sectionOrder, s] : d.sectionOrder.filter((x) => x !== s);
                      })
                    }
                  >
                    <span className={on ? "" : "text-muted-foreground"}>{SECTION_TITLES[s]}</span>
                  </Check>
                  {on ? (
                    <Arrows
                      label={SECTION_TITLES[s]}
                      first={i === 0}
                      last={i === cv.sectionOrder.length - 1}
                      onUp={() => edit((d) => void (d.sectionOrder = move(d.sectionOrder, i, -1)))}
                      onDown={() => edit((d) => void (d.sectionOrder = move(d.sectionOrder, i, 1)))}
                    />
                  ) : null}
                </div>
              );
            })}
          </fieldset>
        </Panel>

        {sectionsOn.has("summary") ? (
          <Panel aria-label="Résumé" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Résumé</h2>
            {cv.summary ? (
              <>
                <Label>
                  Texte du résumé
                  <Textarea
                    rows={4}
                    maxLength={1500}
                    value={cv.summary.text}
                    onChange={(e) => edit((d) => void (d.summary = { text: e.target.value, sourceIds: d.summary?.sourceIds ?? [] }))}
                  />
                </Label>
                <Issues issues={issues.filter((i) => i.message.startsWith("Résumé"))} />
                <Button className={cn(small, "self-start")} variant="ghost" onClick={() => edit((d) => void (d.summary = null))}>
                  Retirer le résumé
                </Button>
              </>
            ) : (
              <Button className={cn(small, "self-start")} onClick={() => edit((d) => void (d.summary = { text: profile.summary ?? "", sourceIds: [] }))}>
                {profile.summary ? "Reprendre le résumé du profil" : "Écrire un résumé"}
              </Button>
            )}
          </Panel>
        ) : null}

        {sectionsOn.has("experiences") ? (
          <Panel aria-label="Expérience professionnelle" className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold tracking-tight">Expérience professionnelle</h2>
            {[...cv.experiences.map((e) => e.sourceId), ...profile.experiences.filter((e) => !included.has(e.id)).map((e) => e.id)].map((id) => {
              const exp = exps.get(id);
              if (!exp) return null;
              const ei = cv.experiences.findIndex((e) => e.sourceId === id);
              const ce = cv.experiences[ei];
              const label = `${exp.title} · ${exp.company}`;
              return (
                <article key={id} className={cn("flex flex-col gap-3 rounded-lg border border-border p-3", ce ? "bg-background" : "bg-panel opacity-80")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Check
                      checked={Boolean(ce)}
                      onChange={(v) =>
                        edit((d) => {
                          d.experiences = v
                            ? [...d.experiences, { sourceId: id, items: exp.items.map((i) => ({ sourceId: i.id, text: i.text })) }]
                            : d.experiences.filter((x) => x.sourceId !== id);
                        })
                      }
                    >
                      <span>
                        <span className="font-semibold">{label}</span> <span className="text-muted-foreground">({period(exp)})</span>
                      </span>
                    </Check>
                    {ce ? (
                      <Arrows
                        label={label}
                        first={ei === 0}
                        last={ei === cv.experiences.length - 1}
                        onUp={() => edit((d) => void (d.experiences = move(d.experiences, ei, -1)))}
                        onDown={() => edit((d) => void (d.experiences = move(d.experiences, ei, 1)))}
                      />
                    ) : null}
                  </div>
                  {ce ? (
                    <ul className="flex flex-col gap-3">
                      {[...ce.items.map((i) => i.sourceId), ...exp.items.filter((i) => !ce.items.some((x) => x.sourceId === i.id)).map((i) => i.id)].map((itemId, k) => {
                        const source = exp.items.find((i) => i.id === itemId);
                        const ii = ce.items.findIndex((i) => i.sourceId === itemId);
                        const item = ce.items[ii];
                        const itemIssues = bySource.get(itemId) ?? [];
                        if (!source) return null;
                        return (
                          <li key={itemId} className="flex flex-col gap-1.5">
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                aria-label={`Inclure la puce ${k + 1} de ${exp.company}`}
                                className="mt-3.5 size-4 accent-[var(--accent)]"
                                checked={Boolean(item)}
                                onChange={(e) =>
                                  edit((d) => {
                                    const target = d.experiences.find((x) => x.sourceId === id)!;
                                    target.items = e.target.checked ? [...target.items, { sourceId: itemId, text: source.text }] : target.items.filter((x) => x.sourceId !== itemId);
                                  })
                                }
                              />
                              {item ? (
                                <Textarea
                                  aria-label={`Puce ${k + 1} de ${exp.company}`}
                                  rows={2}
                                  maxLength={600}
                                  value={item.text}
                                  aria-invalid={itemIssues.some((i) => i.severity === "blocking") || undefined}
                                  className={cn("flex-1", itemIssues.some((i) => i.severity === "blocking") && "border-danger")}
                                  onChange={(e) =>
                                    edit((d) => {
                                      d.experiences.find((x) => x.sourceId === id)!.items[ii]!.text = e.target.value;
                                    })
                                  }
                                />
                              ) : (
                                <p className="flex-1 py-2.5 text-sm text-muted-foreground line-through">{source.text}</p>
                              )}
                              {item ? (
                                <Arrows
                                  label={`la puce ${k + 1}`}
                                  first={ii === 0}
                                  last={ii === ce.items.length - 1}
                                  onUp={() => edit((d) => void (d.experiences[ei]!.items = move(d.experiences[ei]!.items, ii, -1)))}
                                  onDown={() => edit((d) => void (d.experiences[ei]!.items = move(d.experiences[ei]!.items, ii, 1)))}
                                />
                              ) : null}
                            </div>
                            {item && item.text !== source.text ? (
                              <div className="flex flex-wrap items-center gap-2 pl-6 text-[13px] text-muted-foreground">
                                <span>Profil : « {source.text} »</span>
                                <button
                                  type="button"
                                  className="font-semibold text-accent hover:underline"
                                  onClick={() => edit((d) => void (d.experiences[ei]!.items[ii]!.text = source.text))}
                                >
                                  Rétablir
                                </button>
                              </div>
                            ) : null}
                            <div className="pl-6">
                              <Issues issues={itemIssues} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </Panel>
        ) : null}

        {sectionsOn.has("skills") ? (
          <Panel aria-label="Compétences" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Compétences</h2>
            <div className="flex flex-wrap gap-2">
              {profile.skills.map((s) => {
                const on = cv.skills.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => edit((d) => void (d.skills = on ? d.skills.filter((x) => x !== s.id) : [...d.skills, s.id]))}
                    className={cn(
                      "min-h-10 rounded-full border px-3 text-sm",
                      on ? "border-accent bg-accent-soft font-semibold text-foreground" : "border-border text-muted-foreground",
                      on && s.level === "unconfirmed" && "border-signal bg-panel",
                    )}
                  >
                    {on ? "✓ " : "+ "}
                    {s.name}
                    {s.level === "unconfirmed" ? " · sans preuve" : ""}
                  </button>
                );
              })}
            </div>
          </Panel>
        ) : null}

        {sectionsOn.has("projects") && profile.projects.length ? (
          <Panel aria-label="Projets" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Projets</h2>
            {profile.projects.map((p) => {
              const pi = cv.projects.findIndex((x) => x.sourceId === p.id);
              const cp = cv.projects[pi];
              return (
                <div key={p.id} className="flex flex-col gap-2">
                  <Check
                    checked={Boolean(cp)}
                    onChange={(v) =>
                      edit((d) => void (d.projects = v ? [...d.projects, { sourceId: p.id, description: p.description }] : d.projects.filter((x) => x.sourceId !== p.id)))
                    }
                  >
                    <span>
                      <span className="font-semibold">{p.name}</span>
                      {p.context !== "professional" ? <span className="text-muted-foreground"> · {p.context === "personal" ? "projet personnel" : "projet académique"}</span> : null}
                    </span>
                  </Check>
                  {cp ? (
                    <>
                      <Textarea
                        aria-label={`Description du projet ${p.name}`}
                        rows={2}
                        maxLength={1200}
                        value={cp.description}
                        onChange={(e) => edit((d) => void (d.projects[pi]!.description = e.target.value))}
                      />
                      <Issues issues={bySource.get(p.id) ?? []} />
                    </>
                  ) : null}
                </div>
              );
            })}
          </Panel>
        ) : null}

        <Panel aria-label="Formation, certifications et langues" className="grid gap-4 md:grid-cols-3">
          {(
            [
              ["education", "Formation", profile.education.map((x) => ({ id: x.id, label: [x.degree, x.year].filter(Boolean).join(" · ") }))],
              [
                "certifications",
                "Certifications",
                profile.certifications.map((x) => ({ id: x.id, label: `${x.name}${x.status === "obtained" ? "" : x.status === "in_progress" ? " (en cours)" : " (prévue)"}` })),
              ],
              ["languages", "Langues", profile.languages.map((x) => ({ id: x.id, label: [x.name, x.level].filter(Boolean).join(" · ") }))],
            ] as const
          ).map(([key, title, options]) =>
            sectionsOn.has(key) ? (
              <fieldset key={key} className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-semibold">{title}</legend>
                {options.length === 0 ? <p className="text-sm text-muted-foreground">Rien dans le profil.</p> : null}
                {options.map((o) => (
                  <Check
                    key={o.id}
                    checked={cv[key].includes(o.id)}
                    onChange={(v) => edit((d) => void (d[key] = v ? [...d[key], o.id] : d[key].filter((x) => x !== o.id)))}
                  >
                    {o.label}
                  </Check>
                ))}
              </fieldset>
            ) : null,
          )}
        </Panel>

        <Panel aria-label="Contrôle des faits" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Contrôle des faits</h2>
          {issues.length === 0 ? (
            <p className="text-sm text-accent">✓ Chaque chiffre et chaque mot-clé de l&apos;offre a sa source dans le profil maître.</p>
          ) : (
            <Issues issues={issues} />
          )}
        </Panel>

        <QualityPanel
          report={quality}
          note="Conseils de rédaction, recalculés à chaque modification et figés avec chaque version enregistrée. Ils ne bloquent rien : seul le contrôle des faits bloque."
          actions={{
            order: (
              <Button className={small} onClick={sortByDate}>
                Trier par date
              </Button>
            ),
          }}
        />

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel p-3 shadow-sm">
          <Button variant="primary" onClick={save} disabled={!dirty || pending}>
            {pending ? "Enregistrement…" : "Enregistrer le brouillon"}
          </Button>
          <Button onClick={discard} disabled={!dirty || pending}>
            Annuler les modifications
          </Button>
          <Button onClick={recheck} disabled={dirty || pending} title={dirty ? "Enregistre d'abord le brouillon" : undefined}>
            Recontrôler cette version
          </Button>
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {dirty ? "Modifications non enregistrées." : `Enregistré ${props.savedAt}.`}
            {blocking.length ? ` ${blocking.length} écart(s) factuel(s) bloquant(s).` : ""}
          </span>
          {error ? (
            <p role="alert" className="w-full text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <SuggestionsPanel
        offerId={offerId}
        cv={cv}
        profile={profile}
        suggestions={props.suggestions}
        status={props.suggestStatus}
        reason={props.suggestReason}
        aiAvailable={props.aiAvailable}
        locked={dirty}
      />
    </div>
  );
}

