-- 🔴 R1·A-1 M1 修|讓 app 車道能寫租戶設定,但**只能寫設定欄、且只能寫自己那一列**。
--
-- ## 問題
--
-- `tenants` 原本對 `weyver_app` 只有 SELECT、且**完全沒有 RLS**
-- (Tier-1 系統表刻意如此:auth 解析 org→tenant 發生在 `app.tenant_id` 設定**之前**,
-- 那條路徑必須讀得到還不知道是哪一個的租戶列)。
-- 設定中心要寫入,直接 `GRANT UPDATE` 會一次給出兩個過大的權力:
--   (a) 連 `status` / `plan_code` / `max_forms` / `auth_org_id` / `parent_tenant_id` 都能改
--       —— 一個 app 層的 bug 就能讓租戶自己解除停權或調高配額;
--   (b) 沒有 RLS 就沒有跨租戶寫入的兜底,只靠服務層記得加 WHERE。
--
-- ## 解法:欄位級 GRANT + 逐命令 policy
--
-- 1. **欄位級 UPDATE** —— PostgreSQL 原生支援。計費 / 配額 / 租戶身分欄位
--    因此在**資料庫層**就寫不到,不是靠程式碼自律。
-- 2. **ENABLE(不 FORCE)+ 兩條 policy**：
--    · `FOR SELECT USING (true)` —— 讀取行為與現況**完全相同**,不動 auth 路徑;
--    · `FOR UPDATE` 綁 `app.tenant_id` —— 跨租戶寫入由 DB 擋掉。
--    不加 FORCE:表 owner(migration 角色)必須維持完整存取。

GRANT UPDATE (name, tax_id, logo_file_key, default_locale, default_currency, timezone)
  ON public.tenants TO weyver_app;--> statement-breakpoint

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- 讀:維持現況(auth 於租戶語境建立前即需查詢此表)
CREATE POLICY tenants_read ON "tenants" FOR SELECT USING (true);--> statement-breakpoint

-- 寫:只能寫自己那一列。GUC 未設(如 auth 路徑)時 NULLIF → NULL → 條件不成立 → 一列都改不到
CREATE POLICY tenants_self_update ON "tenants" FOR UPDATE
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
