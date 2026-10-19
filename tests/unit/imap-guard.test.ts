import { describe, expect, it, vi } from "vitest";

// DNS rebinding simulé : au contrôle, l'hôte semble public ; à la connexion, il pointe vers 127.0.0.1 (« localhost »).
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

const { testMailbox } = await import("@/modules/sources/email/imap");

describe("client IMAP", () => {
  it("revérifie l'adresse au moment de la connexion et refuse une adresse interne", async () => {
    const err = await testMailbox({ host: "localhost", port: 143, secure: false, user: "alertes", folder: "INBOX" }, "mot-de-passe").catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "SourceError", kind: "invalid", message: "Hôte IMAP refusé : adresse interne" });
  });
});
