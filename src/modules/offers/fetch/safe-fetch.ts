import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import { Agent, fetch } from "undici";

export const USER_AGENT = "JobPilotBot/0.1 (usage personnel ; import manuel d'une annonce)";
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

/**
 * Domaines dont les conditions d'utilisation interdisent la collecte automatisée :
 * l'utilisateur colle le texte de l'annonce à la place.
 */
const BLOCKED_DOMAINS = ["linkedin.com", "indeed.com", "indeed.fr"];

export type FetchFailure =
  | "invalid_url"
  | "blocked_domain"
  | "blocked_port"
  | "disallowed_by_robots"
  | "private_address"
  | "timeout"
  | "too_large"
  | "unsupported_content"
  | "http_error"
  | "network_error";

export class PageFetchError extends Error {
  constructor(
    readonly reason: FetchFailure,
    message: string,
  ) {
    super(message);
    this.name = "PageFetchError";
  }
}

/** Seules les adresses unicast publiques sont joignables (pas de réseau local ni de métadonnées cloud). */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) ip = (ip as ipaddr.IPv6).toIPv4Address();
  return ip.range() === "unicast";
}

export type FetchOptions = {
  /** Remplaçables en test uniquement, pour viser un serveur local. */
  isAllowedAddress?: (address: string) => boolean;
  allowAnyPort?: boolean;
};

type Guard = { isAllowed: (address: string) => boolean; allowAnyPort: boolean };

function guardedAgent(isAllowed: (a: string) => boolean): Agent {
  // Vérifie l'adresse au moment de la connexion : protège aussi contre le DNS rebinding et les redirections.
  const lookup = (hostname: string, options: { all?: boolean; family?: number }, cb: (...args: unknown[]) => void) => {
    dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses: LookupAddress[]) => {
      if (err) return cb(err);
      const bad = addresses.find((a) => !isAllowed(a.address));
      if (bad || addresses.length === 0) {
        return cb(new PageFetchError("private_address", `Adresse non autorisée pour ${hostname}`));
      }
      if (options.all) return cb(null, addresses);
      cb(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
  return new Agent({ connect: { lookup: lookup as never, timeout: TIMEOUT_MS }, headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS });
}

function checkUrl(raw: string, { isAllowed, allowAnyPort }: Guard): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PageFetchError("invalid_url", "URL invalide");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PageFetchError("invalid_url", "Seules les URL http(s) sont acceptées");
  if (url.username || url.password) throw new PageFetchError("invalid_url", "URL avec identifiants refusée");
  if (url.port && url.port !== "80" && url.port !== "443" && !allowAnyPort) {
    throw new PageFetchError("blocked_port", "Port non autorisé");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw new PageFetchError("blocked_domain", "Les conditions de ce site interdisent la récupération automatique");
  }
  if (isIP(host) && !isAllowed(host)) throw new PageFetchError("private_address", "Adresse non autorisée");
  return url;
}

async function readLimited(body: ReadableStream<Uint8Array> | null): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new PageFetchError("too_large", "Page trop volumineuse (2 Mo maximum)");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function get(url: URL, agent: Agent, guard: Guard, accept: string) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetch(current, {
        dispatcher: agent,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof PageFetchError) throw cause;
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new PageFetchError("timeout", "La page ne répond pas (5 s)");
      }
      throw new PageFetchError("network_error", "Page injoignable");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = checkUrl(new URL(res.headers.get("location")!, current).toString(), guard);
      await res.body?.cancel();
      continue;
    }
    return { res, url: current };
  }
  throw new PageFetchError("http_error", "Trop de redirections");
}

async function robotsAllows(url: URL, agent: Agent, guard: Guard): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", url);
  try {
    const { res } = await get(robotsUrl, agent, guard, "text/plain");
    // Convention : 4xx = pas de restriction, 5xx = tout interdit par prudence.
    if (res.status >= 500) return false;
    if (res.status >= 400) return true;
    const body = (await readLimited(res.body as ReadableStream<Uint8Array>)).toString("utf8");
    return robotsParser(robotsUrl.toString(), body).isAllowed(url.toString(), USER_AGENT) !== false;
  } catch (err) {
    if (err instanceof PageFetchError && err.reason === "private_address") throw err;
    return false;
  }
}

export type FetchedPage = { finalUrl: string; contentType: string; body: string };

/** Récupère une annonce en respectant robots.txt, sans jamais joindre une adresse interne. */
export async function fetchJobPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const guard: Guard = { isAllowed: options.isAllowedAddress ?? isPublicAddress, allowAnyPort: options.allowAnyPort ?? false };
  const url = checkUrl(rawUrl, guard);
  const agent = guardedAgent(guard.isAllowed);
  try {
    if (!(await robotsAllows(url, agent, guard))) {
      throw new PageFetchError("disallowed_by_robots", "Le site n'autorise pas la récupération de cette page");
    }
    const { res, url: finalUrl } = await get(url, agent, guard, "text/html,application/xhtml+xml,text/plain;q=0.8");
    if (!res.ok) {
      await res.body?.cancel();
      throw new PageFetchError("http_error", `La page a répondu ${res.status}`);
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!/text\/html|application\/xhtml\+xml|text\/plain/.test(contentType)) {
      await res.body?.cancel();
      throw new PageFetchError("unsupported_content", "Ce lien ne mène pas à une page web");
    }
    const body = (await readLimited(res.body as ReadableStream<Uint8Array>)).toString("utf8");
    return { finalUrl: finalUrl.toString(), contentType, body };
  } finally {
    await agent.close();
  }
}
