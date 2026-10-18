import Link from "next/link";

export default function NotFound() {
  return (
    <main id="contenu" className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-bold">Page introuvable</h1>
      <p className="text-muted-foreground">Cette page n&apos;existe pas ou n&apos;est pas accessible avec ton compte.</p>
      <Link href="/" className="font-semibold text-accent">
        Retour au tableau de bord
      </Link>
    </main>
  );
}
