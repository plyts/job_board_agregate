CREATE TYPE "public"."analysis_state" AS ENUM('current', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('explicit', 'inferred', 'uncertain');--> statement-breakpoint
CREATE TYPE "public"."requirement_importance" AS ENUM('mandatory', 'preferred', 'condition');--> statement-breakpoint
CREATE TYPE "public"."requirement_kind" AS ENUM('mission', 'hard_skill', 'soft_skill', 'tech', 'years', 'seniority', 'degree', 'certification', 'language', 'contract', 'location', 'remote', 'availability', 'salary', 'clearance');--> statement-breakpoint
CREATE TABLE "job_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "requirement_kind" NOT NULL,
	"importance" "requirement_importance" NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"min_years" integer,
	"provenance" "provenance" NOT NULL,
	"quote" text,
	"quote_start" integer,
	"quote_end" integer,
	"rationale" text,
	"verification_note" text,
	"corrected_by_user" boolean DEFAULT false NOT NULL,
	"removed_by_user" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"state" "analysis_state" DEFAULT 'current' NOT NULL,
	"schema_version" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"llm_call_id" uuid,
	"not_mentioned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_offer_id_job_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_analysis_id_offer_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."offer_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_analyses" ADD CONSTRAINT "offer_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_analyses" ADD CONSTRAINT "offer_analyses_offer_id_job_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_analyses" ADD CONSTRAINT "offer_analyses_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_corrections" ADD CONSTRAINT "requirement_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_corrections" ADD CONSTRAINT "requirement_corrections_requirement_id_job_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."job_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_requirements_analysis_idx" ON "job_requirements" USING btree ("analysis_id","position");--> statement-breakpoint
CREATE INDEX "offer_analyses_offer_idx" ON "offer_analyses" USING btree ("offer_id","state");