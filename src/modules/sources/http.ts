import { parse } from "node-html-parser";
import { SourceError } from "./types";

const TIMEOUT_MS = 15_000;
export const SOURCE_USER_AGENT = "JobPilot/0.1 (usage personnel ; recherche d'emploi)";

/** Limite de débit par hôte, dans le processus : un appel au plus tous les `intervalMs`. */
const nextSlot = new Map<string, number>();
export async function throttle(host: string, intervalMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + intervalMs);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

export type HttpResponse = { status: number; headers: Headers; body: unknown };

/** Appel HTTP vers une API connue (hôte fixe) : délai limité, JSON attendu, erreurs traduites. */
export async function requestJson(url: string, init: RequestInit & { intervalMs?: number } = {}): Promise<HttpResponse> {
  const target = new URL(url);
  // Limite par service : hôte et premier segment du chemin (plusieurs API peuvent partager un hôte).
  await throttle(`${target.host}/${target.pathname.split("/")[1] ?? ""}`, init.intervalMs ?? 250);
  let res: Response;
  try {
    res = await fetch(target, {
      ...init,
      headers: { accept: "application/json", "user-agent": SOURCE_USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new SourceError(timeout ? `${target.host} ne répond pas (15 s)` : `${target.host} est injoignable`);
  }
  if (res.status === 401 || res.status === 403) throw new SourceError(`${target.host} refuse l'accès : vérifie les identifiants`, "auth");
  if (res.status === 429) throw new SourceError(`${target.host} : quota atteint, nouvel essai plus tard`, "quota");
  if (res.status === 404) throw new SourceError(`${target.host} : ressource introuvable (identifiant de la page ?)`, "invalid");
  if (res.status === 204) return { status: 204, headers: res.headers, body: null };
  const text = await res.text();
  if (res.status >= 400) throw new SourceError(`${target.host} a répondu ${res.status}${res.status === 400 ? " (critères refusés)" : ""}`, res.status === 400 ? "invalid" : "unavailable");
  try {
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  } catch {
    throw new SourceError(`${target.host} a renvoyé une réponse illisible`);
  }
}

/** Texte lisible d'un fragment HTML (descriptions d'offres), paragraphes et listes conservés. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const root = parse(html.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, "$&\n"));
  for (const li of root.querySelectorAll("li")) li.insertAdjacentHTML("afterbegin", "- ");
  return root.textContent
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML échappé en entités (Greenhouse) : décode puis convertit. */
export function escapedHtmlToText(escaped: string | null | undefined): string {
  if (!escaped) return "";
  return htmlToText(parse(`<x>${escaped}</x>`).textContent);
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function date(v: unknown): Date | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
