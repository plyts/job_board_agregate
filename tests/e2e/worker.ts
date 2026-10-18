import { eq } from "drizzle-orm";
import { createDb, createPool } from "../../src/db/client";
import { applications, matchAnalyses, profileVersions } from "../../src/db/schema";
import { draftLetter } from "../../src/modules/applications";
import { computeMatch } from "../../src/modules/matching";
import { getCurrentProfile } from "../../src/modules/profile";
import { FakeLlmClient } from "../../src/modules/platform/llm/fake";
import { LlmRouter } from "../../src/modules/platform/llm/router";
import { E2E_JUDGEMENT } from "./fixtures";

/** Le worker ne tourne pas pendant les tests e2e : on traite ici les matchings en attente, avec le même jugement simulé. */
export async function drainPendingMatches(): Promise<number> {
  const pool = createPool(process.env.DATABASE_URL!);
  try {
    const db = createDb(pool);
    const pending = await db
      .select({ id: matchAnalyses.id, userId: matchAnalyses.userId, content: profileVersions.content })
      .from(matchAnalyses)
      .innerJoin(profileVersions, eq(profileVersions.id, matchAnalyses.profileVersionId))
      .where(eq(matchAnalyses.status, "pending"));
    for (const m of pending) {
      const judge = new FakeLlmClient("modele-e2e", undefined, "local").respondWith(E2E_JUDGEMENT(m.content));
      const llm = new LlmRouter([{ client: judge, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
      await computeMatch({ db, pool, llm, budgetUsd: 1000, today: new Date("2026-10-18T12:00:00Z") }, { matchId: m.id, userId: m.userId });
    }
    return pending.length;
  } finally {
    await pool.end();
  }
}

/** Proposition de lettre par un modèle local simulé : un paragraphe prouvé, un paragraphe à signaler (dbt sans preuve). */
export async function draftLetterWithFakeModel(applicationId: string): Promise<void> {
  const pool = createPool(process.env.DATABASE_URL!);
  try {
    const db = createDb(pool);
    const [app] = await db.update(applications).set({ letterStatus: "queued" }).where(eq(applications.id, applicationId)).returning({ userId: applications.userId });
    const profile = (await getCurrentProfile(db, app!.userId))!.content;
    const lumio = profile.experiences[0]!.id;
    const model = new FakeLlmClient("modele-e2e", undefined, "local").respondWith({
      paragraphs: [
        { kind: "opening", text: "Nordwave construit la plateforme de données de ses clients industriels : j'aimerais y contribuer.", sourceIds: [], covers: [] },
        { kind: "body", text: "Data Engineer chez Lumio depuis 2023, j'ai industrialisé 30 pipelines Python et SQL.", sourceIds: [lumio], covers: ["Python et SQL"] },
        { kind: "body", text: "J'ai aussi déployé dbt en production.", sourceIds: [lumio], covers: ["dbt"] },
        { kind: "closing", text: "Je serais heureuse d'en parler avec vous.", sourceIds: [], covers: [] },
      ],
    });
    const llm = new LlmRouter([{ client: model, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
    await draftLetter({ db, llm, budgetUsd: 1000, today: new Date("2026-10-18T12:00:00Z") }, { applicationId, userId: app!.userId });
  } finally {
    await pool.end();
  }
}
