import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { LetterProposal } from "@/modules/applications/letter";
import { cvVersions } from "./cv";
import { users } from "./identity";
import { jobOffers } from "./offers";

/** Les 12 colonnes du Kanban, dans l'ordre du parcours. */
export const applicationStatus = pgEnum("application_status", [
  "new_offer",
  "to_analyze",
  "qualified",
  "cv_to_adapt",
  "ready",
  "sent",
  "followed_up",
  "hr_interview",
  "tech_interview",
  "offer_received",
  "rejected",
  "abandoned",
]);

export const applicationEventType = pgEnum("application_event_type", ["created", "status_changed", "sent", "next_action_set"]);
export const applicationDocumentKind = pgEnum("application_document_kind", ["cv", "cover_letter"]);
export const letterDraftStatus = pgEnum("letter_draft_status", ["none", "queued", "running", "done", "failed"]);

/**
 * Candidature : suivi d'une offre jusqu'à la réponse. Une seule candidature active par offre ;
 * une même entreprise peut en avoir plusieurs.
 */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Pas de cascade : une offre liée à une candidature ne se supprime pas (sauf avec le compte).
    offerId: uuid("offer_id")
      .notNull()
      .references(() => jobOffers.id),
    status: applicationStatus("status").notNull(),
    /** Version de CV prévue ou envoyée. */
    cvVersionId: uuid("cv_version_id").references(() => cvVersions.id),
    /** Score du matching au moment de la création, figé pour le suivi. */
    matchScore: integer("match_score"),
    nextAction: text("next_action"),
    nextActionAt: date("next_action_at", { mode: "string" }),
    /** Délai de relance après l'envoi, en jours ; null = pas de relance proposée. */
    followUpDays: integer("follow_up_days").default(7),
    sentAt: date("sent_at", { mode: "string" }),
    channel: text("channel"),
    notes: text("notes").notNull().default(""),
    /** Lettre de motivation (brouillon) ; la version envoyée est figée dans `application_documents`. */
    coverLetter: text("cover_letter").notNull().default(""),
    /** Proposition de lettre par l'IA (letter.draft) : état, raison affichée, paragraphes sourcés et contrôlés. */
    letterStatus: letterDraftStatus("letter_status").notNull().default("none"),
    letterReason: text("letter_reason"),
    letterProposal: jsonb("letter_proposal").$type<LetterProposal>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("applications_one_active_per_offer").on(t.userId, t.offerId).where(sql`${t.status} not in ('rejected', 'abandoned')`),
    index("applications_user_status_idx").on(t.userId, t.status),
    // Une candidature n'atteint les étapes d'après l'envoi qu'avec une date d'envoi confirmée.
    check(
      "applications_sent_has_date",
      sql`${t.status} not in ('sent', 'followed_up', 'hr_interview', 'tech_interview', 'offer_received') or ${t.sentAt} is not null`,
    ),
  ],
);

/** Fichier réellement envoyé : copie exacte et empreinte SHA-256, immuable (trigger). */
export const applicationDocuments = pgTable(
  "application_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: applicationDocumentKind("kind").notNull().default("cv"),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    /** Version de CV d'origine, quand le fichier est l'export d'une version finalisée. */
    cvVersionId: uuid("cv_version_id").references(() => cvVersions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_documents_app_idx").on(t.applicationId)],
);

/** Journal append-only (trigger) : historique de la fiche et source des métriques du tableau de bord. */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: applicationEventType("type").notNull(),
    fromStatus: applicationStatus("from_status"),
    toStatus: applicationStatus("to_status"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_events_user_time_idx").on(t.userId, t.occurredAt), index("application_events_app_idx").on(t.applicationId, t.occurredAt)],
);

/**
 * Contacts d'une candidature (recruteur, manager…), saisis à la main. Données de tiers :
 * jamais envoyées à un modèle, supprimées avec la candidature ou le compte.
 */
export const applicationContacts = pgTable(
  "application_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role"),
    email: text("email"),
    phone: text("phone"),
    url: text("url"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_contacts_app_idx").on(t.applicationId)],
);

/**
 * Réglage des colonnes du Kanban, par utilisateur : nom personnalisé et masquage. Les 12 étapes et leur ordre
 * restent ceux du parcours (les règles d'envoi en dépendent) ; une ligne n'existe que pour une colonne modifiée.
 */
export const boardColumns = pgTable(
  "board_columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: applicationStatus("status").notNull(),
    label: text("label"),
    hidden: boolean("hidden").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("board_columns_user_status").on(t.userId, t.status)],
);
