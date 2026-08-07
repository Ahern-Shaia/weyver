-- R1·TPL M7|區分「再裝一份」與「更新」。
--
-- M6 刻意不設 (tenant, key) 唯一,因為「同一個範本再套一份」是合法意圖
-- (不同部門 / 不同年度)。但那讓兩種不同的事件長得一樣:
--
--   · 裝第二份  → 使用者現在有 **兩套** 表
--   · 更新      → 使用者還是 **一套** 表,只是升了版
--
-- 少了這一欄,UI 分不出「你有 2 份請購申請」和「你更新過一次」。

ALTER TABLE "template_installs" ADD COLUMN "kind" text DEFAULT 'install' NOT NULL;--> statement-breakpoint
ALTER TABLE "template_installs" ADD CONSTRAINT "template_installs_kind"
	CHECK ("kind" IN ('install', 'update'));--> statement-breakpoint

-- 這一列更新的是哪一次安裝。install 為 NULL。
-- 有了它,「這套表的完整沿革」是一條鏈而不是一堆同 key 的列。
ALTER TABLE "template_installs" ADD COLUMN "supersedes_install_id" bigint;--> statement-breakpoint
ALTER TABLE "template_installs" ADD CONSTRAINT "template_installs_supersedes_fk"
	FOREIGN KEY ("supersedes_install_id") REFERENCES "public"."template_installs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- 🔴 欄位級 GRANT:M6 給的是整表 INSERT,新欄自動涵蓋(INSERT 是表級)。
-- 但 template_installs 沒有 UPDATE 權,所以這兩欄只能在插入時決定 —— 那正是我們要的。
