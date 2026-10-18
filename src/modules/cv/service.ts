import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { Db } from "@/db/client";
import { cvSuggestions, cvVersions, jobOffers, jobRequirements, offerAnalyses, profileVersions } from "@/db/schema";
import { withTransaction, type TxContext } from "@/db/transaction";
import { getCurrentMatch, getCvCheck, requestCvCheck, type MatchRequestDeps } from "@/modules/matching";
import { generateJournaled } from "@/modules/platform/llm/journal";
import type { LlmRouter } from "@/modules/platform/llm/router";
import { LlmError, type LlmClient } from "@/modules/platform/llm/types";
import { getOffer } from "@/modules/offers";
import { getCurrentProfile } from "@/modules/profile";
import type { ProfileContent } from "@/modules/profile/content";
import { CvContent, cvFromProfile } from "./content";
import { exportDocx, exportFileName, exportPdf } from "./export";
import { cvQuality } from "./quality";
import { factCheck, hasBlocking, offerTermsFrom, type FactIssue } from "./factcheck";
import {
  buildSuggestUserMessage,
  checkSuggestion,
  guardSuggestions,
  revertSuggestion,
  SUGGEST_PROMPT_VERSION,
  SUGGEST_SCHEMA_VERSION,
  SUGGEST_SYSTEM,
  SuggestionBatch,
  type Suggestion,
} from "./suggestions";

export type CvVersion = typeof cvVersions.$inferSelect;
export type CvSuggestion = typeof cvSuggestions.$inferSelect;

const UUID = /^[0-9a-f-]{36}$/i;

async function ownedOffer(db: Db, userId: string, offerId: string) {
  if (!UUID.test(offerId)) return null;
  const [offer] = await db.select({ id: jobOffers.id }).from(jobOffers).where(and(eq(jobOffers.id, offerId), eq(jobOffers.userId, userId))).limit(1);
  return offer ?? null;
}

async function profileContent(db: Db, profileVersionId: string): Promise<ProfileContent | null> {
  const [row] = await db.select({ content: profileVersions.content }).from(profileVersions).where(eq(profileVersions.id, profileVersionId)).limit(1);
  return row?.content ?? null;
}

/** Exigences courantes de l'offre (hors exigences retirées par l'utilisateur). */
export async function currentRequirements(db: Db, userId: string, offerId: string) {
  const [analysis] = await db
    .select({ id: offerAnalyses.id })
    .from(offerAnalyses)
    .where(and(eq(offerAnalyses.offerId, offerId), eq(offerAnalyses.userId, userId), eq(offerAnalyses.state, "current")))
    .limit(1);
  if (!analysis) return null;
  return db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.analysisId, analysis.id), eq(jobRequirements.removedByUser, false)))
    .orderBy(asc(jobRequirements.position));
}

export async function getCvDraft(db: Db, userId: string, offerId: string): Promise<CvVersion | null> {
  if (!UUID.test(offerId)) return null;
  const [row] = await db
    .select()
    .from(cvVersions)
    .where(and(eq(cvVersions.userId, userId), eq(cvVersions.offerId, offerId), eq(cvVersions.status, "draft")))
    .limit(1);
  return row ?? null;
}

export async function getCvVersion(db: Db, userId: string, versionId: string): Promise<CvVersion | null> {
  if (!UUID.test(versionId)) return null;
  const [row] = await db.select().from(cvVersions).where(and(eq(cvVersions.id, versionId), eq(cvVersions.userId, userId))).limit(1);
  return row ?? null;
}

/** Versions enregistrées et finalisées, la plus récente d'abord. */
export async function listCvVersions(db: Db, userId: string, offerId: string) {
  if (!UUID.test(offerId)) return [];
  return db
    .select({
      id: cvVersions.id,
      version: cvVersions.version,
      status: cvVersions.status,
      baseProfileVersionId: cvVersions.baseProfileVersionId,
      createdAt: cvVersions.createdAt,
      finalizedAt: cvVersions.finalizedAt,
      quality: cvVersions.quality,
    })
    .from(cvVersions)
    .where(and(eq(cvVersions.userId, userId), eq(cvVersions.offerId, offerId), inArray(cvVersions.status, ["saved", "finalized"])))
    .orderBy(desc(cvVersions.version));
}

export type StartDraftResult = { ok: true; draft: CvVersion } | { ok: false; code: "NO_OFFER" | "NO_PROFILE"; message: string };

/**
 * Ouvre le brouillon de CV d'une offre : le brouillon existant, sinon une copie de la dernière version
 * enregistrée, sinon tout le profil maître courant. Le profil maître n'est jamais modifié.
 */
export async function startCvDraft(db: Db, userId: string, offerId: string): Promise<StartDraftResult> {
  if (!(await ownedOffer(db, userId, offerId))) return { ok: false, code: "NO_OFFER", message: "Offre introuvable." };
  const existing = await getCvDraft(db, userId, offerId);
  if (existing) return { ok: true, draft: existing };
  const [latest] = await db
    .select()
    .from(cvVersions)
    .where(and(eq(cvVersions.userId, userId), eq(cvVersions.offerId, offerId)))
    .orderBy(desc(cvVersions.version))
    .limit(1);
  let base: { profileVersionId: string; content: CvContent };
  if (latest) {
    base = { profileVersionId: latest.baseProfileVersionId, content: latest.content };
  } else {
    const profile = await getCurrentProfile(db, userId);
    if (!profile) return { ok: false, code: "NO_PROFILE", message: "Valide d'abord ton profil maître." };
    base = { profileVersionId: profile.id, content: cvFromProfile(profile.content) };
  }
  const [row] = await db
    .insert(cvVersions)
    .values({ userId, offerId, baseProfileVersionId: base.profileVersionId, version: (latest?.version ?? 0) + 1, status: "draft", content: base.content })
    .onConflictDoNothing()
    .returning();
  // Création concurrente : l'autre requête a créé le brouillon.
  if (!row) return { ok: true, draft: (await getCvDraft(db, userId, offerId))! };
  return { ok: true, draft: row };
}

export type SaveCvResult = { ok: true; revision: number } | { ok: false; error: string };

/** Enregistre le brouillon si personne ne l'a modifié depuis `revision` (autre onglet, suggestion acceptée). */
export async function saveCvDraft(db: Db, userId: string, offerId: string, revision: number, content: unknown): Promise<SaveCvResult> {
  const parsed = CvContent.safeParse(content);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `CV invalide${issue ? ` (${issue.path.join(".")} : ${issue.message})` : ""}.` };
  }
  const rows = await db
    .update(cvVersions)
    .set({ content: parsed.data, revision: sql`${cvVersions.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(cvVersions.userId, userId), eq(cvVersions.offerId, offerId), eq(cvVersions.status, "draft"), eq(cvVersions.revision, revision)))
    .returning({ revision: cvVersions.revision });
  return rows[0] ? { ok: true, revision: rows[0].revision } : { ok: false, error: "Le brouillon a changé entre-temps (autre onglet ou suggestion acceptée) : recharge la page." };
}

/** Repart du profil maître courant : utile quand il a été mis à jour depuis la création du brouillon. */
export async function resetCvFromProfile(db: Db, userId: string, offerId: string): Promise<SaveCvResult> {
  const profile = await getCurrentProfile(db, userId);
  if (!profile) return { ok: false, error: "Aucun profil maître validé." };
  const rows = await db
    .update(cvVersions)
    .set({ content: cvFromProfile(profile.content), baseProfileVersionId: profile.id, revision: sql`${cvVersions.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(cvVersions.userId, userId), eq(cvVersions.offerId, offerId), eq(cvVersions.status, "draft")))
    .returning({ revision: cvVersions.revision });
  return rows[0] ? { ok: true, revision: rows[0].revision } : { ok: false, error: "Aucun brouillon en cours." };
}

/** Remplace le brouillon par le contenu d'une version enregistrée ; l'historique reste intact. */
export async function restoreCvVersion(db: Db, userId: string, versionId: string): Promise<SaveCvResult> {
  const version = await getCvVersion(db, userId, versionId);
  if (!version || version.status === "draft") return { ok: false, error: "Version introuvable." };
  const started = await startCvDraft(db, userId, version.offerId);
  if (!started.ok) return { ok: false, error: started.message };
  const rows = await db
    .update(cvVersions)
    .set({ content: version.content, baseProfileVersionId: version.baseProfileVersionId, revision: sql`${cvVersions.revision} + 1`, updatedAt: new Date() })
    .where(eq(cvVersions.id, started.draft.id))
    .returning({ revision: cvVersions.revision });
  return { ok: true, revision: rows[0]!.revision };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fige le brouillon en version enregistrée immuable (n), le brouillon passe en n + 1.
 * Si le contenu n'a pas changé depuis la dernière version, celle-ci est réutilisée.
 */
export async function checkpointCvDraft(pool: Pool, userId: string, offerId: string): Promise<CvVersion | null> {
  return withTransaction(pool, async (tx) => {
    const [draft] = await tx.db
      .select()
      .from(cvVersions)
      .where(and(eq(cvVersions.userId, userId), eq(cvVersions.offerId, offerId), eq(cvVersions.status, "draft")))
      .for("update")
      .limit(1);
    if (!draft) return null;
    const [latest] = await tx.db
      .select()
      .from(cvVersions)
      .where(and(eq(cvVersions.offerId, offerId), inArray(cvVersions.status, ["saved", "finalized"])))
      .orderBy(desc(cvVersions.version))
      .limit(1);
    if (latest && latest.baseProfileVersionId === draft.baseProfileVersionId && same(latest.content, draft.content)) return latest;
    // Bonnes pratiques figées avec la version, telles que les règles les évaluent aujourd'hui.
    const profile = await profileContent(tx.db, draft.baseProfileVersionId);
    const requirements = (await currentRequirements(tx.db, userId, offerId)) ?? [];
    const quality = profile ? cvQuality(draft.content, profile, offerTermsFrom(requirements)) : null;
    await tx.db.update(cvVersions).set({ version: draft.version + 1 }).where(eq(cvVersions.id, draft.id));
    const [saved] = await tx.db
      .insert(cvVersions)
      .values({ userId, offerId, baseProfileVersionId: draft.baseProfileVersionId, version: draft.version, status: "saved", content: draft.content, quality })
      .returning();
    return saved!;
  });
}

// ---------------------------------------------------------------------------------------------
// Suggestions

export type CvSuggestDeps = { db: Db; pool: Pool; enqueueSuggest: (tx: TxContext, job: { draftId: string; userId: string }) => Promise<void> };

export async function listSuggestions(db: Db, userId: string, draftId: string): Promise<CvSuggestion[]> {
  return db
    .select()
    .from(cvSuggestions)
    .where(and(eq(cvSuggestions.userId, userId), eq(cvSuggestions.cvVersionId, draftId)))
    .orderBy(asc(cvSuggestions.createdAt), asc(cvSuggestions.position));
}

export type RequestSuggestionsResult = { ok: true } | { ok: false; error: string };

/** Demande un nouveau lot de suggestions ; les suggestions non décidées du lot précédent sont remplacées. */
export async function requestSuggestions(deps: CvSuggestDeps, userId: string, offerId: string): Promise<RequestSuggestionsResult> {
  const draft = await getCvDraft(deps.db, userId, offerId);
  if (!draft) return { ok: false, error: "Ouvre d'abord le CV de cette offre." };
  if (!(await currentRequirements(deps.db, userId, offerId))) return { ok: false, error: "L'offre doit d'abord être analysée." };
  if (draft.suggestStatus === "queued" || draft.suggestStatus === "running") return { ok: true };
  await withTransaction(deps.pool, async (tx) => {
    await tx.db.delete(cvSuggestions).where(and(eq(cvSuggestions.cvVersionId, draft.id), inArray(cvSuggestions.state, ["pending", "blocked"])));
    await tx.db.update(cvVersions).set({ suggestStatus: "queued", suggestReason: null }).where(eq(cvVersions.id, draft.id));
    await deps.enqueueSuggest(tx, { draftId: draft.id, userId });
  });
  return { ok: true };
}

export type SuggestGenerationDeps = { db: Db; llm: LlmClient | LlmRouter | null; budgetUsd?: number; today?: Date };

export type SuggestOutcome =
  | { kind: "done"; kept: number; blocked: number; dropped: number }
  | { kind: "skipped" }
  | { kind: "deferred"; reason: string }
  | { kind: "failed"; reason: string };

/** Génère les suggestions (worker). Le CV et le profil sont des données personnelles. */
export async function generateSuggestions(
  deps: SuggestGenerationDeps,
  job: { draftId: string; userId: string },
  attempt: { isFinal: boolean } = { isFinal: false },
): Promise<SuggestOutcome> {
  const { db } = deps;
  const draft = await getCvVersion(db, job.userId, job.draftId);
  if (!draft || draft.status !== "draft" || (draft.suggestStatus !== "queued" && draft.suggestStatus !== "running")) return { kind: "skipped" };
  const setStatus = (suggestStatus: CvVersion["suggestStatus"], suggestReason: string | null) =>
    db.update(cvVersions).set({ suggestStatus, suggestReason }).where(eq(cvVersions.id, draft.id));

  const profile = await profileContent(db, draft.baseProfileVersionId);
  const requirements = await currentRequirements(db, job.userId, draft.offerId);
  if (!profile || !requirements) {
    await setStatus("failed", "Profil ou analyse de l'offre introuvable.");
    return { kind: "failed", reason: "missing" };
  }
  if (!deps.llm) {
    const reason = "Aucun fournisseur IA n'est configuré : tu peux adapter le CV toi-même dans l'éditeur.";
    await setStatus("failed", reason);
    return { kind: "failed", reason };
  }
  const match = await getCurrentMatch(db, job.userId, draft.offerId);
  const categories = new Map(match?.items.map(({ item }) => [item.requirementId, item.category]) ?? []);
  await setStatus("running", null);

  let result;
  try {
    result = await generateJournaled(
      db,
      deps.llm,
      job.userId,
      {
        purpose: "cv.suggest",
        promptVersion: SUGGEST_PROMPT_VERSION,
        schemaVersion: SUGGEST_SCHEMA_VERSION,
        dataClass: "personal",
        system: SUGGEST_SYSTEM,
        user: buildSuggestUserMessage(
          requirements.map((r) => ({ label: r.label, importance: r.importance, category: categories.get(r.id) ?? null })),
          draft.content,
          profile,
        ),
        schema: SuggestionBatch,
        maxTokens: 8000,
        effort: "medium",
      },
      { budgetUsd: deps.budgetUsd },
    );
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    if (err.code === "budget_exceeded" || err.code === "quota_exhausted") {
      const reason = "Budget ou quotas IA du jour atteints : les suggestions arriveront plus tard.";
      await setStatus("queued", reason);
      return { kind: "deferred", reason };
    }
    if (err.code === "no_provider") {
      const reason = "Aucun fournisseur IA n'est autorisé à recevoir ton CV : tu peux l'adapter toi-même dans l'éditeur.";
      await setStatus("failed", reason);
      return { kind: "failed", reason };
    }
    if (err.retryable && !attempt.isFinal) {
      await setStatus("queued", `Échec temporaire (${err.message}) : nouvel essai automatique.`);
      throw err;
    }
    const reason = `Suggestions impossibles : ${err.message}.`;
    await setStatus("failed", reason);
    return { kind: "failed", reason };
  }

  // Le brouillon a pu changer pendant l'appel : le garde-fou s'applique à l'état actuel.
  const fresh = (await getCvVersion(db, job.userId, draft.id)) ?? draft;
  const raw = result.output.suggestions.slice(0, 12);
  const guarded = guardSuggestions(raw, fresh.content, profile, offerTermsFrom(requirements), deps.today);
  const blocked = guarded.filter((s) => s.state === "blocked").length;
  const dropped = raw.length - guarded.length;
  if (guarded.length) {
    await db.insert(cvSuggestions).values(
      guarded.map((s, position) => ({
        userId: job.userId,
        position,
        cvVersionId: draft.id,
        kind: s.kind,
        targetId: s.targetId,
        text: s.text,
        order: s.order,
        sourceIds: s.sourceIds,
        rationale: s.rationale,
        covers: s.covers,
        state: s.state,
        blockReason: s.blockReason,
        llmCallId: result.callId,
      })),
    );
  }
  const note = dropped ? `${dropped} suggestion(s) écartée(s) : sans source vérifiable dans le profil ou inapplicable(s).` : null;
  await setStatus("done", note);
  return { kind: "done", kept: guarded.length - blocked, blocked, dropped };
}

export async function findStalledSuggestions(db: Db, olderThan: Date) {
  return db
    .select({ draftId: cvVersions.id, userId: cvVersions.userId })
    .from(cvVersions)
    .where(and(eq(cvVersions.status, "draft"), inArray(cvVersions.suggestStatus, ["queued", "running"]), lt(cvVersions.updatedAt, olderThan)))
    .limit(100);
}

export type DecisionResult = { ok: true } | { ok: false; error: string };

function toSuggestion(row: CvSuggestion, text?: string): Suggestion {
  return { kind: row.kind, targetId: row.targetId, text: text ?? row.text, order: row.order, sourceIds: row.sourceIds, rationale: row.rationale, covers: row.covers };
}

/** Charge et verrouille la suggestion et son brouillon. */
async function lockSuggestion(tx: TxContext, userId: string, suggestionId: string) {
  if (!UUID.test(suggestionId)) return null;
  const [row] = await tx.db
    .select({ suggestion: cvSuggestions, draft: cvVersions })
    .from(cvSuggestions)
    .innerJoin(cvVersions, eq(cvVersions.id, cvSuggestions.cvVersionId))
    .where(and(eq(cvSuggestions.id, suggestionId), eq(cvSuggestions.userId, userId), eq(cvVersions.status, "draft")))
    .for("update")
    .limit(1);
  return row ?? null;
}

/**
 * Accepte une suggestion, éventuellement modifiée par l'utilisateur. Le garde-fou est rejoué sur le CV actuel :
 * une formulation qui ajoute un fait absent de la source est refusée.
 */
export async function acceptSuggestion(pool: Pool, userId: string, suggestionId: string, editedText?: string, today = new Date()): Promise<DecisionResult> {
  return withTransaction(pool, async (tx) => {
    const row = await lockSuggestion(tx, userId, suggestionId);
    if (!row || row.suggestion.state !== "pending") return { ok: false, error: "Suggestion introuvable ou déjà traitée." };
    const text = editedText?.trim();
    if (editedText !== undefined && (!text || text.length > 1500)) return { ok: false, error: "Texte vide ou trop long." };
    const edited = text !== undefined && text !== row.suggestion.text;
    const profile = await profileContent(tx.db, row.draft.baseProfileVersionId);
    const requirements = (await currentRequirements(tx.db, userId, row.draft.offerId)) ?? [];
    if (!profile) return { ok: false, error: "Profil maître introuvable." };
    const s = toSuggestion(row.suggestion, edited ? text : undefined);
    const verdict = checkSuggestion(row.draft.content, s, profile, offerTermsFrom(requirements), today);
    if (verdict === "inapplicable") return { ok: false, error: "Cette suggestion ne s'applique plus au CV actuel." };
    if (!verdict.ok) {
      if (!edited) await tx.db.update(cvSuggestions).set({ state: "blocked", blockReason: verdict.reason }).where(eq(cvSuggestions.id, row.suggestion.id));
      return { ok: false, error: `Refusé par le contrôle des faits : ${verdict.reason}` };
    }
    await tx.db
      .update(cvVersions)
      .set({ content: verdict.cv, revision: sql`${cvVersions.revision} + 1`, updatedAt: new Date() })
      .where(eq(cvVersions.id, row.draft.id));
    await tx.db
      .update(cvSuggestions)
      .set({ state: edited ? "edited" : "accepted", text: s.text, before: verdict.before ?? null, decidedAt: new Date() })
      .where(eq(cvSuggestions.id, row.suggestion.id));
    return { ok: true };
  });
}

export async function rejectSuggestion(db: Db, userId: string, suggestionId: string): Promise<DecisionResult> {
  if (!UUID.test(suggestionId)) return { ok: false, error: "Suggestion introuvable." };
  const rows = await db
    .update(cvSuggestions)
    .set({ state: "rejected", decidedAt: new Date() })
    .where(and(eq(cvSuggestions.id, suggestionId), eq(cvSuggestions.userId, userId), inArray(cvSuggestions.state, ["pending", "blocked"])))
    .returning({ id: cvSuggestions.id });
  return rows.length ? { ok: true } : { ok: false, error: "Suggestion introuvable ou déjà traitée." };
}

/** Annule une décision : une suggestion acceptée est retirée du CV, une suggestion refusée redevient à décider. */
export async function undoSuggestion(pool: Pool, userId: string, suggestionId: string): Promise<DecisionResult> {
  return withTransaction(pool, async (tx) => {
    const row = await lockSuggestion(tx, userId, suggestionId);
    if (!row) return { ok: false, error: "Suggestion introuvable." };
    const { suggestion } = row;
    if (suggestion.state === "rejected") {
      await tx.db.update(cvSuggestions).set({ state: suggestion.blockReason ? "blocked" : "pending", decidedAt: null }).where(eq(cvSuggestions.id, suggestion.id));
      return { ok: true };
    }
    if (suggestion.state !== "accepted" && suggestion.state !== "edited") return { ok: false, error: "Rien à annuler." };
    const reverted = revertSuggestion(row.draft.content, toSuggestion(suggestion), suggestion.before);
    if (!reverted) return { ok: false, error: "L'élément a été modifié depuis : annule ta modification à la main." };
    await tx.db
      .update(cvVersions)
      .set({ content: reverted, revision: sql`${cvVersions.revision} + 1`, updatedAt: new Date() })
      .where(eq(cvVersions.id, row.draft.id));
    await tx.db.update(cvSuggestions).set({ state: "pending", before: null, decidedAt: null }).where(eq(cvSuggestions.id, suggestion.id));
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Recontrôle et finalisation

export type RecheckResult = { ok: true; versionId: string } | { ok: false; error: string };

/** Fige le brouillon en version, puis lance le matching de cette version (recontrôle). */
export async function recheckCv(deps: MatchRequestDeps, userId: string, offerId: string): Promise<RecheckResult> {
  if (!(await ownedOffer(deps.db, userId, offerId))) return { ok: false, error: "Offre introuvable." };
  const version = await checkpointCvDraft(deps.pool, userId, offerId);
  if (!version) return { ok: false, error: "Aucun brouillon de CV pour cette offre." };
  const check = await requestCvCheck(deps, userId, version.id);
  if (!check.ok) return { ok: false, error: check.message };
  return { ok: true, versionId: version.id };
}

/** Contrôle des faits d'une version, avec les mots-clés de l'offre et le profil de base. */
export async function factCheckVersion(db: Db, userId: string, version: CvVersion, today = new Date()): Promise<FactIssue[] | null> {
  const profile = await profileContent(db, version.baseProfileVersionId);
  if (!profile) return null;
  const requirements = (await currentRequirements(db, userId, version.offerId)) ?? [];
  return factCheck(version.content, profile, offerTermsFrom(requirements), today);
}

export type FinalizeResult = { ok: true } | { ok: false; problems: string[] };

/** Finalise une version recontrôlée : impossible tant qu'un écart factuel bloquant subsiste. */
export async function finalizeCvVersion(db: Db, userId: string, versionId: string, today = new Date()): Promise<FinalizeResult> {
  const version = await getCvVersion(db, userId, versionId);
  if (!version || version.status === "draft") return { ok: false, problems: ["Version introuvable."] };
  if (version.status === "finalized") return { ok: true };
  const check = await getCvCheck(db, userId, version.id);
  const problems: string[] = [];
  if (!check || check.match.status !== "done") problems.push("Le recontrôle de cette version n'est pas terminé.");
  const issues = await factCheckVersion(db, userId, version, today);
  if (!issues) problems.push("Profil maître de référence introuvable.");
  else if (hasBlocking(issues)) problems.push(...issues.filter((i) => i.severity === "blocking").map((i) => i.message));
  if (problems.length) return { ok: false, problems };
  await db.update(cvVersions).set({ status: "finalized", finalizedAt: new Date() }).where(and(eq(cvVersions.id, version.id), eq(cvVersions.status, "saved")));
  return { ok: true };
}

export type ExportResult =
  | { ok: true; bytes: Uint8Array; fileName: string; contentType: string; finalized: boolean }
  | { ok: false; status: 400 | 404; message: string };

/** Export d'une version enregistrée ou finalisée ; un brouillon ne s'exporte pas (il n'est pas traçable). */
export async function exportCvVersion(db: Db, userId: string, versionId: string, format: string): Promise<ExportResult> {
  if (format !== "pdf" && format !== "docx") return { ok: false, status: 400, message: "Format attendu : pdf ou docx." };
  const version = await getCvVersion(db, userId, versionId);
  if (!version || version.status === "draft") return { ok: false, status: 404, message: "Version introuvable." };
  const profile = await profileContent(db, version.baseProfileVersionId);
  if (!profile) return { ok: false, status: 404, message: "Profil de référence introuvable." };
  const offer = await getOffer(db, userId, version.offerId);
  const meta = { version: version.version, company: offer?.company ?? null, createdAt: version.createdAt };
  const bytes = format === "pdf" ? await exportPdf(version.content, profile, meta) : new Uint8Array(await exportDocx(version.content, profile, meta));
  return {
    ok: true,
    bytes,
    fileName: exportFileName(profile, meta, format),
    contentType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    finalized: version.status === "finalized",
  };
}
