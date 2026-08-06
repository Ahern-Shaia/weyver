-- R1·AI-1 M1|AI 設定(BYO key)+ 用量計量。
--
-- ## 為什麼是 BYO key 而不是原廠代購額度
--
-- 站③查證(2026-08-06):**Ragic 與 Airtable 都是原廠代購**——
-- Ragic `doc/176` 逐字「AI 額度**以美金計算**」、三家九模型自選、80%/100% 寄信;
-- Airtable 是 credits 且逐字「These free credits expire at the end of the month」。
--
-- 我方走 BYO key 是 **OSS-only 的直接後果**,不是因為它比較好。誠實的代價:
-- onboarding 多一步;誠實的好處:成本與資料流向由客戶自己掌握,不經我方轉售。
--
-- 🔴 **因此「額度」在我方沒有對象** —— 看不到客戶在 provider 那邊的帳單。
-- `ai_usage` 記的是「**本平台代你送出了多少**」(呼叫數 / token 數),
-- 不是「你還剩多少」。照抄 Ragic 的百分比會做出一個永遠算不準的數字。

CREATE TABLE "tenant_ai_config" (
	-- 一租戶一列 → tenant_id 直接當 PK,不另發 id
	"tenant_id" bigint PRIMARY KEY NOT NULL,
	-- 🔴 預設關。Airtable 逐字「By default, Airtable AI is automatically enabled」是它的選擇;
	-- 我方預設關,因為 BYO key 模式下沒設 key 的租戶開著也不能用,而「開著卻不能用」是死控件。
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text,
	"model" text,
	-- 信封加密後的密文(`secret-box`:AES-256-GCM,DEK 由 KEK 包)。**永不回傳明文。**
	"api_key_sealed" text,
	-- 末四碼,給人辨認「這是哪一把」。不是機密 —— 光末四碼無法還原金鑰。
	"api_key_hint" text,
	-- 🔴 資料外送同意(OQ-AI-8=C)。Airtable 逐字把 EU/GDPR 客戶單獨處理,
	-- 顯示這有法規驅動;我方客戶在台灣,PDPA 是同一個問題。
	-- 記「誰、什麼時候同意的」,而且可撤回(設 NULL)。
	"consent_at" timestamp with time zone,
	"consent_by_actor_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_ai_config_provider" CHECK (
		"provider" IS NULL OR "provider" IN ('anthropic', 'openai', 'google')
	),
	-- 🔴 要嘛全有要嘛全無。啟用了卻少一項就是「設定看起來正常但永遠不會動」,
	-- 而那種狀態在畫面上看不出來(scheduled_triggers 為同一個理由加過同型約束)。
	CONSTRAINT "tenant_ai_config_enabled_shape" CHECK (
		NOT "enabled" OR (
			"provider" IS NOT NULL AND "model" IS NOT NULL
			AND "api_key_sealed" IS NOT NULL AND "consent_at" IS NOT NULL
		)
	)
);
--> statement-breakpoint

ALTER TABLE "tenant_ai_config" ADD CONSTRAINT "tenant_ai_config_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "tenant_ai_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_ai_config" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_ai_config_tenant" ON "tenant_ai_config"
	USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
	WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON public.tenant_ai_config TO weyver_app;--> statement-breakpoint

-- ## 用量
--
-- 每次呼叫一列。**成功與失敗都記** —— 失敗的呼叫一樣花了錢(provider 多半照收 input token),
-- 只記成功會讓帳對不起來,而「為什麼我的帳單比畫面上多」是最難查的那種客訴。
CREATE TABLE "ai_usage" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	-- 誰觸發的。系統觸發(背景工作)為 NULL。
	"actor_id" bigint,
	-- 哪一個功能。日後 NL 查詢 / 公式助手共用這張表,靠這一欄分。
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "ai_usage_tenant_idx" ON "ai_usage" USING btree ("tenant_id", "created_at" DESC);--> statement-breakpoint

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_usage_tenant" ON "ai_usage"
	USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
	WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

-- 使用者面只讀與寫入自己的用量列;**沒有 UPDATE / DELETE** —— 用量是稽核紀錄,
-- 改得動就不是紀錄了(與傳票不可變同一條原則)。
GRANT SELECT, INSERT ON public.ai_usage TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.ai_usage_id_seq TO weyver_app;
