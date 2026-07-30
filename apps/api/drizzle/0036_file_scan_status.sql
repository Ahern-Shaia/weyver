-- F-11 M2|掃描狀態 + 下載閘。
--
-- 🔴 刻意不複用既有的 status 欄:那是 pending|bound|orphaned 的生命週期語意,
-- 與掃描結果正交。共用會出現「pending 到底是還沒綁記錄還是還沒掃完」這種
-- 永遠講不清的狀態。
--
-- 既有檔案回填為 'skipped' 而非 'clean':它們是掃毒上線前上傳的,
-- 我們沒掃過,不該宣稱乾淨。標 skipped 才是誠實的,也讓日後想回頭補掃時
-- 找得出哪些沒掃過。
ALTER TABLE "file_object" ADD COLUMN "scan_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "scan_engine" text;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "scan_sig_version" text;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "scan_detail" text;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "scan_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "scan_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "sha256" text;--> statement-breakpoint
UPDATE "file_object" SET "scan_status" = 'skipped';--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_scan_status"
  CHECK (scan_status IN ('pending','clean','infected','error','skipped'));--> statement-breakpoint
CREATE INDEX "file_object_scan_due_idx" ON "file_object" USING btree ("scan_status","scan_next_attempt_at") WHERE scan_status IN ('pending','error');
