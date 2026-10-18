import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/auth/cookie";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next, compte } = await props.searchParams;
  if (await getCurrentUser()) redirect(safeNextPath(next));
  return (
    <main id="contenu" className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl border border-border bg-panel p-6">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-accent">JobPilot</span>
          <h1 className="text-2xl font-bold tracking-tight">Connexion</h1>
        </div>
        {compte === "supprime" ? (
          <p role="status" className="rounded-lg border border-accent px-3 py-2 text-sm text-accent">
            Ton compte et toutes ses données ont été supprimés.
          </p>
        ) : null}
        <LoginForm next={safeNextPath(next)} />
      </div>
    </main>
  );
}
