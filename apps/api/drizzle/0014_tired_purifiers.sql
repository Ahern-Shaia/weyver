CREATE TABLE "file_object" (
	"key" text PRIMARY KEY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"field_id" bigint NOT NULL,
	"record_id" bigint,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "file_object_status" CHECK (status IN ('pending','bound','orphaned'))
);
--> statement-breakpoint
CREATE INDEX "file_object_tenant_form_idx" ON "file_object" USING btree ("tenant_id","form_id");--> statement-breakpoint
CREATE INDEX "file_object_record_idx" ON "file_object" USING btree ("tenant_id","form_id","record_id");--> statement-breakpoint
CREATE INDEX "file_object_status_idx" ON "file_object" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "file_object" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "file_object" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "file_object"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.file_object TO weyver_app;
