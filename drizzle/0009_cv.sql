CREATE TYPE "public"."cv_suggest_status" AS ENUM('none', 'queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cv_suggestion_kind" AS ENUM('rephrase', 'summary', 'reorder_items', 'include');--> statement-breakpoint
CREATE TYPE "public"."cv_suggestion_state" AS ENUM('pending', 'accepted', 'rejected', 'edited', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."cv_version_status" AS ENUM('draft', 'saved', 'finalized');--> statement-breakpoint
CREATE TABLE "cv_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cv_version_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" "cv_suggestion_kind" NOT NULL,
	"target_id" text,
	"text" text,
	"order" jsonb,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"covers" text,
	"state" "cv_suggestion_state" DEFAULT 'pending' NOT NULL,
	"block_reason" text,
	"before" jsonb,
	"llm_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "cv_suggestions_sourced" CHECK (jsonb_array_length("cv_suggestions"."source_ids") > 0)
);
--> statement-breakpoint
CREATE TABLE "cv_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"base_profile_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "cv_version_status" DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"suggest_status" "cv_suggest_status" DEFAULT 'none' NOT NULL,
	"suggest_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "cv_versions_offer_version_unique" UNIQUE("offer_id","version")
);
--> statement-breakpoint
ALTER TABLE "cv_suggestions" ADD CONSTRAINT "cv_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_suggestions" ADD CONSTRAINT "cv_suggestions_cv_version_id_cv_versions_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_suggestions" ADD CONSTRAINT "cv_suggestions_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD CONSTRAINT "cv_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD CONSTRAINT "cv_versions_offer_id_job_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD CONSTRAINT "cv_versions_base_profile_version_id_profile_versions_id_fk" FOREIGN KEY ("base_profile_version_id") REFERENCES "public"."profile_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cv_suggestions_version_idx" ON "cv_suggestions" USING btree ("cv_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cv_versions_one_draft" ON "cv_versions" USING btree ("offer_id") WHERE "cv_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "cv_versions_user_offer_idx" ON "cv_versions" USING btree ("user_id","offer_id");--> statement-breakpoint
ALTER TABLE "match_analyses" ADD CONSTRAINT "match_analyses_cv_version_id_cv_versions_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_versions"("id") ON DELETE cascade ON UPDATE no action;