-- R1·C-4 v1.1|觸發器的「草稿 / 已發布」分離。
--
-- 🔴 為什麼要有這個東西(2026-08-06 站三補查發現)
--
-- Teable 官方逐字:「Changes are saved as a draft. **The live workflow keeps running
-- on the previous version until you click Apply Update.**」
--
-- 而我方原本是**改了立刻生效** —— 設計者改到一半的觸發器,當下就在對真實資料動作。
-- 一條「金額 > 10000 → 待審」改到剩「金額 >」的瞬間,條件是壞的而它照跑。
--
-- ## 哪些欄位進草稿,哪些必須即時
--
-- **定義**(時機 / 監看欄 / 條件 / 動作)進草稿:那是會算錯的部分。
-- **`enabled` 不進草稿** —— 它是 kill switch。發現觸發器在亂跑的時候,
-- 「先按停用、再按發布才會停」是不可接受的。停用與啟用都即時生效。
-- `position` 同理(只影響順序,不會算錯),留在即時欄。

ALTER TABLE "trigger_def" ADD COLUMN "published" jsonb;--> statement-breakpoint

-- 🔴 既有列必須回填,否則這個 migration 會**靜默停掉所有既有觸發器**
-- (runtime 改讀 `published`,而它是 NULL)。
-- 這正是「加一個欄位卻改變了既有行為」的形態 —— 純加法不等於零回歸。
UPDATE "trigger_def" SET "published" = jsonb_build_object(
  'onCreate', on_create,
  'onUpdate', on_update,
  'watchFields', watch_fields,
  'conditions', conditions,
  'actionType', action_type,
  'config', config
) WHERE "published" IS NULL AND deleted_at IS NULL;--> statement-breakpoint

-- runtime 只撈發布過的。部分索引把成本壓在真的會跑的那幾列上。
CREATE INDEX "trigger_def_published_idx" ON "trigger_def"
  USING btree ("tenant_id", "form_id") WHERE published IS NOT NULL AND deleted_at IS NULL;
