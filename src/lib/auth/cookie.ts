export const SESSION_COOKIE = "jp_session";

/** Cookie de session : inaccessible au JavaScript, envoyé seulement sur le même site. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "1",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/** N'accepte qu'un chemin interne (« /… » mais pas « //… ») pour éviter les redirections ouvertes. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
