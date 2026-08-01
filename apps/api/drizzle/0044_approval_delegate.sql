-- 🔴 R1·後續-1 殘留|簽核代理人(#104)。
--
-- ## 為什麼是必備而不是便利功能
--
-- 沒有代理人時,簽核者一請假,經過他的所有單據就**全部卡死** —— 而請假是常態不是例外。
-- 台灣企業的「職務代理人」是內控慣例,三個對標系統都有:
--   · Ragic|使用者表單有「啟用及通知代理人」
--   · Salesforce|標準欄位 `Delegated Approver`
--   · SAP|計畫性(請假)與非計畫性(突發)兩種代理
--
-- ## 🔴 稽核必須記「B **代** A 核准」
--
-- 若日誌只記「B 核准」,代理這件事在事後完全看不見 —— 稽核時無法回答
-- 「為什麼是 B 批的?他有權嗎?」。故 `approval_step_log` 加 `on_behalf_of_actor_id`:
-- **非 NULL 即代表這是一次代理行為**,且指名被代理者是誰。
--
-- ## 生效期間
--
-- 承 SAP 的計畫性代理:代理有起訖時間,請假結束自動失效。
-- `ends_at` 為 NULL = 無限期(非計畫性代理,例如離職交接)。

CREATE TABLE IF NOT EXISTS "approval_delegate" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  /* 被代理者(原簽核者) */
  "principal_actor_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  /* 代理人 */
  "delegate_actor_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "starts_at" timestamptz NOT NULL DEFAULT now(),
  /* NULL = 無限期 */
  "ends_at" timestamptz,
  "created_by_actor_id" bigint REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  /* 🔴 不得代理自己 —— 那不是代理,是繞過禁自簽的漏洞 */
  CONSTRAINT "approval_delegate_not_self" CHECK ("principal_actor_id" <> "delegate_actor_id"),
  CONSTRAINT "approval_delegate_range" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at")
);--> statement-breakpoint

/* 查詢形狀:decide 時問「這個人是誰的有效代理」 */
CREATE INDEX IF NOT EXISTS "approval_delegate_lookup_idx"
  ON "approval_delegate" ("tenant_id", "delegate_actor_id", "starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_delegate_principal_idx"
  ON "approval_delegate" ("tenant_id", "principal_actor_id");--> statement-breakpoint

ALTER TABLE "approval_delegate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_delegate" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "approval_delegate_tenant" ON "approval_delegate"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_delegate TO weyver_app;--> statement-breakpoint

/* 🔴 代理行為必須在稽核裡看得見。NULL = 本人親自核准。
   `approval_step_log` 是不可變日誌(#103),加欄為純加法。 */
ALTER TABLE "approval_step_log"
  ADD COLUMN IF NOT EXISTS "on_behalf_of_actor_id" bigint REFERENCES "users"("id");
--> statement-breakpoint
