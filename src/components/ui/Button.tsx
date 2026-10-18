import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-foreground hover:text-background",
  secondary: "border border-border bg-panel text-foreground hover:bg-muted",
  ghost: "text-accent hover:bg-accent-soft",
  danger: "border border-danger bg-panel text-danger hover:bg-muted",
};

export function Button({ variant = "secondary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={cn(base, variants[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "secondary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(base, variants[variant], "no-underline", className)} {...props} />;
}
