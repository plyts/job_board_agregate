import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/dal";
import { exportAccount } from "@/modules/account";
import { getStorage } from "@/modules/platform";

export const dynamic = "force-dynamic";

/** Export complet du compte (JSON + fichiers) dans une archive ZIP. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Connexion requise." } }, { status: 401 });
  const now = new Date();
  const zip = await exportAccount({ db: getDb(), storage: getStorage() }, user.id, now);
  return new Response(Buffer.from(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="jobpilot-export-${now.toISOString().slice(0, 10)}.zip"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
