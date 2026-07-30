-- 🔴 0031 的 trash_entry_active_uq 漏了 form_id(瀏覽器實走抓到)。
-- 記錄 id 是**每張動態表各自的 identity** —— 表 A 和表 B 都會有 record 1。
-- 只用 (tenant_id, resource_type, resource_id) 當唯一鍵,第二張表刪掉它的 record 1 時
-- 會撞到第一張表的那筆,而插入走 ON CONFLICT DO NOTHING → **entry 被靜默吞掉**。
-- 結果正是這個模組要防的那件事:記錄刪掉了,回收桶裡沒有,使用者永遠找不回來。
--
-- 整合測沒抓到,是因為每個案例都用剛建的表 + 遞增的 record id,從未出現跨表撞號。
-- 已補 trash.integration.test「兩張不同表的 record 1 各自入桶」。
DROP INDEX IF EXISTS "trash_entry_active_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "trash_entry_active_uq" ON "trash_entry" USING btree ("tenant_id","resource_type",COALESCE("form_id", 0),"resource_id") WHERE state = 'trashed';
