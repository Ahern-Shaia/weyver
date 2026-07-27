CREATE TABLE "idempotency_key" (
	"tenant_id" bigint NOT NULL,
	"key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'in_flight' NOT NULL,
	"response_code" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_key_tenant_id_key_pk" PRIMARY KEY("tenant_id","key"),
	CONSTRAINT "idempotency_key_status" CHECK (status IN ('in_flight','done'))
);
--> statement-breakpoint
CREATE INDEX "idempotency_key_expiry_idx" ON "idempotency_key" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "idempotency_key" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_key" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "idempotency_key"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.idempotency_key TO weyver_app;
