-- R1·C-4 FMEA T7|連鎖的**總量**上限。
--
-- 🔴 `depth` 限的是鏈長,不是分支 —— 兩者是**相乘**的。
-- 一張表掛 T 條 pushTo 觸發器,一次存檔 → T 筆 → 每筆再 T 筆……
-- 深度 5 的最壞情況是 T⁵(T=20 → 320 萬筆)。深度上限完全擋不住。
--
-- ## 為什麼是「後代總數」而不是「分支數」
--
-- 限分支數(每個事件最多跑 N 條觸發器)會誤傷合法設定:一張表掛 10 條
-- 各做各的事的觸發器完全正常。而限深度已經證明擋不住乘法。
--
-- 真正該問的是:「**一次使用者存檔,最多可以連帶產生幾筆資料?**」
-- 那是使用者能理解、也是資料庫真正承受的那個量。
--
-- `root_event_id` 標出「這一串是哪一次使用者動作引起的」:
-- NULL = 我自己就是源頭(使用者直接造成);非 NULL = 指向源頭事件。

ALTER TABLE "event_outbox" ADD COLUMN "root_event_id" bigint;--> statement-breakpoint

-- 🔴 只索引**非 NULL** 的:絕大多數事件是使用者直接造成的(NULL),
-- 而計數只會針對連鎖出來的那些。部分索引把成本壓在真的需要數的那幾列上。
CREATE INDEX "event_outbox_root_idx" ON "event_outbox"
  USING btree ("root_event_id") WHERE root_event_id IS NOT NULL;
