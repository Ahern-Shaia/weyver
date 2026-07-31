-- 🔴 R1·A-1 M3|認證事件稽核(OQ-SC-12=A 保留 6 個月)。
--
-- ## 為什麼要新表
--
-- `action_audit` 的 `form_id` / `record_id` 皆 **NOT NULL** —— 結構上放不了
-- 「某人登入失敗」這種與表單無關的事件。把它們改成 nullable 會動搖既有不變量
-- (那張表的每一列都保證指得出一筆記錄),故另立一表。
--
-- ## 保留期 6 個月的來源
--
-- 台灣「資通安全責任等級分級辦法」附表十:**保留日誌至少 6 個月**(數位發展部資安署 FAQ)。
-- 客戶多為台灣企業,取法定下限;比國際慣例長:
--   · GitHub security log **90 天**
--   · Microsoft Entra 稽核/登入日誌 Free **7 天** / P1·P2 **30 天**
--   · Microsoft 帳戶 recent activity **30 天**
--
-- ## 🔴 記什麼、不記什麼
--
-- OWASP Logging Cheat Sheet 要求記錄「higher-risk functionality」與
-- 「Modifications to configuration」;**禁記清單**逐字含
-- 「Session identification values」「Access tokens」「Authentication passwords」
-- 「Encryption keys and other primary secrets」。
-- → 本表只記 metadata。**永遠不存密碼、token、session id**。
--
-- ## tenant_id 可為 NULL
--
-- 登入失敗發生在租戶語境建立**之前**(還不知道是誰、屬於哪一家),
-- 那正是最需要記錄的事件之一。強制 NOT NULL 等於把它排除在稽核之外。
-- 故不加 RLS(同 `tenants` / `initial_credential`),改以最小權限收斂。

CREATE TABLE IF NOT EXISTS "auth_audit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  /* 可為 NULL:登入失敗時可能連帳號都不存在 */
  "auth_user_id" text,
  /* 可為 NULL:事件早於租戶語境 */
  "tenant_id" bigint,
  /* login.success / login.failure / logout / session.revoke_others /
     password.change / mfa.enable / mfa.disable / member.create / member.suspend … */
  "event" text NOT NULL,
  /* 為了「這是誰在哪裡做的」——Microsoft Recent Activity 同樣顯示 IP 與瀏覽器。
     ⚠️ IP 屬個資(CJEU C-582/14 Breyer 認定動態 IP 於特定條件下構成個資;
     此點為二手歸納,未逐字取判決原文),故受 6 個月保留期約束、逾期即刪。 */
  "ip_address" text,
  "user_agent" text,
  /* 自由欄位,只放 metadata(誰對誰做了什麼),**不得放密碼 / token / session id** */
  "detail" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "auth_audit_user_idx"
  ON "auth_audit" ("auth_user_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_audit_tenant_idx"
  ON "auth_audit" ("tenant_id", "created_at" DESC);--> statement-breakpoint
/* 保留期清理用 */
CREATE INDEX IF NOT EXISTS "auth_audit_created_idx" ON "auth_audit" ("created_at");--> statement-breakpoint

/* app 車道只讀不寫 —— 寫入一律走服務層特權路徑,
   一般請求路徑造不出假的稽核紀錄(承 initial_credential 的同一手法)。
   ⚠️ 也**不給 DELETE**:稽核紀錄的清理只能由保留期 job 執行。 */
GRANT SELECT ON public.auth_audit TO weyver_app;--> statement-breakpoint
