CREATE TYPE "public"."letter_draft_status" AS ENUM('none', 'queued', 'running', 'done', 'failed');--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "letter_status" "letter_draft_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "letter_reason" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "letter_proposal" jsonb;