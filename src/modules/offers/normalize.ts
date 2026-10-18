import { createHash } from "node:crypto";

// Paramètres de suivi retirés de l'URL canonique : ils ne changent pas l'annonce.
const TRACKING_PARAMS = [/^utm_/i, /^(gclid|fbclid|msclkid|mc_cid|mc_eid|ref|refid|referrer|trk|trackingid|src|source|origin|from)$/i];

export function canonicalUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.some((re) => re.test(key)))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(kept).toString();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  // Le schéma n'identifie pas l'annonce : http et https donnent la même URL canonique.
  return `https://${url.host}${url.pathname}${url.search}`;
}

/** Nettoie le texte affiché : espaces, lignes vides multiples, caractères de contrôle. */
export function cleanText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Forme comparable : casse, accents de mise en forme et ponctuation ignorés. */
export function normalizeForHash(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeForHash(text)).digest("hex");
}

export function normalizeCompanyName(name: string): string {
  return normalizeForHash(name)
    .replace(/\b(sas|sasu|sarl|sa|inc|ltd|gmbh|group|groupe)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Titre provisoire avant analyse : première ligne non vide, raccourcie. */
export function provisionalTitle(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "Offre sans titre";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
