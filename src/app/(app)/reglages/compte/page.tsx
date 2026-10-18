import type { Metadata } from "next";
import { DeleteAccountForm } from "@/components/account/DeleteAccountForm";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Mon compte" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader eyebrow="Réglages" title="Mon compte">
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </PageHeader>

      <Panel aria-label="Exporter mes données" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Exporter mes données</h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Archive ZIP avec toutes tes données en JSON (offres, analyses, profil maître et ses versions, CV personnalisés, matchings, candidatures, historique,
          contacts, journal des appels IA sans contenu, consentements IA) et les fichiers stockés (CV importés, documents réellement envoyés). Ni mot de passe ni jeton de session.
        </p>
        <a href="/api/compte/export" className="inline-flex min-h-11 items-center self-start rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent no-underline">
          Télécharger l&apos;export
        </a>
      </Panel>

      <Panel aria-label="Supprimer mon compte" className="flex flex-col gap-3 border-danger">
        <h2 className="text-lg font-semibold tracking-tight text-danger">Supprimer mon compte</h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Supprime définitivement toutes tes données et tous tes fichiers, y compris les documents envoyés, qui sont protégés contre toute autre suppression.
          Exporte-les d&apos;abord si tu veux les garder. Cette action ne peut pas être annulée.
        </p>
        <DeleteAccountForm />
      </Panel>
    </>
  );
}
