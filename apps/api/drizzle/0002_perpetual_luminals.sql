CREATE TABLE "ddl_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ddl_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint,
	"action" text NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"executed_sql" text,
	"result" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ddl_audit_tenant_idx" ON "ddl_audit" USING btree ("tenant_id","created_at");