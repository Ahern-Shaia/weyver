CREATE TABLE "field_permissions" (
	"role_id" bigint NOT NULL,
	"field_id" bigint NOT NULL,
	"visibility" text NOT NULL,
	CONSTRAINT "field_permissions_role_id_field_id_pk" PRIMARY KEY("role_id","field_id"),
	CONSTRAINT "field_permissions_visibility" CHECK (visibility IN ('hidden','read','write'))
);
--> statement-breakpoint
CREATE TABLE "form_permissions" (
	"role_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "form_permissions_role_id_form_id_pk" PRIMARY KEY("role_id","form_id"),
	CONSTRAINT "form_permissions_level" CHECK (level IN ('none','read','write','manage'))
);
--> statement-breakpoint
CREATE TABLE "role_members" (
	"role_id" bigint NOT NULL,
	"actor_id" bigint NOT NULL,
	"tenant_id" bigint NOT NULL,
	CONSTRAINT "role_members_role_id_actor_id_pk" PRIMARY KEY("role_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"parent_id" bigint,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"depth" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_no_self_parent" CHECK (parent_id IS NULL OR parent_id <> id)
);
--> statement-breakpoint
ALTER TABLE "field_permissions" ADD CONSTRAINT "field_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_permissions" ADD CONSTRAINT "field_permissions_field_id_field_def_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field_def"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_permissions" ADD CONSTRAINT "form_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_permissions" ADD CONSTRAINT "form_permissions_form_id_form_def_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_members" ADD CONSTRAINT "role_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_members" ADD CONSTRAINT "role_members_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_members" ADD CONSTRAINT "role_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_parent_id_roles_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_permissions_field_idx" ON "field_permissions" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "form_permissions_form_idx" ON "form_permissions" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "role_members_actor_idx" ON "role_members" USING btree ("tenant_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_key_uq" ON "roles" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "roles_tenant_idx" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "roles_parent_idx" ON "roles" USING btree ("parent_id");