ALTER TABLE "match_items" ADD COLUMN "kind" "requirement_kind";--> statement-breakpoint
ALTER TABLE "match_items" ADD COLUMN "importance" "requirement_importance";--> statement-breakpoint
-- Lignes existantes : valeurs reprises de l'exigence liée.
UPDATE "match_items" mi SET "kind" = jr."kind", "importance" = jr."importance" FROM "job_requirements" jr WHERE jr."id" = mi."requirement_id";--> statement-breakpoint
ALTER TABLE "match_items" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_items" ALTER COLUMN "importance" SET NOT NULL;
