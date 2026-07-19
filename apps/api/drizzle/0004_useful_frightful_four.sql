CREATE TABLE "formula_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "formula_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"field_id" bigint NOT NULL,
	"expr_source" text NOT NULL,
	"result_type" text NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"materialized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "formula_def" ADD CONSTRAINT "formula_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_def" ADD CONSTRAINT "formula_def_form_id_form_def_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_def" ADD CONSTRAINT "formula_def_field_id_field_def_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "formula_def_field_uq" ON "formula_def" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "formula_def_form_idx" ON "formula_def" USING btree ("form_id");--> statement-breakpoint
-- RLS(鐵則 3):formula_def 同 form_def/field_def/relation_def 之租戶隔離。NULLIF policy 見 0001。
ALTER TABLE "formula_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "formula_def" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "formula_def"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
-- app 車道角色 grants(承 0003;新表 / 新序列不被舊 ALL 覆蓋 → 顯式授)。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.formula_def TO weyver_app;