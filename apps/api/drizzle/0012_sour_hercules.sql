CREATE TABLE "action_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "action_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"button_id" bigint,
	"form_id" bigint NOT NULL,
	"record_id" bigint NOT NULL,
	"actor_id" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approval_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"name" text NOT NULL,
	"steps" jsonb NOT NULL,
	"on_complete_button_id" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_instance" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approval_instance_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"def_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"record_id" bigint NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_instance_status" CHECK (status IN ('pending','approved','rejected','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "approval_step_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approval_step_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"instance_id" bigint NOT NULL,
	"step_no" integer NOT NULL,
	"actor_id" bigint NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_step_log_decision" CHECK (decision IN ('approve','reject','submit','withdraw'))
);
--> statement-breakpoint
CREATE TABLE "button_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "button_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"label" text NOT NULL,
	"action_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"confirm" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "button_def_action_type" CHECK (action_type IN ('updateSelf','pushTo','openUrl'))
);
--> statement-breakpoint
ALTER TABLE "approval_def" ADD CONSTRAINT "approval_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_def" ADD CONSTRAINT "approval_def_form_id_form_def_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "button_def" ADD CONSTRAINT "button_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "button_def" ADD CONSTRAINT "button_def_form_id_form_def_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_audit_idem_uq" ON "action_audit" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "action_audit_record_idx" ON "action_audit" USING btree ("tenant_id","form_id","record_id");--> statement-breakpoint
CREATE INDEX "approval_def_tenant_form_idx" ON "approval_def" USING btree ("tenant_id","form_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_instance_active_uq" ON "approval_instance" USING btree ("tenant_id","form_id","record_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "approval_instance_lookup_idx" ON "approval_instance" USING btree ("tenant_id","form_id","record_id");--> statement-breakpoint
CREATE INDEX "approval_step_log_instance_idx" ON "approval_step_log" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "button_def_tenant_form_idx" ON "button_def" USING btree ("tenant_id","form_id");