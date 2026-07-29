CREATE TABLE "field_conversion_snapshot" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "field_conversion_snapshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"conversion_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"field_id" bigint NOT NULL,
	"record_id" bigint NOT NULL,
	"old_value" jsonb,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_conversion_snapshot" ADD CONSTRAINT "field_conversion_snapshot_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_conversion_snapshot_batch_idx" ON "field_conversion_snapshot" USING btree ("tenant_id","conversion_id");--> statement-breakpoint
CREATE INDEX "field_conversion_snapshot_expiry_idx" ON "field_conversion_snapshot" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "field_conversion_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_conversion_snapshot" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "field_conversion_snapshot"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_conversion_snapshot TO weyver_app;
