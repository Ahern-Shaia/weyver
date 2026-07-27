ALTER TABLE "tenants" ADD COLUMN "max_forms" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "max_fields_per_form" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "max_records_per_form" integer;