-- 🔴 OQ-AP2-5 = B|臨時加簽(同一關加人)。
--
-- **為什麼記進 `approval_step_log` 而不另開一張表**|「誰把誰拉進這一關」本身就是
-- 稽核要問的事實,而 log 已經是 append-only 且已串進 hash chain(0048)。
-- 另開一張可改的表存它,等於把最需要不可竄改的那一筆放在保護之外。
--
-- **為什麼只做「臨時加簽」**(Ragic 三種之中的同關加人)|另外兩種(向前 / 向後加簽)
-- 會在執行期**插入關卡**,而 ServiceNow 社群對此有明確警告:
--   「approvals aren't really designed to be added manually in this way」
--   —— 手動加的 approval 記錄不會正確反應 rejection。
-- 同關加人只是擴充該關的 N-of-M 成員集合,那個結構 0049 本來就要有,零額外狀態機風險。

ALTER TABLE "approval_step_log" DROP CONSTRAINT IF EXISTS "approval_step_log_decision";--> statement-breakpoint
ALTER TABLE "approval_step_log" ADD CONSTRAINT "approval_step_log_decision"
  CHECK (decision IN ('approve','reject','submit','withdraw','addApprover'));--> statement-breakpoint

-- 誰把這個人拉進來的。`decision = 'addApprover'` 時 `actor_id` 是**被加的人**,
-- 這一欄是**加人的人** —— 兩者分開存,否則事後看不出是誰決定擴大簽核圈。
ALTER TABLE "approval_step_log" ADD COLUMN IF NOT EXISTS "added_by_actor_id" bigint;--> statement-breakpoint

-- hash chain 的算式不含這一欄:0048 的 `approval_log_hash` 已固定其輸入,
-- 改算式會讓**所有既有列**的雜湊對不上、整條鏈判定為 tampered。
-- 新欄位的完整性由「它只在 INSERT 當下寫入、之後 no_mutate trigger 擋住 UPDATE」保證。
COMMENT ON COLUMN "approval_step_log"."added_by_actor_id" IS
  '臨時加簽的來源;不入 hash 算式(改算式會讓既有列全部判定為竄改)';
