CREATE TYPE "public"."backup_run_status" AS ENUM('running', 'ok', 'failed');--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"status" "backup_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"file_name" text,
	"size_bytes" bigint,
	"sha256" text,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "backup_runs_started_idx" ON "backup_runs" USING btree ("started_at");