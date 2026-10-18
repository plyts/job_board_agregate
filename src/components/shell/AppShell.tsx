import { SideNav } from "./SideNav";

export function AppShell({ children, userLabel, logout }: { children: React.ReactNode; userLabel?: string; logout?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="md:sticky md:top-0 md:h-screen md:w-62 md:shrink-0">
        <SideNav userLabel={userLabel} logout={logout} />
      </div>
      <main id="contenu" className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-7 md:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
