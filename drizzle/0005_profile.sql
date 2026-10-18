CREATE TYPE "public"."profile_import_status" AS ENUM('none', 'queued', 'extracting', 'extracted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."profile_version_status" AS ENUM('draft', 'validated');--> statement-breakpoint
CREATE TABLE "profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "profile_version_status" DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"uncertainties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text NOT NULL,
	"import_status" "profile_import_status" DEFAULT 'none' NOT NULL,
	"import_reason" text,
	"source_file_key" text,
	"source_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone,
	CONSTRAINT "profile_versions_user_version_unique" UNIQUE("user_id","version")
);
--> statement-breakpoint
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_versions_one_draft" ON "profile_versions" USING btree ("user_id") WHERE "profile_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "profile_versions_user_idx" ON "profile_versions" USING btree ("user_id","version");