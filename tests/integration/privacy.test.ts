import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Document, Packer, Paragraph } from "docx";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createPool } from "@/db/client";
import { llmCalls, profileVersions } from "@/db/schema";
import { createUser } from "@/modules/identity";
import { generateJournaled } from "@/modules/platform/llm/journal";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LlmRouter } from "@/modules/platform/llm/router";
import { LlmError } from "@/modules/platform/llm/types";
import { LocalFsStorage } from "@/modules/platform/storage";
import { grantConsent, listConsents, personalDataStats, revokeConsent } from "@/modules/privacy";
import { discardDraft, extractProfile, getDraft, importCv, purgeImportedSources, resolveUncertainty, validateDraft } from "@/modules/profile";
import { CV_EXTRACTION } from "../helpers/fixtures";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const CV = [
  "Jean-Pierre DUPONT",
  "Data Engineer",
  "12 bis rue des Lilas, 69003 Lyon",
  "jp.dupont@exemple.fr · 06 12 34 56 78 · linkedin.com/in/jpdupont",
  "Né le 14/03/1990 · Nationalité : française · Marié, 2 enfants · RQTH",
  "",
  "EXPÉRIENCE",
  "Data Engineer — Lumio (09/2023 – aujourd'hui)",
  "- Développement et maintenance de 30 pipelines Python/SQL orchestrés par Airflow.",
  "- Migration de l'entrepôt vers BigQuery, 4 To.",
  "Data Engineer — Sencia (06/2021 – 08/2023)",
  "- Ingestion quasi temps réel d'événements via Pub/Sub.",
  "",
  "FORMATION",
  "Master Informatique, données — Université de Lyon — 2021",
];

async function docx(lines: string[]) {
  return Packer.toBuffer(new Document({ sections: [{ children: lines.map((l) => new Paragraph(l)) }] }));
}

describe("confidentialité : masquage avant l'IA, contrôle après, consentement, conservation", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const root = await mkdtemp(path.join(tmpdir(), "jobpilot-privacy-"));
  const storage = new LocalFsStorage(root);
  const deps = { db, pool, storage, enqueueExtraction: async () => {} };
  let userId = "";

  beforeEach(async () => {
    await resetDb(db);
    userId = (await createUser(db, { email: "p@exemple.fr", displayName: "P", password: "un mot de passe solide" })).id;
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  it("importe un DOCX, n'envoie au modèle qu'un texte masqué, nettoie sa réponse et réinjecte l'identité localement", async () => {
    const imported = await importCv(deps, userId, await docx(CV), { declaredName: "Jean-Pierre Dupont" });
    if (!imported.ok) throw new Error(imported.error);
    // Le modèle (simulé) recopie une adresse e-mail et une balise : la réponse doit être nettoyée.
    const output = { ...CV_EXTRACTION, fullName: "[CANDIDAT]", summary: "Joignable à jp.dupont@exemple.fr, voir [ADRESSE]." };
    const llm = new FakeLlmClient("m", undefined, "local").respondWith(output);
    const router = new LlmRouter([{ client: llm, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
    expect(await extractProfile({ db, llm: router }, { versionId: imported.versionId, userId })).toMatchObject({ kind: "extracted" });

    const sent = llm.requests[0]!.user;
    for (const leaked of ["DUPONT", "Dupont", "Jean-Pierre", "Lilas", "69003", "jp.dupont", "06 12 34 56 78", "linkedin", "14/03/1990", "française", "Marié", "RQTH"]) {
      expect(sent).not.toContain(leaked);
    }
    expect(sent).toContain("30 pipelines Python/SQL");
    expect(llm.requests[0]!.dataClass).toBe("personal");

    const draft = (await getDraft(db, userId))!;
    // Le nom déclaré à l'import prime sur celui deviné dans l'en-tête (« Jean-Pierre DUPONT »).
    expect(draft.content.identity).toMatchObject({ fullName: "Jean-Pierre Dupont", email: "jp.dupont@exemple.fr", phone: "06 12 34 56 78" });
    expect(draft.content.summary).not.toContain("jp.dupont");
    expect(draft.uncertainties.map((u) => u.note).join(" ")).toContain("adresse postale");
    expect(draft.privacyReport).toMatchObject({
      rulesVersion: 1,
      before: { name: expect.any(Number), email: 1, phone: 1, address: 1, postal_code: 1, birth_date: 1, nationality: 1, family: 2, sensitive: 1, personal_link: 1 },
      after: { email: 1 },
      sensitive: true,
    });
    const [call] = await db.select().from(llmCalls).where(eq(llmCalls.userId, userId));
    expect(call).toMatchObject({ purpose: "profile.extract", piiInOutput: 1 });
  });

  it("n'envoie des données personnelles à un fournisseur distant qu'avec un consentement actif", async () => {
    const schema = z.object({ note: z.string() });
    const groq = new FakeLlmClient("m", undefined, "groq");
    const router = new LlmRouter([{ client: groq, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
    const req = { purpose: "cv.suggest", promptVersion: "v", schemaVersion: 1, dataClass: "personal" as const, system: "s", user: "Écrire à anne@exemple.fr ou au 06 11 22 33 44, Anne Martin.", schema, privacy: { names: ["Anne Martin"] } };

    await expect(generateJournaled(db, router, userId, req)).rejects.toMatchObject({ code: "no_provider" } satisfies Partial<LlmError>);
    expect(groq.requests).toHaveLength(0);

    await grantConsent(db, userId, "groq");
    await grantConsent(db, userId, "groq");
    expect(await listConsents(db, userId)).toHaveLength(1);
    groq.respondWith({ note: "Rappeler Anne Martin au 06 11 22 33 44." });
    const r = await generateJournaled(db, router, userId, req);
    expect(groq.requests[0]!.user).toBe("Écrire à [E-MAIL] ou au [TÉLÉPHONE], [CANDIDAT].");
    expect(r.output.note).toBe("Rappeler [CANDIDAT] au [TÉLÉPHONE].");
    expect(r.privacy).toEqual({ masked: { email: 1, phone: 1, name: 1 }, inOutput: { name: 1, phone: 1 } });
    const [call] = await db.select().from(llmCalls).where(eq(llmCalls.userId, userId));
    expect(call).toMatchObject({ provider: "groq", piiMasked: 3, piiInOutput: 2 });
    expect(await personalDataStats(db, userId)).toMatchObject({
      calls: 1,
      maskedAtBoundary: 3,
      removedFromOutput: 2,
      byProvider: [{ provider: "groq", calls: 1, masked: 3, removedFromOutput: 2 }],
    });

    await revokeConsent(db, userId, "groq");
    await expect(generateJournaled(db, router, userId, req)).rejects.toMatchObject({ code: "no_provider" });
    // Le retrait date le consentement sans l'effacer ; un nouveau consentement crée une nouvelle ligne.
    await grantConsent(db, userId, "groq");
    const history = await listConsents(db, userId);
    expect(history.map((c) => c.revokedAt === null).sort()).toEqual([false, true]);
    await revokeConsent(db, userId, "groq");
    // Données publiques (annonce) : pas de consentement nécessaire.
    groq.respondWith({ note: "ok" });
    expect((await generateJournaled(db, router, userId, { ...req, dataClass: "public" })).output.note).toBe("ok");
  });

  it("efface le CV source après la durée de conservation, sans toucher au profil validé, et ne laisse aucun fichier d'un brouillon supprimé", async () => {
    const imported = await importCv(deps, userId, await docx(CV));
    if (!imported.ok) throw new Error(imported.error);
    const llm = new FakeLlmClient("m", undefined, "local").respondWith({ ...CV_EXTRACTION, uncertainties: [] });
    await extractProfile({ db, llm: new LlmRouter([{ client: llm, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]) }, { versionId: imported.versionId, userId });
    const draft = (await getDraft(db, userId))!;
    for (const u of draft.uncertainties) await resolveUncertainty(db, userId, u.id);
    expect((await validateDraft(db, userId)).ok).toBe(true);
    const file = path.join(root, draft.sourceFileKey!);
    expect(existsSync(file)).toBe(true);

    expect(await purgeImportedSources({ db, storage }, 30)).toBe(0);
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await purgeImportedSources({ db, storage }, 30, later)).toBe(1);
    const [v] = await db.select().from(profileVersions).where(eq(profileVersions.id, draft.id));
    expect(v).toMatchObject({ status: "validated", sourceText: null, sourceFileKey: null });
    expect(v!.content.identity.fullName).toBe("Jean-Pierre DUPONT");
    expect(existsSync(file)).toBe(false);
    // Le reste de la version validée reste immuable.
    await expect(db.update(profileVersions).set({ origin: "manual" }).where(eq(profileVersions.id, draft.id))).rejects.toBeTruthy();

    const second = await importCv(deps, userId, await docx(CV));
    if (!second.ok) throw new Error(second.error);
    const secondFile = path.join(root, (await getDraft(db, userId))!.sourceFileKey!);
    expect(existsSync(secondFile)).toBe(true);
    await discardDraft({ db, storage }, userId);
    expect(existsSync(secondFile)).toBe(false);
  });
});
