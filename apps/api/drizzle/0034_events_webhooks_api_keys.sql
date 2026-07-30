-- G-1|事件匯流排 + 出站 Webhook + API 金鑰。
--
-- event_outbox 存在的理由:`record.created` / `record.updated` 在此之前是**死路徑**
-- —— 事件碼有宣告、單元測試覆蓋了過濾邏輯,但全專案只有 2 個 this.notify.* 呼叫點
-- 且都在 approval,RecordService 從未注入 NotificationService。通知設定頁的**預設檔位**
-- (「我建立的資料有變更時通知我」)承諾的行為從未發生過。
-- 一份 outbox 同時餵通知與 webhook,不會再有「一邊有一邊沒有」的漂移。
CREATE TABLE "event_outbox" (
	"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"type" text NOT NULL,
	"form_id" bigint,
	"record_id" bigint,
	"actor_id" bigint,
	"sequence" bigint DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fanned_out_at" timestamp with time zone,
	CONSTRAINT "event_outbox_pkey" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE INDEX "event_outbox_pending_idx" ON "event_outbox" USING btree ("occurred_at") WHERE fanned_out_at IS NULL;--> statement-breakpoint
CREATE INDEX "event_outbox_tenant_idx" ON "event_outbox" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
ALTER TABLE "event_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_outbox"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
-- app 車道只寫入(業務 tx 內);扇出由跨租戶 cron 走特權車道
GRANT SELECT, INSERT ON public.event_outbox TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.event_outbox_id_seq TO weyver_app;--> statement-breakpoint

CREATE TABLE "webhook_endpoint" (
	"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"event_types" text[] DEFAULT '{}' NOT NULL,
	"secret" text NOT NULL,
	"secret_prev" text,
	"secret_rotated_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verify_token" text,
	"subject_actor_id" bigint,
	"payload_mode" text DEFAULT 'thin' NOT NULL,
	"fat_field_ids" bigint[] DEFAULT '{}' NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"first_failure_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "webhook_endpoint_pkey" PRIMARY KEY("id"),
	CONSTRAINT "webhook_endpoint_payload_mode" CHECK (payload_mode IN ('thin','fat'))
);
--> statement-breakpoint
CREATE INDEX "webhook_endpoint_tenant_idx" ON "webhook_endpoint" USING btree ("tenant_id") WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_endpoint"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.webhook_endpoint TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.webhook_endpoint_id_seq TO weyver_app;--> statement-breakpoint

CREATE TABLE "webhook_delivery" (
	"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"endpoint_id" bigint NOT NULL,
	"event_id" bigint,
	"message_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_code" integer,
	"response_body" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY("id"),
	CONSTRAINT "webhook_delivery_status" CHECK (status IN ('pending','sent','failed'))
);
--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_delivery" USING btree ("status","next_attempt_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_delivery_endpoint_idx" ON "webhook_delivery" USING btree ("tenant_id","endpoint_id","created_at");--> statement-breakpoint
ALTER TABLE "webhook_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_delivery" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_delivery"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
-- 投遞紀錄租戶要看得到(自助除錯);重送只改 status/next_attempt_at 故給 UPDATE
GRANT SELECT, INSERT, UPDATE ON public.webhook_delivery TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.webhook_delivery_id_seq TO weyver_app;--> statement-breakpoint

CREATE TABLE "api_key" (
	"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"subject_actor_id" bigint NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_pkey" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_uq" ON "api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_key_tenant_idx" ON "api_key" USING btree ("tenant_id") WHERE revoked_at IS NULL;--> statement-breakpoint
-- 🔴 api_key **不啟用 RLS**:認證發生在 tenant context 建立**之前**,
-- 此時 app.tenant_id 尚未設定,RLS 會讓查詢永遠查不到 → 認證恆失敗。
-- 因此金鑰查驗一律走特權車道(與 Better Auth 的 session 表同理);
-- 租戶自助管理的讀寫則另走 service 層並顯式綁 tenant_id。
GRANT SELECT, INSERT, UPDATE ON public.api_key TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.api_key_id_seq TO weyver_app;
