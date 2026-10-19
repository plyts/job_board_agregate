import { parse, type HTMLElement } from "node-html-parser";
import type { IncomingOffer } from "@/modules/offers";
import { matchOffer, type Board } from "./boards";

/** Message d'alerte déjà décodé (MIME) : seuls l'expéditeur, la date et le contenu servent. */
export type AlertMessage = { from: string | null; date: Date | null; html: string | null; text: string | null };

type Link = { href: string; label: string; context: string[] };

const GENERIC = /^(voir|postuler|candidater|je postule|apply|view|see|découvrir|decouvrir|consulter|en savoir plus|plus d'offres|toutes les offres|show|more|lire la suite|offre suivante|unsubscribe|se désabonner|gérer)/i;
/** Routeurs d'e-mails courants dont les liens cachent l'adresse réelle. */
const EMAIL_TRACKERS = /(^|\.)(sendgrid\.net|mailgun\.org|sparkpostmail\.com|mandrillapp\.com|list-manage\.com|exacttarget\.com|mjt\.lu|sendinblue\.com|brevo\.com|awstrack\.me|hubspotlinks\.com|cmail\d*\.com|createsend\d*\.com)$/i;
const MAX_RESOLUTIONS = 30;

function clean(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
}

function lines(el: HTMLElement): string[] {
  return el.structuredText
    .split("\n")
    .map(clean)
    .filter((l) => l.length > 1);
}

/** Bloc le plus proche autour d'un lien (cellule, ligne, bloc) : il porte l'entreprise et le lieu de l'offre. */
function context(a: HTMLElement): string[] {
  let el: HTMLElement | null = a.parentNode;
  let best: string[] = [];
  for (let depth = 0; el && depth < 6; depth++, el = el.parentNode) {
    const text = lines(el);
    const size = text.join(" ").length;
    if (size > 500) break;
    best = text;
    if (["td", "tr", "li", "table"].includes(el.rawTagName?.toLowerCase() ?? "") && text.length >= 2) break;
  }
  return best;
}

function htmlLinks(html: string): Link[] {
  const root = parse(html);
  return root.querySelectorAll("a[href]").map((a) => {
    const img = a.querySelector("img");
    return { href: a.getAttribute("href")!.trim(), label: clean(a.textContent) || clean(img?.getAttribute("alt") ?? ""), context: context(a) };
  });
}

function textLinks(text: string): Link[] {
  const all = text.split("\n").map(clean);
  const out: Link[] = [];
  all.forEach((line, i) => {
    for (const m of line.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      // Bloc de lignes qui précède le lien (jusqu'à une ligne vide) : intitulé en tête, puis entreprise et lieu.
      const block: string[] = [];
      for (let j = i - 1; j >= 0 && all[j] && block.length < 4 && !/https?:\/\//.test(all[j]!); j--) block.unshift(all[j]!);
      const inline = clean(line.replace(m[0], ""));
      out.push({ href: m[0], label: inline || block[0] || "", context: inline ? block : block.slice(1) });
    }
  });
  return out;
}

/** Adresse cachée dans les paramètres d'un lien de suivi (`?url=https%3A…`), sans appel réseau. */
function embeddedTargets(href: string): string[] {
  const out: string[] = [];
  try {
    const url = new URL(href);
    for (const v of url.searchParams.values()) if (/^https?:\/\//i.test(v)) out.push(v);
  } catch {
    /* lien mal formé : ignoré */
  }
  try {
    const decoded = decodeURIComponent(href);
    if (decoded !== href) out.push(decoded);
  } catch {
    /* encodage invalide */
  }
  return out;
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export type Resolver = (url: string) => Promise<string>;

/** Liens de pied de message : jamais suivis. */
const FOOTER = /désabonn|desabonn|unsubscribe|gérer|gerer|préférences|preferences|confidentialit|privacy|aide|help|paramètres|settings/i;

/**
 * Un lien n'est suivi que s'il passe par le jobboard lui-même ou par un routeur d'e-mails connu.
 * Jamais pour LinkedIn et Indeed (`noFetch`) : même une redirection de suivi les contacterait, ou compterait un clic pour eux.
 */
function shouldResolve(board: Board, link: Link): boolean {
  if (board.noFetch) return false;
  const host = hostOf(link.href);
  if (!host || FOOTER.test(link.label) || FOOTER.test(link.href)) return false;
  return Boolean(board.tracking?.test(host) || EMAIL_TRACKERS.test(host) || board.senders.test(host));
}

/**
 * Offres d'une alerte : liens d'offre du jobboard (directs, cachés dans un paramètre, ou derrière une redirection
 * de suivi résolue), regroupés par identifiant ; intitulé = texte du lien, entreprise et lieu = lignes voisines.
 * L'offre arrive « à compléter » : l'alerte n'en donne qu'un extrait.
 */
export async function extractOffers(board: Board, msg: AlertMessage, resolve: Resolver): Promise<IncomingOffer[]> {
  const links = msg.html ? htmlLinks(msg.html) : msg.text ? textLinks(msg.text) : [];
  const found = new Map<string, { url: string; labels: string[]; context: string[] }>();
  let resolutions = 0;
  for (const link of links) {
    if (!/^https?:/i.test(link.href)) continue;
    let hit = matchOffer(board, link.href) ?? embeddedTargets(link.href).map((t) => matchOffer(board, t)).find(Boolean) ?? null;
    if (!hit && resolutions < MAX_RESOLUTIONS && shouldResolve(board, link)) {
      resolutions++;
      hit = matchOffer(board, await resolve(link.href).catch(() => link.href));
    }
    if (!hit) continue;
    const entry = found.get(hit.id) ?? { url: hit.url, labels: [], context: [] };
    if (link.label) entry.labels.push(link.label);
    if (link.context.length > entry.context.length) entry.context = link.context;
    found.set(hit.id, entry);
  }

  const offers: IncomingOffer[] = [];
  for (const [id, e] of found) {
    const title = e.labels.filter((l) => l.length >= 4 && !GENERIC.test(l) && !/^https?:/i.test(l)).sort((a, b) => b.length - a.length)[0] ?? e.context.find((l) => !GENERIC.test(l));
    if (!title) continue;
    let rest = e.context.filter((l) => l !== title && !GENERIC.test(l) && !l.includes(title) && l.length <= 120);
    // « Entreprise - Lieu » sur une seule ligne.
    if (rest.length === 1) {
      const parts = rest[0]!.split(/\s+[-–·|•]\s+/);
      if (parts.length === 2) rest = parts;
    }
    offers.push({
      origin: "email_alert",
      board: board.id,
      externalId: id,
      url: e.url,
      title: title.slice(0, 200),
      company: rest[0] ?? null,
      location: rest[1] ?? null,
      publishedAt: msg.date,
      text: [title, ...rest.slice(0, 5)].join("\n"),
      complete: false,
    });
  }
  return offers;
}
