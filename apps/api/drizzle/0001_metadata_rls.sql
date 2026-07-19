-- metadata 表 RLS(鐵則 3)+ Tier-2 動態表集中 schema。
-- policy 用 NULLIF:custom GUC 於 session 內 set 過後 reset 值為 '' 非 NULL(M1 spike S3 發現)。
-- 注意:superuser / BYPASSRLS 不受 RLS 約束 — app 連線角色必須非 superuser(M5 佈署角色分離)。

CREATE SCHEMA IF NOT EXISTS "data";
--> statement-breakpoint
ALTER TABLE "form_def" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "form_def" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "form_def"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
ALTER TABLE "field_def" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "field_def" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "field_def"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
ALTER TABLE "relation_def" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "relation_def" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "relation_def"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
