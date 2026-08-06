-- R1·C-4 M3|事件觸發器的非同步側。
--
-- 🔴 為什麼是**另一個標記欄**而不是共用 `fanned_out_at`:
--
-- 扇出(通知 / webhook)與觸發器都吃同一張 outbox,但**失敗的後果不同**。
-- 共用標記的話,觸發器失敗重試會把整列重跑一次 —— 而通知與 webhook 是
-- at-least-once 的,重跑等於**再寄一次信、再打一次 webhook**。
-- 使用者會收到重複通知,而原因是一條跟他無關的觸發器失敗了。
--
-- 兩個消費者、兩個標記、兩個 cron,彼此的失敗不互相污染。
-- 代價是多掃一次 outbox,以 pending 部分索引把成本壓在未處理的那幾列上。

ALTER TABLE "event_outbox" ADD COLUMN "trigger_run_at" timestamp with time zone;--> statement-breakpoint

-- 🔴 連鎖深度。觸發器 pushTo 建的記錄會再發 `record.created`,可能再觸發。
-- 事件出生時預設 0;由觸發器建出來的記錄,其事件由 worker 補上父深度 + 1。
ALTER TABLE "event_outbox" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- 重試次數。超過上限寫一筆 `failed` 執行紀錄然後放生 —— 死信就是那筆紀錄。
-- 不另建死信表:要看的人要看的是「哪條觸發器一直失敗」,那正是執行紀錄回答的問題。
ALTER TABLE "event_outbox" ADD COLUMN "trigger_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE INDEX "event_outbox_trigger_pending_idx" ON "event_outbox"
  USING btree ("occurred_at") WHERE trigger_run_at IS NULL;
