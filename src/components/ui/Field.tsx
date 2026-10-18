import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const control =
  "min-h-11 w-full rounded-lg border border-border bg-panel px-3 text-[15px] text-foreground placeholder:text-muted-foreground";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("flex flex-col gap-1.5 text-[13px] font-medium", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "py-2.5 leading-6", className)} {...props} />;
}

export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-[13px] text-danger">
      {children}
    </p>
  );
}
