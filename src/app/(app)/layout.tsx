import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/auth/dal";
import { logoutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell
      userLabel={user.displayName}
      logout={
        <form action={logoutAction}>
          <button type="submit" className="min-h-9 rounded-md px-2 text-sm font-semibold text-accent hover:bg-accent-soft">
            Déconnexion
          </button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
