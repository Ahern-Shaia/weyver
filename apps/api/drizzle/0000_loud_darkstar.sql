CREATE TABLE "field_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "field_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"form_id" bigint NOT NULL,
	"tenant_id" bigint NOT NULL,
	"name" text NOT NULL,
	"physical_column" text GENERATED ALWAYS AS ('f' || id) STORED NOT NULL,
	"cell_value_type" text NOT NULL,
	"db_field_type" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "form_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"name" text NOT NULL,
	"physical_table" text GENERATED ALWAYS AS ('t' || id) STORED NOT NULL,
	"provision_state" text DEFAULT 'pending' NOT NULL,
	"parent_form_id" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "relation_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "relation_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"field_id" bigint NOT NULL,
	"target_form_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_def" ADD CONSTRAINT "field_def_form_id_form_def_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_def" ADD CONSTRAINT "field_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_def" ADD CONSTRAINT "form_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_def" ADD CONSTRAINT "form_def_parent_form_id_form_def_id_fk" FOREIGN KEY ("parent_form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_def" ADD CONSTRAINT "relation_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_def" ADD CONSTRAINT "relation_def_form_id_form_def_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_def" ADD CONSTRAINT "relation_def_field_id_field_def_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_def" ADD CONSTRAINT "relation_def_target_form_id_form_def_id_fk" FOREIGN KEY ("target_form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_def_form_name_uq" ON "field_def" USING btree ("form_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "field_def_form_idx" ON "field_def" USING btree ("form_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_def_tenant_name_uq" ON "form_def" USING btree ("tenant_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "form_def_tenant_idx" ON "form_def" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "relation_def_form_idx" ON "relation_def" USING btree ("form_id");