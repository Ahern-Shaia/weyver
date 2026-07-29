ALTER TABLE "import_batch" ADD COLUMN "source_file_sha256" text;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "revert_expires_at" timestamp with time zone;