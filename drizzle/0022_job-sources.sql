CREATE TYPE "public"."source_kind" AS ENUM('france_travail', 'adzuna', 'career_page', 'email_alerts');--> statement-breakpoint
CREATE TYPE "public"."source_state" AS ENUM('active', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('schedule', 'manual', 'search');--> statement-breakpoint
ALTER TYPE "public"."offer_source" ADD VALUE 'france_travail';--> statement-breakpoint
ALTER TYPE "public"."offer_source" ADD VALUE 'adzuna';--> statement-breakpoint
ALTER TYPE "public"."offer_source" ADD VALUE 'career_page';--> statement-breakpoint
ALTER TYPE "public"."offer_source" ADD VALUE 'email_alert';--> statement-breakpoint
ALTER TYPE "public"."offer_status" ADD VALUE 'incomplete' BEFORE 'queued';--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret" text,
	"state" "source_state" DEFAULT 'active' NOT NULL,
	"cursor" jsonb,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_sightings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"origin" "offer_source" NOT NULL,
	"board" text NOT NULL,
	"external_id" text,
	"url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"keywords" text NOT NULL,
	"location" text,
	"radius_km" integer,
	"contracts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_within_days" integer DEFAULT 7 NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interval_hours" integer DEFAULT 6 NOT NULL,
	"max_per_run" integer DEFAULT 20 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid,
	"saved_search_id" uuid,
	"trigger" "sync_trigger" NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"query" jsonb,
	"results" jsonb
);
--> statement-breakpoint
ALTER TABLE "job_offers" ADD COLUMN "dedup_key" text;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_sightings" ADD CONSTRAINT "offer_sightings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_sightings" ADD CONSTRAINT "offer_sightings_offer_id_job_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_saved_search_id_saved_searches_id_fk" FOREIGN KEY ("saved_search_id") REFERENCES "public"."saved_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_user_key" ON "job_sources" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_sightings_external" ON "offer_sightings" USING btree ("user_id","board","external_id") WHERE "offer_sightings"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "offer_sightings_offer_idx" ON "offer_sightings" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "saved_searches_user_idx" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sync_runs_user_started_idx" ON "sync_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "job_offers_user_dedup_idx" ON "job_offers" USING btree ("user_id","dedup_key");