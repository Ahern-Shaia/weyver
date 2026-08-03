-- G-1 W7|投遞紀錄保留期。
--
-- `webhook_delivery` 每一列都帶一份完整的 `payload`(業務資料快照)與 `response_body`,
-- 而在此之前**沒有任何機制會清掉它們** —— 既是無上限成長,也是「業務資料的副本
-- 無限期留在另一張表裡」的保留期破口。
--
-- `pruned_at` 不只是時間戳,更是**重送的閘門**:內容被清掉之後若還讓人按重送,
-- 送出去的會是一份空載荷,而且不會有任何錯誤 —— 那比不能重送糟得多。
ALTER TABLE "webhook_delivery" ADD COLUMN IF NOT EXISTS "pruned_at" timestamp with time zone;--> statement-breakpoint

-- 保留期掃描以 created_at 為準;部分索引只涵蓋「還沒清過的」,清完即離開索引
CREATE INDEX IF NOT EXISTS "webhook_delivery_prune_idx"
  ON "webhook_delivery" ("created_at") WHERE "pruned_at" IS NULL;
