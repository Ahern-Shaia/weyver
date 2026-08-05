-- 🔴 R1·H-4 v1.2|批次還原(`docs/modules/R1/record-revisions.md` §7)。
--
-- Ragic 官方 `doc/81` 逐字:「如果想要復原大量修改或是匯入的資料,可以點擊
-- 該筆修改或匯入紀錄旁的還原符號來復原修改前的資料。」
--
-- 每列的前後值 v1.0 就已經在 `record_revision` 裡了 —— 缺的只是
-- 「這些列屬於同一次操作」。這張表就是那個 id。
--
-- 🔴 **為什麼另立一張表而不是在 record_revision 加個 batch_id 就好**(OQ-RV-8):
-- 「這批被還原過了」是**可寫一次的狀態**。掛在 N 列修改紀錄上等於同一事實存 N 份;
-- 而修改紀錄是**只增不改**(v1.0 的鐵則,同傳票不可竄改),為了記還原狀態去開
-- UPDATE 權限會把那個保證整個毀掉。這裡只開兩個欄的欄位級 UPDATE。

CREATE TABLE "record_batch" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "record_batch_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	-- import(匯入)| paste(貼上批次更新)| undo(還原本身)
	-- 🔴 `undo` 不得再被還原(OQ-RV-12):匯入的還原是軟刪,再還原它就變成
	-- 「從回收桶救回來」,那是另一條路徑。要救回來就去回收桶,那裡本來就有。
	"kind" text NOT NULL,
	"actor_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" bigint
);--> statement-breakpoint

CREATE INDEX "record_batch_recent_idx"
  ON "record_batch" ("tenant_id", "created_at" DESC);--> statement-breakpoint

ALTER TABLE "record_revision"
  ADD COLUMN "batch_id" bigint REFERENCES "record_batch"("id");--> statement-breakpoint
-- 部分索引:絕大多數修改紀錄不屬於任何批次
CREATE INDEX "record_revision_batch_idx"
  ON "record_revision" ("batch_id") WHERE "batch_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "record_batch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_batch" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "record_batch_tenant" ON "record_batch"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

-- 🔴 欄位級 UPDATE:只有「還原過了」這兩個欄位可寫。
-- 批次的其餘欄位與修改紀錄同樣不可竄改。
GRANT SELECT, INSERT ON public.record_batch TO weyver_app;--> statement-breakpoint
GRANT UPDATE ("undone_at", "undone_by") ON public.record_batch TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.record_batch_id_seq TO weyver_app;
