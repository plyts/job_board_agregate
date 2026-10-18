import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/dal";
import { coverLetterFile } from "@/modules/applications";

export const dynamic = "force-dynamic";

/** Aperçu de la lettre de motivation en PDF ou DOCX, toujours en pièce jointe. */
export async function GET(req: Request, ctx: RouteContext<"/api/applications/[applicationId]/letter">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Connexion requise." } }, { status: 401 });
  const { applicationId } = await ctx.params;
  const result = await coverLetterFile(getDb(), user.id, applicationId, new URL(req.url).searchParams.get("format") ?? "pdf");
  if (!result.ok) return Response.json({ error: { code: result.status === 400 ? "INVALID_FORMAT" : "NOT_FOUND", message: result.message } }, { status: result.status });
  return new Response(Buffer.from(result.bytes), {
    headers: {
      "content-type": result.contentType,
      "content-disposition": `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
