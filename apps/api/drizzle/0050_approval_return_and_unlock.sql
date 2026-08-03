-- 🔴 OQ-AP2-6/7/8|退回到指定關 · OQ-AP2-10|鎖定逃生路徑。

-- 兩個新的決定型別。`return` 與 `reject` 刻意分開:
-- reject 是「這件事不成立」(終審駁回),return 是「這件事要改一改再來」——
-- 兩者的後續動作、通知對象、稽核意義都不同,擠成同一個型別事後就分不出來了。
ALTER TABLE "approval_step_log" DROP CONSTRAINT IF EXISTS "approval_step_log_decision";--> statement-breakpoint
ALTER TABLE "approval_step_log" ADD CONSTRAINT "approval_step_log_decision"
  CHECK (decision IN ('approve','reject','submit','withdraw','addApprover','return','unlock'));--> statement-breakpoint

-- 🔴 OQ-AP2-10|強制解鎖。**與 withdraw 不同**:withdraw 會把整個簽核作廢、要從頭送過;
-- 解鎖是「簽核照跑,但這筆記錄暫時可以改」——
-- 對應 Salesforce 的 Unlock action(它與「admin 永遠可編輯」「allowed users 白名單」
-- 並列為三條逃生路徑)。
--
-- 為什麼需要它:本專案原本只有 withdraw,而**簽核人離職會讓記錄永久鎖死** ——
-- 那時唯一的解是作廢重來,連帶丟掉已經簽過的關卡與它們的稽核意義。
ALTER TABLE "approval_instance" ADD COLUMN IF NOT EXISTS "unlocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_instance" ADD COLUMN IF NOT EXISTS "unlocked_by_actor_id" bigint;
