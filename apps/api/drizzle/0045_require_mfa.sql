-- 🔴 F-4 殘留|租戶層強制二步驟驗證(#112)。
--
-- ## 依據(一手)
--
-- GitHub 組織層 2FA 要求的兩條逐字規定,本設計照抄:
--   · 前置|「Before you can require organization members, outside collaborators,
--     and billing managers to use two-factor authentication, you must enable 2FA
--     for your account.」→ **開啟者本人必須先啟用**,否則第一個被鎖在外的就是管理員。
--   · 後果|「Members and billing managers who do not use 2FA will not be able to
--     access your organization's resources until they enable 2FA on their account.」
--     → **擋在資源外,不是刪帳號**;登記那條路必須保持暢通。
--
-- Google Workspace 另有「新成員登記寬限期」(1 天–6 個月)。**本案不做**:
-- 該寬限期存在的理由是 Google 的登記要綁手機、屬於系統外的動作;
-- 我方登記是 TOTP、在畫面上 30 秒完成,沒有非同步等待,加寬限期只是多一個靜默的洞。
--
-- 預設 false = 既有租戶零行為變化。

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "require_mfa" boolean NOT NULL DEFAULT false;

-- 🔴 欄位級 GRANT 必須跟著加。0039 刻意只授予「設定欄」的 UPDATE
-- (計費 / 配額 / 租戶身分欄位在**資料庫層**就寫不到,不靠程式碼自律)——
-- 於是任何新增的設定欄若忘了這一行,前端會拿到 500 而不是「沒權限」。
-- 實測即如此:加完欄位、UI 也做好了,存檔一律 internal error。
--
-- `require_mfa` 屬於**客戶自己的安全政策**(對照 `status`/`plan_code` 是我方的
-- 計費控制,客戶不得自行變更),故授予;誰能改由 controller 把關(須為 admin
-- 且本人已啟用 2FA)。
GRANT UPDATE (require_mfa) ON public.tenants TO weyver_app;
