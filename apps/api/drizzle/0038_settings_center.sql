-- 🔴 R1·A-1 M1|設定中心:租戶設定欄位 + 個人設定表。
--
-- ## 兩軸時區(OQ-SC-3=A;證據見 settings-center.md §0.2)
--
-- `tenants.timezone` **已存在**且語意是「業務日界線」—— autoNumber 的日期段與歸零週期
-- 靠它判定(台灣 UTC+8 在 01/01 08:00 前開的單若走 UTC 會拿到去年序號)。
-- 這與 GA4 對 `timeZone` 的定義同一個模型,官方逐字:
--   「Reporting Time Zone, used as the **day boundary** for reports,
--     regardless of where the data originates.」
-- → **業務日界線不可被個人覆寫**,它定義資料語意而非呈現。
--
-- 個人的 `display_timezone` 是另一軸:只影響畫面上時間戳怎麼寫出來。
-- Airtable 是現成範例(存 GMT、預設轉各人本地、欄位可釘死單一時區)。
--
-- ## 繼承 = 動態繼承,不是建帳號時複製(OQ-SC-3=A)
--
-- 本表**沒有該列 = 繼承租戶值**;改租戶值即時反映到所有未自訂者。
-- 兩家講法相反,刻意選 Confluence 而非 Google Workspace:
--   · Confluence:「if the user doesn't have a customized time zone, a change in the
--     default time zone **will** reflect on their profile」
--   · Google Workspace:「Setting a default time zone applies only to **new** user
--     accounts.」「Existing users keep their current time zone.」
--     且附帶不可逆陷阱:「If you set a time zone, you **can't switch back** to using
--     time zones based on the user's location.」
-- 選動態繼承的理由:(a) 「有列才覆寫」天然就是動態繼承,零額外機制;
-- (b) 複製語意會走上那個不可逆陷阱。
--
-- ## 為什麼個人設定是 (tenant, actor) 而非 per-user 全域
--
-- 沿用 `notification_pref` / `notification_setting` 的既有粒度(同一人在兩個租戶
-- 各有一份),與 Slack 的 workspace-level preferences 同模型。
-- 一致性優先:兩張設定表用不同粒度會讓「我的偏好在哪」變成要看情況。

-- 租戶設定:公司資料與地區預設。全部 nullable → 既有租戶零遷移。
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tax_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logo_file_key" text;--> statement-breakpoint
-- 語言/幣別為「預設值」語意(個人可覆寫語言;幣別目前無個人軸)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "default_locale" text NOT NULL DEFAULT 'zh-Hant';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "default_currency" text NOT NULL DEFAULT 'TWD';--> statement-breakpoint

-- 統編為台灣格式(8 碼數字);允許 NULL(非台灣客戶 / 尚未填)
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_tax_id_format"
  CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{8}$');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_pref" (
  "tenant_id" bigint NOT NULL,
  "actor_id" bigint NOT NULL,
  /* 🔴 三欄皆 nullable —— NULL = **繼承租戶值**,不是「關閉」。
     與 notification_pref 的「缺列 = 繼承上層」同一語意。 */
  "locale" text,
  "display_timezone" text,
  /* UI 偏好(導覽軌收合等)。目前存 localStorage,此欄為跨裝置的後續退路;
     先建欄不建 UI 會變成死控件,故 M1 不寫入 —— 留白是刻意的。 */
  "ui" jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_pref_pk" PRIMARY KEY ("tenant_id", "actor_id")
);--> statement-breakpoint

ALTER TABLE "user_pref" ADD CONSTRAINT "user_pref_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");--> statement-breakpoint
ALTER TABLE "user_pref" ADD CONSTRAINT "user_pref_actor_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "user_pref" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_pref" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "user_pref"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_pref TO weyver_app;--> statement-breakpoint
