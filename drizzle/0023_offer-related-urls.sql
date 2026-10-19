ALTER TABLE "job_offers" ADD COLUMN "related_urls" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "job_offers_related_urls_idx" ON "job_offers" USING gin ("related_urls");