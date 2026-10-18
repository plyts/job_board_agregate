CREATE TYPE "public"."import_outcome" AS ENUM('created', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."offer_source" AS ENUM('url', 'text', 'file');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('queued', 'analyzing', 'analyzed', 'failed', 'qualified', 'discarded');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_user_name_unique" UNIQUE("user_id","normalized_name")
);
--> statement-breakpoint
CREATE TABLE "job_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "offer_source" NOT NULL,
	"original_url" text,
	"canonical_url" text,
	"title" text NOT NULL,
	"company_id" uuid,
	"location" text,
	"raw_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_file_key" text,
	"published_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "offer_status" DEFAULT 'queued' NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_offers_user_hash_unique" UNIQUE("user_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "offer_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"source" "offer_source" NOT NULL,
	"outcome" "import_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_imports" ADD CONSTRAINT "offer_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_imports" ADD CONSTRAINT "offer_imports_offer_id_job_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."job_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_offers_user_canonical_url_unique" ON "job_offers" USING btree ("user_id","canonical_url") WHERE "job_offers"."canonical_url" is not null;--> statement-breakpoint
CREATE INDEX "job_offers_user_created_idx" ON "job_offers" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "offer_imports_user_created_idx" ON "offer_imports" USING btree ("user_id","created_at");