CREATE TABLE "autonumber_counter" (
	"field_id" bigint NOT NULL,
	"tenant_id" bigint NOT NULL,
	"reset_key" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "autonumber_counter_field_id_reset_key_pk" PRIMARY KEY("field_id","reset_key")
);
--> statement-breakpoint
ALTER TABLE "autonumber_counter" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "autonumber_counter" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "autonumber_counter"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.autonumber_counter TO weyver_app;
