"use client";

import { useState, useTransition } from "react";
import { discardDraftAction, saveDraftAction, validateDraftAction } from "@/app/(app)/profil/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { evidenceElements, newElementId, SKILL_LEVELS, validationProblems, type ProfileContent } from "@/modules/profile/content";
import { CERT_STATUS_LABELS, PROJECT_CONTEXT_LABELS, SKILL_LEVEL_LABELS } from "./labels";

const select = "min-h-11 rounded-lg border border-border bg-panel px-2 text-sm text-foreground";

const list = (v: string[]) => v.join(", ");
const parseList = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const orNull = (v: string) => (v.trim() ? v : null);

function Section({ title, children, onAdd, addLabel }: { title: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <Panel aria-label={title} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {onAdd ? (
          <Button onClick={onAdd} className="min-h-9 px-3">
            {addLabel}
          </Button>
        ) : null}
      </div>
      {children}
    </Panel>
  );
}

function Row({ children, onRemove, removeLabel }: { children: React.ReactNode; onRemove: () => void; removeLabel: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      {children}
      <button type="button" onClick={onRemove} className="self-start text-sm font-semibold text-danger hover:underline">
        {removeLabel}
      </button>
    </div>
  );
}

/** Éditeur du brouillon de profil : tout est enregistré côté serveur et revalidé par le même schéma. */
export function ProfileEditor({ initial, locked }: { initial: ProfileContent; locked: boolean }) {
  const [content, setContent] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const edit = (fn: (draft: ProfileContent) => void) => {
    setContent((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setMessage(null);
  };

  const evidence = evidenceElements(content);
  const localProblems = validationProblems(content);

  const save = () =>
    startTransition(async () => {
      const r = await saveDraftAction(content);
      if (r.error) setMessage({ tone: "error", text: r.error });
      else {
        setDirty(false);
        setMessage({ tone: "ok", text: "Brouillon enregistré." });
      }
    });

  const validate = () =>
    startTransition(async () => {
      const saved = await saveDraftAction(content);
      if (saved.error) {
        setMessage({ tone: "error", text: saved.error });
        return;
      }
      setDirty(false);
      const r = await validateDraftAction();
      setProblems(r.problems ?? []);
    });

  const id = content.identity;
  const pref = content.preferences;

  return (
    <div className="flex flex-col gap-5">
    <fieldset disabled={locked || pending} className="flex flex-col gap-5">
      <Section title="Identité">
        <div className="grid gap-3 md:grid-cols-2">
          <Label>
            Nom complet
            <Input value={id.fullName} onChange={(e) => edit((d) => void (d.identity.fullName = e.target.value))} required />
          </Label>
          <Label>
            Titre professionnel
            <Input value={id.headline} onChange={(e) => edit((d) => void (d.identity.headline = e.target.value))} />
          </Label>
          <Label>
            Ville
            <Input value={id.location ?? ""} onChange={(e) => edit((d) => void (d.identity.location = orNull(e.target.value)))} />
          </Label>
          <Label>
            E-mail
            <Input type="email" value={id.email ?? ""} onChange={(e) => edit((d) => void (d.identity.email = orNull(e.target.value)))} />
          </Label>
          <Label>
            Téléphone
            <Input value={id.phone ?? ""} onChange={(e) => edit((d) => void (d.identity.phone = orNull(e.target.value)))} />
          </Label>
          <Label>
            Liens (séparés par des virgules)
            <Input value={list(id.links)} onChange={(e) => edit((d) => void (d.identity.links = parseList(e.target.value)))} />
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">Les coordonnées ne sont jamais envoyées à un modèle d&apos;IA.</p>
      </Section>

      <Section title="Résumé">
        <Label>
          <span className="sr-only">Résumé</span>
          <Textarea rows={4} value={content.summary ?? ""} onChange={(e) => edit((d) => void (d.summary = orNull(e.target.value)))} />
        </Label>
      </Section>

      <Section
        title="Expériences"
        addLabel="Ajouter une expérience"
        onAdd={() => edit((d) => void d.experiences.push({ id: newElementId(), title: "", company: "", location: null, start: null, end: null, current: false, items: [] }))}
      >
        {content.experiences.map((exp, ei) => (
          <Row key={exp.id} removeLabel="Supprimer cette expérience" onRemove={() => edit((d) => void d.experiences.splice(ei, 1))}>
            <div className="grid gap-3 md:grid-cols-2">
              <Label>
                Intitulé du poste
                <Input value={exp.title} onChange={(e) => edit((d) => void (d.experiences[ei]!.title = e.target.value))} />
              </Label>
              <Label>
                Entreprise
                <Input value={exp.company} onChange={(e) => edit((d) => void (d.experiences[ei]!.company = e.target.value))} />
              </Label>
              <Label>
                Début
                <Input type="month" value={exp.start ?? ""} onChange={(e) => edit((d) => void (d.experiences[ei]!.start = orNull(e.target.value)))} />
              </Label>
              <Label>
                Fin
                <Input
                  type="month"
                  value={exp.end ?? ""}
                  disabled={exp.current}
                  onChange={(e) => edit((d) => void (d.experiences[ei]!.end = orNull(e.target.value)))}
                />
              </Label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={exp.current}
                onChange={(e) =>
                  edit((d) => {
                    d.experiences[ei]!.current = e.target.checked;
                    if (e.target.checked) d.experiences[ei]!.end = null;
                  })
                }
                className="size-4 accent-[var(--accent)]"
              />
              Poste actuel
            </label>
            <div className="flex flex-col gap-2">
              {exp.items.map((item, ii) => (
                <div key={item.id} className="flex flex-wrap items-start gap-2">
                  <label className="sr-only" htmlFor={`kind-${item.id}`}>
                    Type
                  </label>
                  <select
                    id={`kind-${item.id}`}
                    className={select}
                    value={item.kind}
                    onChange={(e) => edit((d) => void (d.experiences[ei]!.items[ii]!.kind = e.target.value as "mission" | "achievement"))}
                  >
                    <option value="mission">Mission</option>
                    <option value="achievement">Réalisation</option>
                  </select>
                  <label className="min-w-0 flex-[1_1_280px]">
                    <span className="sr-only">Description</span>
                    <Textarea rows={2} value={item.text} onChange={(e) => edit((d) => void (d.experiences[ei]!.items[ii]!.text = e.target.value))} />
                  </label>
                  <button
                    type="button"
                    aria-label="Supprimer cet élément"
                    onClick={() => edit((d) => void d.experiences[ei]!.items.splice(ii, 1))}
                    className="min-h-11 px-2 text-sm font-semibold text-danger"
                  >
                    Supprimer
                  </button>
                </div>
              ))}
              <Button
                className="min-h-9 self-start px-3"
                onClick={() => edit((d) => void d.experiences[ei]!.items.push({ id: newElementId(), kind: "mission", text: "" }))}
              >
                Ajouter une mission ou une réalisation
              </Button>
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Formation" addLabel="Ajouter" onAdd={() => edit((d) => void d.education.push({ id: newElementId(), degree: "", school: null, year: null }))}>
        {content.education.map((ed, i) => (
          <Row key={ed.id} removeLabel="Supprimer" onRemove={() => edit((d) => void d.education.splice(i, 1))}>
            <div className="grid gap-3 md:grid-cols-3">
              <Label>
                Diplôme
                <Input value={ed.degree} onChange={(e) => edit((d) => void (d.education[i]!.degree = e.target.value))} />
              </Label>
              <Label>
                Établissement
                <Input value={ed.school ?? ""} onChange={(e) => edit((d) => void (d.education[i]!.school = orNull(e.target.value)))} />
              </Label>
              <Label>
                Année
                <Input value={ed.year ?? ""} onChange={(e) => edit((d) => void (d.education[i]!.year = orNull(e.target.value)))} />
              </Label>
            </div>
          </Row>
        ))}
      </Section>

      <Section
        title="Certifications"
        addLabel="Ajouter"
        onAdd={() => edit((d) => void d.certifications.push({ id: newElementId(), name: "", issuer: null, year: null, status: "obtained" }))}
      >
        {content.certifications.map((c, i) => (
          <Row key={c.id} removeLabel="Supprimer" onRemove={() => edit((d) => void d.certifications.splice(i, 1))}>
            <div className="grid gap-3 md:grid-cols-4">
              <Label>
                Certification
                <Input value={c.name} onChange={(e) => edit((d) => void (d.certifications[i]!.name = e.target.value))} />
              </Label>
              <Label>
                Organisme
                <Input value={c.issuer ?? ""} onChange={(e) => edit((d) => void (d.certifications[i]!.issuer = orNull(e.target.value)))} />
              </Label>
              <Label>
                Année
                <Input value={c.year ?? ""} onChange={(e) => edit((d) => void (d.certifications[i]!.year = orNull(e.target.value)))} />
              </Label>
              <Label>
                Statut
                <select className={select} value={c.status} onChange={(e) => edit((d) => void (d.certifications[i]!.status = e.target.value as typeof c.status))}>
                  {Object.entries(CERT_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Label>
            </div>
          </Row>
        ))}
      </Section>

      <Section
        title="Projets"
        addLabel="Ajouter"
        onAdd={() => edit((d) => void d.projects.push({ id: newElementId(), name: "", context: "personal", description: "", year: null }))}
      >
        {content.projects.map((pr, i) => (
          <Row key={pr.id} removeLabel="Supprimer" onRemove={() => edit((d) => void d.projects.splice(i, 1))}>
            <div className="grid gap-3 md:grid-cols-3">
              <Label>
                Nom
                <Input value={pr.name} onChange={(e) => edit((d) => void (d.projects[i]!.name = e.target.value))} />
              </Label>
              <Label>
                Contexte
                <select className={select} value={pr.context} onChange={(e) => edit((d) => void (d.projects[i]!.context = e.target.value as typeof pr.context))}>
                  {Object.entries(PROJECT_CONTEXT_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Label>
              <Label>
                Année
                <Input value={pr.year ?? ""} onChange={(e) => edit((d) => void (d.projects[i]!.year = orNull(e.target.value)))} />
              </Label>
            </div>
            <Label>
              Description
              <Textarea rows={2} value={pr.description} onChange={(e) => edit((d) => void (d.projects[i]!.description = e.target.value))} />
            </Label>
          </Row>
        ))}
      </Section>

      <Section title="Langues" addLabel="Ajouter" onAdd={() => edit((d) => void d.languages.push({ id: newElementId(), name: "", level: null }))}>
        {content.languages.map((l, i) => (
          <Row key={l.id} removeLabel="Supprimer" onRemove={() => edit((d) => void d.languages.splice(i, 1))}>
            <div className="grid gap-3 md:grid-cols-2">
              <Label>
                Langue
                <Input value={l.name} onChange={(e) => edit((d) => void (d.languages[i]!.name = e.target.value))} />
              </Label>
              <Label>
                Niveau (ex. C1, courant)
                <Input value={l.level ?? ""} onChange={(e) => edit((d) => void (d.languages[i]!.level = orNull(e.target.value)))} />
              </Label>
            </div>
          </Row>
        ))}
      </Section>

      <Section
        title="Compétences et preuves"
        addLabel="Ajouter une compétence"
        onAdd={() => edit((d) => void d.skills.push({ id: newElementId(), name: "", level: "unconfirmed", evidence: [] }))}
      >
        <p className="text-[13px] leading-5 text-muted-foreground">
          Un niveau autre que « Non confirmée » exige au moins une preuve : une expérience, une réalisation, un projet, une formation ou une certification.
        </p>
        {content.skills.map((s, i) => (
          <Row key={s.id} removeLabel="Supprimer cette compétence" onRemove={() => edit((d) => void d.skills.splice(i, 1))}>
            <div className="grid gap-3 md:grid-cols-2">
              <Label>
                Compétence
                <Input value={s.name} onChange={(e) => edit((d) => void (d.skills[i]!.name = e.target.value))} />
              </Label>
              <Label>
                Niveau
                <select className={select} value={s.level} onChange={(e) => edit((d) => void (d.skills[i]!.level = e.target.value as typeof s.level))}>
                  {SKILL_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {SKILL_LEVEL_LABELS[lvl].label}
                    </option>
                  ))}
                </select>
              </Label>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-accent">
                Preuves ({s.evidence.length}) {s.level !== "unconfirmed" && s.evidence.length === 0 ? <span className="text-danger">: au moins une requise</span> : null}
              </summary>
              <div className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
                {evidence.length === 0 ? <p className="text-sm text-muted-foreground">Ajoute d&apos;abord une expérience, un projet, une formation ou une certification.</p> : null}
                {evidence.map((ev) => (
                  <label key={ev.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-[var(--accent)]"
                      checked={s.evidence.includes(ev.id)}
                      onChange={(e) =>
                        edit((d) => {
                          const sk = d.skills[i]!;
                          sk.evidence = e.target.checked ? [...sk.evidence, ev.id] : sk.evidence.filter((x) => x !== ev.id);
                        })
                      }
                    />
                    <span>{ev.label}</span>
                  </label>
                ))}
              </div>
            </details>
          </Row>
        ))}
      </Section>

      <Section title="Préférences">
        <div className="grid gap-3 md:grid-cols-2">
          <Label>
            Postes visés (virgules)
            <Input value={list(pref.targetTitles)} onChange={(e) => edit((d) => void (d.preferences.targetTitles = parseList(e.target.value)))} />
          </Label>
          <Label>
            Lieux (virgules)
            <Input value={list(pref.locations)} onChange={(e) => edit((d) => void (d.preferences.locations = parseList(e.target.value)))} />
          </Label>
          <Label>
            Télétravail souhaité
            <Input value={pref.remote ?? ""} onChange={(e) => edit((d) => void (d.preferences.remote = orNull(e.target.value)))} />
          </Label>
          <Label>
            Contrats (virgules)
            <Input value={list(pref.contracts)} onChange={(e) => edit((d) => void (d.preferences.contracts = parseList(e.target.value)))} />
          </Label>
          <Label>
            Salaire minimum
            <Input value={pref.minSalary ?? ""} onChange={(e) => edit((d) => void (d.preferences.minSalary = orNull(e.target.value)))} />
          </Label>
          <Label>
            Exclusions (virgules)
            <Input value={list(pref.exclusions)} onChange={(e) => edit((d) => void (d.preferences.exclusions = parseList(e.target.value)))} />
          </Label>
        </div>
      </Section>

    </fieldset>

      {/* Hors du formulaire verrouillé : un brouillon bloqué en extraction doit rester supprimable. */}
      <div className="sticky bottom-0 flex flex-col gap-3 rounded-xl border border-border bg-panel p-4 shadow-[0_-8px_24px_-12px_rgba(14,23,38,0.25)]">
        {problems.length > 0 ? (
          <div role="alert" className="flex flex-col gap-1 text-sm text-danger">
            <strong>Validation impossible :</strong>
            <ul className="list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : localProblems.length > 0 ? (
          <p className="text-[13px] text-muted-foreground">{localProblems.length} point(s) à corriger avant validation.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={validate} disabled={locked || pending}>
            Valider cette version
          </Button>
          <Button onClick={save} disabled={locked || pending || !dirty}>
            Enregistrer le brouillon
          </Button>
          <span aria-live="polite" className={message?.tone === "error" ? "text-sm text-danger" : "text-sm text-muted-foreground"}>
            {pending ? "Enregistrement…" : (message?.text ?? (dirty ? "Modifications non enregistrées" : ""))}
          </span>
          <span className="flex-1" />
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Supprimer ce brouillon ? Les modifications non validées seront perdues.")) startTransition(() => discardDraftAction());
            }}
          >
            Supprimer le brouillon
          </Button>
        </div>
      </div>
    </div>
  );
}
