-- 🔴 R1·A-1 M5|租戶級事件廣播(把 M4 連上的通道真正接到通知流)。
--
-- ## 為什麼廣播不是「多一個通道」
--
-- `notifications.md` §4.6 已裁定:群組廣播與個人訂閱是**兩種不同的功能**,
-- 不是同一功能的兩種位址。差別是結構性的:
--
--   · 個人 1:1 —— 收件人是**已驗證身分**的使用者,點進去還有權限把關,
--     「跟我相關」講得通,使用者自己能退訂。
--   · 群組 —— 一個 Slack 頻道 / LINE 群 = **不特定多數人**,可能含非 Weyver 使用者、
--     離職員工、外部廠商。**沒有訂閱者、沒有任何權限模型可依靠**,
--     「跟我相關」無意義,只有管理者能停掉。
--
-- 硬把群組塞進三層訂閱矩陣會產生語意錯亂 —— 使用者無法「替群組訂閱」。
-- 故設定入口在**租戶通道設定**(管理者),不在個人通知設定。
--
-- ## 收件人轉為多型
--
-- `notification.recipient_actor_id` 原本 NOT NULL。schema 的註解早已載明方向:
-- 「多型的另一半於 LINE 模組再加,屆時本欄轉為 nullable + 加 target 欄,加欄為純加法」。
-- 現在就是那個時候。CHECK 確保**兩者恰有其一**,不讓「都有」或「都沒有」的列存在。

ALTER TABLE "notification" ALTER COLUMN "recipient_actor_id" DROP NOT NULL;--> statement-breakpoint

/* 非 NULL = 這是一則廣播,送往該租戶已連接的這個通道 */
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "broadcast_channel" text;--> statement-breakpoint

ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_xor_broadcast"
  CHECK (("recipient_actor_id" IS NULL) <> ("broadcast_channel" IS NULL));--> statement-breakpoint

/* 管理者勾選要廣播哪些事件;空陣列 = 連上了但不廣播任何事件(仍可測試發送)。
   刻意是 text[] 而非塞進 config jsonb —— 它要被查詢(emit 時逐事件比對),
   而 jsonb 裡的陣列查起來既慢又容易寫錯。 */
ALTER TABLE "notification_channel"
  ADD COLUMN IF NOT EXISTS "broadcast_events" text[] NOT NULL DEFAULT ARRAY[]::text[];
--> statement-breakpoint
