CREATE TABLE "ai_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "pii_masked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "pii_in_output" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_versions" ADD COLUMN "privacy_report" jsonb;--> statement-breakpoint
ALTER TABLE "ai_consents" ADD CONSTRAINT "ai_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_consents_one_active" ON "ai_consents" USING btree ("user_id","provider") WHERE "ai_consents"."revoked_at" is null;