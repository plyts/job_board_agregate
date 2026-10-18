import { cn } from "@/lib/cn";

export type Tone = "accent" | "signal" | "danger" | "neutral" | "ink";

const tones: Record<Tone, string> = {
  accent: "border-accent text-accent",
  signal: "border-signal text-signal",
  danger: "border-danger text-danger",
  neutral: "border-border text-muted-foreground",
  ink: "border-foreground text-foreground",
};

/** Statut en capitales mono : le libellé porte le sens, la couleur ne fait que le doubler. */
export function StatusBadge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.04em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
