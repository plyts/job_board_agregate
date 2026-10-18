import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border border-border bg-panel p-5", className)} {...props} />;
}
