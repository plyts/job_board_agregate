"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV_ITEMS, type NavItem } from "./nav";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Section({ title, items, pathname }: { title: string; items: NavItem[]; pathname: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2.5 pb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{title}</span>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm no-underline",
              active ? "bg-accent-soft font-semibold text-foreground" : "font-medium text-foreground hover:bg-muted",
            )}
          >
            <span aria-hidden="true" className={cn("size-2 rounded-[2px]", active ? "bg-accent" : "bg-border")} />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function SideNav({ userLabel, logout }: { userLabel?: string; logout?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="flex h-full flex-col gap-5 border-border bg-panel px-3.5 py-5 md:border-r">
      <Link href="/" className="flex items-center gap-2.5 px-1.5 text-foreground no-underline">
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-[7px] bg-accent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12l18-8-8 18-2-8-8-2z" />
          </svg>
        </span>
        <span className="text-[17px] font-bold tracking-tight">JobPilot</span>
        <span className="rounded-full border border-border px-1.5 font-mono text-[11px] text-muted-foreground">MVP</span>
      </Link>
      <Section title="Pilotage" items={NAV_ITEMS.filter((i) => i.section === "pilotage")} pathname={pathname} />
      <Section title="Travail" items={NAV_ITEMS.filter((i) => i.section === "travail")} pathname={pathname} />
      {userLabel ? (
        <div className="mt-auto flex items-center justify-between gap-2 px-1.5">
          <span className="truncate text-sm font-semibold">{userLabel}</span>
          {logout}
        </div>
      ) : null}
    </nav>
  );
}
