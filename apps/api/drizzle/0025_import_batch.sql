CREATE TABLE "import_batch_row" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_batch_row_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"batch_id" bigint NOT NULL,
	"source_row_no" integer NOT NULL,
	"op" text NOT NULL,
	"record_id" bigint,
	"match_key_text" text,
	"before_image" jsonb,
	"after_image" jsonb,
	"error_code" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_batch_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"actor_id" bigint NOT NULL,
	"kind" text DEFAULT 'import' NOT NULL,
	"revert_of_batch_id" bigint,
	"status" text DEFAULT 'planned' NOT NULL,
	"policy" jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch_row" ADD CONSTRAINT "import_batch_row_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_row" ADD CONSTRAINT "import_batch_row_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batch_row_batch_idx" ON "import_batch_row" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "import_batch_row_record_idx" ON "import_batch_row" USING btree ("tenant_id","record_id");--> statement-breakpoint
CREATE INDEX "import_batch_form_idx" ON "import_batch" USING btree ("tenant_id","form_id","created_at");--> statement-breakpoint
ALTER TABLE "import_batch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_batch" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_batch"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
ALTER TABLE "import_batch_row" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_batch_row" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_batch_row"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batch TO weyver_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batch_row TO weyver_app;
