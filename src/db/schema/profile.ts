import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { QualityReport } from "@/modules/cv/quality";
import type { ProfileContent } from "@/modules/profile/content";
import { users } from "./identity";

export const profileVersionStatus = pgEnum("profile_version_status", ["draft", "validated"]);
export const profileImportStatus = pgEnum("profile_import_status", ["none", "queued", "extracting", "extracted", "failed"]);

export type ProfileUncertainty = { id: string; field: string; note: string };

/**
 * Profil maître : une ligne par version. Une version validée est immuable (trigger SQL) ;
 * au plus un brouillon par utilisateur.
 */
export const profileVersions = pgTable(
  "profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: profileVersionStatus("status").notNull().default("draft"),
    content: jsonb("content").$type<ProfileContent>().notNull(),
    /** Rapport de bonnes pratiques figé à la validation (avec la version des règles). */
    quality: jsonb("quality").$type<QualityReport>(),
    /** Points à vérifier avant validation (extraction ambiguë, élément absent du CV source…). */
    uncertainties: jsonb("uncertainties").$type<ProfileUncertainty[]>().notNull().default([]),
    origin: text("origin", { enum: ["manual", "import", "edit"] }).notNull(),
    importStatus: profileImportStatus("import_status").notNull().default("none"),
    importReason: text("import_reason"),
    sourceFileKey: text("source_file_key"),
    /** Texte extrait du CV importé : affiché comme source, jamais renvoyé tel quel à un modèle avec les coordonnées. */
    sourceText: text("source_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
  },
  (t) => [
    unique("profile_versions_user_version_unique").on(t.userId, t.version),
    uniqueIndex("profile_versions_one_draft").on(t.userId).where(sql`${t.status} = 'draft'`),
    index("profile_versions_user_idx").on(t.userId, t.version),
  ],
);
