import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { evidenceElements, SKILL_LEVELS, type ProfileContent } from "@/modules/profile/content";
import { CERT_STATUS_LABELS, formatPeriod, PROJECT_CONTEXT_LABELS, SKILL_LEVEL_LABELS } from "./labels";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </Panel>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

/** Lecture seule d'une version du profil maître. */
export function ProfileView({ content }: { content: ProfileContent }) {
  const labels = new Map(evidenceElements(content).map((e) => [e.id, e.label]));
  const p = content.preferences;
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
        {content.summary ? (
          <Section title="Résumé">
            <p className="text-[15px] leading-relaxed">{content.summary}</p>
          </Section>
        ) : null}
        <Section title="Expériences">
          {content.experiences.length === 0 ? <Empty>Aucune expérience.</Empty> : null}
          {content.experiences.map((e) => (
            <article key={e.id} className="flex flex-col gap-2 border-t border-muted pt-3 first-of-type:border-0 first-of-type:pt-0">
              <h3 className="text-base font-semibold">
                {e.title} · {e.company}
              </h3>
              <p className="text-sm text-muted-foreground">
                {formatPeriod(e.start, e.end, e.current)}
                {e.location ? ` · ${e.location}` : ""}
              </p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-6">
                {e.items.map((i) => (
                  <li key={i.id}>
                    {i.text} <span className="font-mono text-[11px] text-muted-foreground">· {i.kind === "achievement" ? "réalisation" : "mission"}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </Section>
        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Formation">
            {content.education.length === 0 ? <Empty>Aucune formation.</Empty> : null}
            {content.education.map((d) => (
              <p key={d.id} className="text-sm">
                <span className="font-semibold">{d.degree}</span>
                {d.school ? ` · ${d.school}` : ""}
                {d.year ? ` · ${d.year}` : ""}
              </p>
            ))}
          </Section>
          <Section title="Certifications">
            {content.certifications.length === 0 ? <Empty>Aucune certification.</Empty> : null}
            {content.certifications.map((c) => (
              <p key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{c.name}</span>
                {c.year ? <span className="text-muted-foreground">{c.year}</span> : null}
                <StatusBadge tone={c.status === "obtained" ? "accent" : "signal"}>{CERT_STATUS_LABELS[c.status]}</StatusBadge>
              </p>
            ))}
          </Section>
        </div>
        {content.projects.length ? (
          <Section title="Projets">
            {content.projects.map((pr) => (
              <p key={pr.id} className="text-sm leading-6">
                <span className="font-semibold">{pr.name}</span> <span className="text-muted-foreground">· {PROJECT_CONTEXT_LABELS[pr.context]}{pr.year ? ` · ${pr.year}` : ""}</span>
                <br />
                {pr.description}
              </p>
            ))}
          </Section>
        ) : null}
      </div>
      <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
        <Section title="Compétences et preuves">
          {content.skills.length === 0 ? <Empty>Aucune compétence.</Empty> : null}
          {SKILL_LEVELS.map((level) => {
            const skills = content.skills.filter((s) => s.level === level);
            if (!skills.length) return null;
            const meta = SKILL_LEVEL_LABELS[level];
            return (
              <div key={level} className="flex flex-col gap-2">
                <StatusBadge tone={meta.tone} className="self-start">
                  {meta.label}
                </StatusBadge>
                <ul className="flex flex-col">
                  {skills.map((s) => (
                    <li key={s.id} className="flex flex-col gap-0.5 border-t border-muted py-2 first:border-0">
                      <span className="text-sm font-semibold">{s.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.evidence.length ? s.evidence.map((id) => labels.get(id) ?? "preuve supprimée").join(" · ") : "Aucune preuve"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Section>
        <Section title="Langues">
          {content.languages.length === 0 ? <Empty>Aucune langue.</Empty> : null}
          {content.languages.map((l) => (
            <p key={l.id} className="text-sm">
              {l.name}
              {l.level ? <span className="text-muted-foreground"> · {l.level}</span> : <span className="text-signal"> · niveau à préciser</span>}
            </p>
          ))}
        </Section>
        <Section title="Préférences">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Postes</dt>
            <dd>{p.targetTitles.join(", ") || "—"}</dd>
            <dt className="text-muted-foreground">Lieux</dt>
            <dd>{p.locations.join(", ") || "—"}</dd>
            <dt className="text-muted-foreground">Télétravail</dt>
            <dd>{p.remote ?? "—"}</dd>
            <dt className="text-muted-foreground">Contrats</dt>
            <dd>{p.contracts.join(", ") || "—"}</dd>
            <dt className="text-muted-foreground">Salaire minimum</dt>
            <dd>{p.minSalary ?? "—"}</dd>
            <dt className="text-muted-foreground">Exclusions</dt>
            <dd>{p.exclusions.join(", ") || "—"}</dd>
          </dl>
        </Section>
      </aside>
    </div>
  );
}
