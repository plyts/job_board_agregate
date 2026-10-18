import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/dal";
import { exportCvVersion } from "@/modules/cv";

export const dynamic = "force-dynamic";

/** Télécharge une version de CV (PDF ou DOCX), toujours en pièce jointe. */
export async function GET(req: Request, ctx: RouteContext<"/api/cv/[versionId]/export">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Connexion requise." } }, { status: 401 });
  const { versionId } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") ?? "pdf";
  const result = await exportCvVersion(getDb(), user.id, versionId, format);
  if (!result.ok) {
    return Response.json({ error: { code: result.status === 400 ? "INVALID_FORMAT" : "NOT_FOUND", message: result.message } }, { status: result.status });
  }
  return new Response(Buffer.from(result.bytes), {
    headers: {
      "content-type": result.contentType,
      "content-disposition": `attachment; filename="${result.fileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
