-- R1·C-5 FMEA S1|漏跑要說得出來。
--
-- 🔴 問題:定時觸發的補跑**只在當天有效**(到期條件含 `dow` / `dom` 比對)。
-- 整個週一都停機的話,那一週的週報就跳過了 —— **而且是靜默的**。
--
-- 裁定:**不改行為,改成說得出來。**
-- 「週一該寄的週報在週二寄出」未必是使用者要的(遲到的報表可能比沒有更糟:
-- 收件人會以為那是週二的數字)。所以不補跑 —— 但**跳過這件事必須看得見**。
--
-- 這與本模組其他地方同一條原則:
-- 「靜默停止的自動化比不會動的自動化更難查,使用者只會說『它沒反應』。」
ALTER TABLE "trigger_run" DROP CONSTRAINT "trigger_run_outcome";--> statement-breakpoint
ALTER TABLE "trigger_run" ADD CONSTRAINT "trigger_run_outcome"
  CHECK (outcome IN ('ran','skipped','denied','failed','depth','missed'));
