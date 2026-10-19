import { lookup } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { guardedLookup, isPublicAddress } from "@/modules/offers/fetch/safe-fetch";
import { SourceError } from "../types";
import type { AlertMessage } from "./parse";

export type ImapSettings = { host: string; port: number; secure: boolean; user: string; folder: string };
/** Point de reprise : UIDVALIDITY de la boîte et dernier UID traité. */
export type ImapCursor = { uidValidity: string; lastUid: number };
export type ImapOptions = {
  /** En test seulement : serveur local et connexion sans chiffrement (GreenMail). */
  allowPrivateHost?: boolean;
  allowPlaintext?: boolean;
  /** Premier passage : messages des N derniers jours. */
  firstSyncDays?: number;
  maxMessages?: number;
};

export type MailboxMessage = AlertMessage & { uid: number; fromAddress: string | null; subject: string };

/** L'hôte IMAP saisi ne doit pas viser le réseau interne du serveur (même règle que les pages importées). */
async function checkHost(host: string, options: ImapOptions) {
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new SourceError("Hôte IMAP invalide", "invalid");
  if (options.allowPrivateHost) return;
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new SourceError(`Hôte IMAP introuvable : ${host}`, "invalid");
  if (addresses.some((a) => !isPublicAddress(a.address))) throw new SourceError("Hôte IMAP refusé : adresse interne", "invalid");
}

function client(settings: ImapSettings, password: string, options: ImapOptions): ImapFlow {
  if (!settings.secure && !options.allowPlaintext && settings.port !== 143) {
    throw new SourceError("Connexion IMAP non chiffrée refusée : utilise le port 993 (TLS) ou 143 (STARTTLS)", "invalid");
  }
  return new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    // Sans TLS direct, STARTTLS est exigé : le mot de passe ne circule jamais en clair.
    doSTARTTLS: settings.secure || options.allowPlaintext ? undefined : true,
    auth: { user: settings.user, pass: password },
    // Adresse revérifiée à la connexion : `checkHost` seul laisserait passer un DNS qui change entre-temps (rebinding).
    tls: options.allowPrivateHost ? undefined : { lookup: guardedLookup(isPublicAddress, () => new SourceError("Hôte IMAP refusé : adresse interne", "invalid")) as never },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

function translate(err: unknown): SourceError {
  if (err instanceof SourceError) return err;
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (e.authenticationFailed || /auth/i.test(e.responseText ?? "")) return new SourceError("La boîte refuse l'identifiant ou le mot de passe d'application", "auth");
  if (e.code === "ENOTFOUND" || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT") return new SourceError("Serveur IMAP injoignable", "unavailable");
  return new SourceError(`Erreur IMAP${e.responseText ? ` : ${e.responseText.slice(0, 120)}` : ""}`, "unavailable");
}

/** Vérifie la connexion et l'existence du dossier, en lecture seule. */
export async function testMailbox(settings: ImapSettings, password: string, options: ImapOptions = {}): Promise<{ messages: number }> {
  await checkHost(settings.host, options);
  const c = client(settings, password, options);
  try {
    await c.connect();
    const lock = await c.getMailboxLock(settings.folder, { readOnly: true });
    try {
      return { messages: c.mailbox ? c.mailbox.exists : 0 };
    } finally {
      lock.release();
    }
  } catch (err) {
    throw translate(err);
  } finally {
    await c.logout().catch(() => {});
  }
}

/**
 * Nouveaux messages depuis le point de reprise, sans rien modifier dans la boîte (ouverture en lecture seule :
 * pas de « lu », pas de déplacement). Si la boîte a été recréée (UIDVALIDITY changé), reprise sur les derniers jours.
 */
export async function readNewMessages(
  settings: ImapSettings,
  password: string,
  cursor: ImapCursor | null,
  options: ImapOptions = {},
): Promise<{ messages: MailboxMessage[]; cursor: ImapCursor }> {
  await checkHost(settings.host, options);
  const c = client(settings, password, options);
  const max = options.maxMessages ?? 200;
  try {
    await c.connect();
    const lock = await c.getMailboxLock(settings.folder, { readOnly: true });
    try {
      const box = c.mailbox;
      if (!box) throw new SourceError("Dossier IMAP introuvable", "invalid");
      const uidValidity = String(box.uidValidity);
      let uids: number[];
      if (cursor && cursor.uidValidity === uidValidity) {
        if (box.uidNext <= cursor.lastUid + 1) return { messages: [], cursor };
        uids = ((await c.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > cursor.lastUid);
      } else {
        const since = new Date(Date.now() - (options.firstSyncDays ?? 14) * 24 * 60 * 60 * 1000);
        uids = (await c.search({ since }, { uid: true })) || [];
      }
      uids.sort((a, b) => a - b);
      const batch = uids.slice(0, max);
      const messages: MailboxMessage[] = [];
      if (batch.length) {
        for await (const m of c.fetch(batch.join(","), { uid: true, source: true }, { uid: true })) {
          if (!m.source) continue;
          const parsed = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true });
          const fromAddress = parsed.from?.value[0]?.address?.toLowerCase() ?? null;
          messages.push({ uid: m.uid, fromAddress, from: fromAddress, subject: parsed.subject ?? "", date: parsed.date ?? null, html: parsed.html || null, text: parsed.text ?? null });
        }
      }
      const lastUid = batch.length ? batch[batch.length - 1]! : (cursor?.uidValidity === uidValidity ? cursor.lastUid : Math.max(0, box.uidNext - 1));
      return { messages: messages.sort((a, b) => a.uid - b.uid), cursor: { uidValidity, lastUid } };
    } finally {
      lock.release();
    }
  } catch (err) {
    throw translate(err);
  } finally {
    await c.logout().catch(() => {});
  }
}
