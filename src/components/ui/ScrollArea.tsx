import { cn } from "@/lib/cn";

/** Zone à défilement horizontal (tableaux) : nommée et atteignable au clavier pour défiler sans souris. */
export function ScrollArea({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent", className)}>
      {children}
    </div>
  );
}
