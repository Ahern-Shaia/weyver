-- G-2|公開表單。
--
-- 兩個設計刻意與問卷平台不同:
-- (1) 欄位白名單是 opt-in。排除制在「日後有人加一個成本欄」的那一刻就外洩。
-- (2) 匿名提交先落待審收件匣,不直接寫動態表。各家問卷平台都不隔離
--     (Airtable 反而提供 trigger 方便串自動化),但 ERP 下匿名提交直接
--     觸發簽核、吃掉正式單號、污染主檔不可接受。
CREATE TABLE "public_form_share" (
	"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"field_ids" bigint[] DEFAULT '{}' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"max_submissions" integer,
	"closed_message" text,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"allow_attachments" boolean DEFAULT false NOT NULL,
	"require_captcha" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "public_form_share_pkey" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_form_share_token_uq" ON "public_form_share" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "public_form_share_tenant_idx" ON "public_form_share" USING btree ("tenant_id") WHERE deleted_at IS NULL;--> statement-breakpoint
-- 🔴 不啟用 RLS:匿名提交發生在 tenant context 建立**之前**(訪客沒有租戶身分),
-- app.tenant_id 未設時 RLS 會讓 token 查詢永遠空手而回 → 公開表單恆 404。
-- 故 token 解析走特權車道(與 api_key 同理);租戶自助管理另走 service 層顯式綁 tenant_id。
GRANT SELECT, INSERT, UPDATE ON public.public_form_share TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.public_form_share_id_seq TO weyver_app;--> statement-breakpoint

CREATE TABLE "public_submission" (
	"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"share_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"values" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"record_id" bigint,
	"reject_reason" text,
	"submitter_ip_hash" text,
	"submitter_ua" text,
	"reviewed_by" bigint,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_submission_pkey" PRIMARY KEY("id"),
	CONSTRAINT "public_submission_status" CHECK (status IN ('pending','promoted','rejected'))
);
--> statement-breakpoint
CREATE INDEX "public_submission_inbox_idx" ON "public_submission" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "public_submission_share_idx" ON "public_submission" USING btree ("share_id");--> statement-breakpoint
-- 收件匣是租戶資料 → RLS。寫入由匿名路徑走特權車道(已由 token 解析出 tenant_id)。
ALTER TABLE "public_submission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public_submission" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "public_submission"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.public_submission TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.public_submission_id_seq TO weyver_app;
