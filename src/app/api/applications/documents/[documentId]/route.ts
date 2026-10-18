import { getCurrentUser } from "@/lib/auth/dal";
import { getApplicationsDeps } from "@/lib/applications-deps";
import { readSentDocument } from "@/modules/applications";

export const dynamic = "force-dynamic";

/** Télécharge le fichier réellement envoyé, après vérification de son empreinte SHA-256. */
export async function GET(_req: Request, ctx: RouteContext<"/api/applications/documents/[documentId]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Connexion requise." } }, { status: 401 });
  const { documentId } = await ctx.params;
  const result = await readSentDocument(getApplicationsDeps(), user.id, documentId);
  if (!result.ok) {
    return Response.json({ error: { code: result.status === 404 ? "NOT_FOUND" : "INTEGRITY_CHECK_FAILED", message: result.message } }, { status: result.status });
  }
  return new Response(new Uint8Array(result.bytes), {
    headers: {
      "content-type": result.contentType,
      "content-disposition": `attachment; filename="${result.fileName.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
