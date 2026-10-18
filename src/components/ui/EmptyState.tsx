export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-panel p-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? <div className="max-w-prose text-sm leading-6 text-muted-foreground">{children}</div> : null}
      {action}
    </div>
  );
}
