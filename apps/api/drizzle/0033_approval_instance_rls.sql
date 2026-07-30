-- 🔴 硬刪記錄前要確認「這筆沒有簽核紀錄」(鐵則 4:過帳後不可刪改),
-- 而該檢查必須與 DELETE 在同一交易 → 必須走 app 車道,但 app 車道對
-- approval_instance 沒有 grant。dev 的 app 車道是特權角色,整個問題被遮住;
-- 整合測用真正的 weyver_app 角色才炸出來(本 session 第五次踩到同一類)。
--
-- 只給 SELECT:簽核狀態機由 ActionsModule 走特權車道推進,app 車道只讀不寫。
-- 同時補上 RLS —— 本表一直有 tenant_id 卻沒有 policy,先前靠「只走特權車道」規避;
-- 既然要開給 app 車道,就得跟其他租戶資料一樣受 RLS 約束,而不是只靠查詢自己記得加條件。
ALTER TABLE "approval_instance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_instance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "approval_instance"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT ON public.approval_instance TO weyver_app;
