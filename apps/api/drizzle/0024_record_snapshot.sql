CREATE TABLE "record_snapshot" (
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"record_id" bigint NOT NULL,
	"values" jsonb NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_reason" text NOT NULL,
	CONSTRAINT "record_snapshot_tenant_id_form_id_record_id_pk" PRIMARY KEY("tenant_id","form_id","record_id")
);
--> statement-breakpoint
ALTER TABLE "record_snapshot" ADD CONSTRAINT "record_snapshot_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_snapshot" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "record_snapshot"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.record_snapshot TO weyver_app;
