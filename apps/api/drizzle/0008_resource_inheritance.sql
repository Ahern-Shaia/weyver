CREATE TABLE "category_permissions" (
	"role_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	"actions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	CONSTRAINT "category_permissions_role_id_category_id_pk" PRIMARY KEY("role_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "form_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "form_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_def" ADD COLUMN "category_id" bigint;--> statement-breakpoint
ALTER TABLE "form_def" ADD COLUMN "is_sensitive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "form_def" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_form_actions" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "category_permissions" ADD CONSTRAINT "category_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_permissions" ADD CONSTRAINT "category_permissions_category_id_form_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."form_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_categories" ADD CONSTRAINT "form_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_categories" ADD CONSTRAINT "form_categories_parent_id_form_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."form_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_permissions_category_idx" ON "category_permissions" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_categories_tenant_name_uq" ON "form_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "form_categories_tenant_idx" ON "form_categories" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "form_def" ADD CONSTRAINT "form_def_category_id_form_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."form_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_def" ADD CONSTRAINT "form_def_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;