export function PageHeader({ eyebrow, title, actions, children }: { eyebrow?: string; title: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        {eyebrow ? <span className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-accent">{eyebrow}</span> : null}
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
