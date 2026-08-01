-- 🔴 R1·A-1 M4|租戶自行連接通知通道(OQ-SC-6=A 應用層信封加密 / 7=A 憑證不回顯)。
--
-- ## 為什麼要這張表
--
-- 目前唯一送得出去的通道是 email,而 SMTP 憑證來自**環境變數** —— 全平台共用一組。
-- 每個租戶要用自己的 LINE / Slack / Teams / SMTP,憑證就必須逐租戶儲存。
-- `notification_setting` 只存「開哪些通道」(布林),存不了憑證。
--
-- ## 🔴 憑證只能加密,不能雜湊
--
-- 自家 API 金鑰(G-1)存雜湊,因為驗證只需比對。但 LINE token / Slack webhook URL /
-- SMTP 密碼**必須還原成明文才能呼叫第三方** —— 雜湊在這裡不是更安全的選項,是做不到。
-- 加密在**應用層**(見 crypto/secret-box.ts):本專案主威脅是應用被打穿 / RLS 被繞過,
-- 那正是磁碟層 TDE 擋不住的。
--
-- ## 欄位取捨
--
-- `config`(jsonb)放**非機密**的部分(Slack 頻道名、SMTP host/port/寄件人…),
-- `secret_sealed` 放信封加密後的單一字串。分開的理由:非機密部分要能查詢與顯示,
-- 機密部分則**永不回顯**(Grafana `secureJsonFields` 模式 —— API 只回布林旗標)。
--
-- `secret_fingerprint` 是明文的 SHA-256 前 8 bytes,用途只有一個:
-- 讓稽核與 UI 說得出「這次換的值和上次不同」,而不必存或回顯明文。
--
-- ⚠️ **禁記清單**(OWASP Logging Cheat Sheet)逐字含「Access tokens」
-- 「Authentication passwords」「Database connection strings」——
-- 本表的 `secret_sealed` 絕不可出現在 log / 錯誤訊息 / 回應 DTO / LLM prompt。

CREATE TABLE IF NOT EXISTS "notification_channel" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  /* slack / teams / discord / telegram / line / smtp —— 值域由 app 的通道註冊表約束。
     刻意不用 PG enum:新增通道不該需要一次 migration(而 enum 的加值無法 rollback)。 */
  "channel" text NOT NULL,
  /* 非機密設定(頻道名 / SMTP host·port·寄件人 / LINE 收件對象…) */
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  /* 信封加密後的憑證(v1.<kekId>.…);NULL = 尚未設定 */
  "secret_sealed" text,
  /* 明文指紋(不可逆),供稽核與 UI 判斷「值換了沒」 */
  "secret_fingerprint" text,
  /* 最後一次「測試發送」成功的時間 —— 沒測過就不該被當成可用 */
  "verified_at" timestamptz,
  "enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by_actor_id" bigint REFERENCES "users"("id"),
  CONSTRAINT "notification_channel_unique" UNIQUE ("tenant_id", "channel")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_channel_tenant_idx"
  ON "notification_channel" ("tenant_id");--> statement-breakpoint

/* 租戶資料 → RLS FORCE(擁有者也受管;鐵則 3)。 */
ALTER TABLE "notification_channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_channel" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_channel_tenant" ON "notification_channel"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_channel TO weyver_app;--> statement-breakpoint
