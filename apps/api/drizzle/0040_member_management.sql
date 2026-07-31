-- 🔴 R1·A-1 M2|使用者管理:成員狀態 + 初始密碼一次性憑證。
--
-- ## 🔴 OQ-SC-17 的裁定在多租戶下必須修正語意
--
-- 裁定寫的是「停權即擋登入」(刻意不照 Ragic 的「停權者仍可登入」)。
-- 但本專案一個 Better Auth 帳號**可同時屬於多個 org**,若停權真的擋掉登入,
-- 甲公司把離職者停權會連帶讓他進不了乙公司 —— 那是別人家的帳號,我們無權處置。
--
-- 故正確語意是「**擋進入該租戶**」而非「擋登入產品」。
-- 有趣的是這反而向 Ragic 靠回一步:Ragic 說「被停權的使用者仍然可以登入 Ragic」,
-- 正是因為它的帳號也是跨資料庫的。**限制推著設計往同一個地方走。**
-- → 停權是**逐成員**(tenant × actor)而非逐帳號,狀態表因此帶 tenant_id 並受 RLS 管。
--
-- ## 為什麼不刪除使用者
--
-- 承 Ragic 官方逐字:「當有員工離職時,**推薦作法是將離職員工的帳號停權**…
-- 不建議直接刪除使用者,避免失去使用者的資料。」記錄的建立者 / 簽核對象都指向 actor,
-- 刪掉會讓歷史單據失去可解釋性。

CREATE TABLE IF NOT EXISTS "member_state" (
  "tenant_id" bigint NOT NULL REFERENCES "public"."tenants"("id"),
  "actor_id" bigint NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  /* active | suspended。缺列 = active(既有成員零遷移) */
  "status" text NOT NULL DEFAULT 'active',
  "suspended_at" timestamptz,
  "suspended_by" bigint,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "member_state_pk" PRIMARY KEY ("tenant_id", "actor_id"),
  CONSTRAINT "member_state_status" CHECK (status IN ('active', 'suspended'))
);--> statement-breakpoint

ALTER TABLE "member_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_state" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "member_state"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_state TO weyver_app;--> statement-breakpoint

-- 🔴 初始密碼是**一次性憑證**,不是密碼(OQ-SC-16=A)
--
-- OWASP ASVS 5.0.0 §V6.4.1(L1)逐字:「system generated initial passwords or
-- activation codes are securely randomly generated, follow the existing password
-- policy, and **expire after a short period of time or after they are initially
-- used**. These initial secrets **must not be permitted to become the long term
-- password**.」
-- → 兩個條件都做:72 小時效期 **且** 首次使用後即失效並強制改密碼。
-- (⚠️ 72 小時為本專案取值 —— Entra / Google / Okta / Salesforce 四家官方文件
--  **皆未載明暫時密碼的絕對時效上限**,查無可引之數字。)
--
-- **本表不存密碼本身**,只存「這個帳號目前持有一組尚未使用的初始憑證」這件事。
-- 密碼雜湊由 Better Auth 的 account 表保管,我們不碰(OWASP Logging Cheat Sheet
-- 的禁記清單逐字含 Authentication passwords)。
CREATE TABLE IF NOT EXISTS "initial_credential" (
  /* 綁 Better Auth 的 user.id —— 密碼是帳號層級的,不是逐租戶的 */
  "auth_user_id" text PRIMARY KEY,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  /* 非 NULL = 已用過 → 不再強制改密碼、也不再是有效憑證 */
  "used_at" timestamptz,
  /* 稽核:誰、在哪個租戶發的。只存 metadata,不存值 */
  "issued_by_actor_id" bigint NOT NULL,
  "issued_in_tenant_id" bigint NOT NULL REFERENCES "public"."tenants"("id")
);--> statement-breakpoint

/* 🔴 **不加 RLS**:登入流程要在租戶語境建立**之前**判斷「這個帳號是否須強制改密碼」,
   與 `tenants` 不設 RLS 同一理由(見 0039)。改以最小權限收斂:
   app 車道只給 SELECT / UPDATE(標記已使用),**不給 INSERT** ——
   簽發只走服務層的特權路徑,一般請求路徑無法自行造出一張有效憑證。 */
GRANT SELECT, UPDATE ON public.initial_credential TO weyver_app;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "initial_credential_pending_idx"
  ON "initial_credential" ("expires_at") WHERE used_at IS NULL;--> statement-breakpoint
