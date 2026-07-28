CREATE TABLE "tenant_usage_daily" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenant_usage_daily_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" numeric NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_usage_daily" ADD CONSTRAINT "tenant_usage_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_usage_daily_uq" ON "tenant_usage_daily" USING btree ("tenant_id","day","metric");--> statement-breakpoint
CREATE INDEX "tenant_usage_daily_tenant_day_idx" ON "tenant_usage_daily" USING btree ("tenant_id","day");--> statement-breakpoint
ALTER TABLE "tenant_usage_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_usage_daily" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_usage_daily"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
-- F-8 FMEA B8:用量為計費憑據,app 車道**只給讀**;寫入僅限每日 job(特權車道)。
-- 不給 UPDATE / DELETE —— append-only 由權限保證,不靠自律。
GRANT SELECT ON public.tenant_usage_daily TO weyver_app;
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_status" CHECK (status IN ('trial','active','past_due','suspended','cancelled'));
