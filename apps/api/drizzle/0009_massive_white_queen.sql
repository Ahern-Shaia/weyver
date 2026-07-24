CREATE TABLE "view_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "view_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'personal' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "view_def_scope" CHECK (scope IN ('personal','shared'))
);
--> statement-breakpoint
ALTER TABLE "view_def" ADD CONSTRAINT "view_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_def" ADD CONSTRAINT "view_def_form_id_form_def_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_def" ADD CONSTRAINT "view_def_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "view_def_tenant_form_name_uq" ON "view_def" USING btree ("tenant_id","form_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "view_def_one_default_uq" ON "view_def" USING btree ("tenant_id","form_id") WHERE is_default AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "view_def_tenant_form_idx" ON "view_def" USING btree ("tenant_id","form_id");