-- H-1 修:scope_id 為 NULL 時唯一索引不生效(SQL 中 NULL != NULL),
-- 導致租戶層偏好每次修改都新增一列。先去重(保留最新)再改為 NOT NULL DEFAULT 0。
DELETE FROM notification_pref a
 USING notification_pref b
 WHERE a.tenant_id = b.tenant_id AND a.actor_id = b.actor_id AND a.scope = b.scope
   AND a.scope_id IS NULL AND b.scope_id IS NULL AND a.id < b.id;
--> statement-breakpoint
UPDATE notification_pref SET scope_id = 0 WHERE scope_id IS NULL;
--> statement-breakpoint
ALTER TABLE "notification_pref" ALTER COLUMN "scope_id" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "notification_pref" ALTER COLUMN "scope_id" SET NOT NULL;