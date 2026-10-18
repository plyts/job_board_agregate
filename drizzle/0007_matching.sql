CREATE TYPE "public"."match_category" AS ENUM('confirmed', 'partial', 'to_confirm', 'not_demonstrated', 'potential_incompatibility', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."match_item_source" AS ENUM('rule', 'model', 'guard');--> statement-breakpoint
CREATE TYPE "public"."match_mode" AS ENUM('model', 'rules_only');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "match_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"offer_analysis_id" uuid NOT NULL,
	"profile_version_id" uuid NOT NULL,
	"cv_version_id" uuid,
	"state" "analysis_state" DEFAULT 'current' NOT NULL,
	"status" "match_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"mode" "match_mode",
	"weights" jsonb NOT NULL,
	"score" integer,
	"factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"llm_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "match_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"category" "match_category" NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"action" text NOT NULL,
	"source" "match_item_source" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_analyses" ADD CONSTRAINT "match_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_analyses" ADD CONSTRAINT "match_analyses_offer_id_job_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_analyses" ADD CONSTRAINT "match_analyses_offer_analysis_id_offer_analyses_id_fk" FOREIGN KEY ("offer_analysis_id") REFERENCES "public"."offer_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_analyses" ADD CONSTRAINT "match_analyses_profile_version_id_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."profile_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_analyses" ADD CONSTRAINT "match_analyses_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_items" ADD CONSTRAINT "match_items_match_id_match_analyses_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_items" ADD CONSTRAINT "match_items_requirement_id_job_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."job_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_analyses_offer_idx" ON "match_analyses" USING btree ("offer_id","state");--> statement-breakpoint
CREATE INDEX "match_items_match_idx" ON "match_items" USING btree ("match_id","position");