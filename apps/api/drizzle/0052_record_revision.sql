-- 🔴 R1·H-4|記錄修改紀錄(`docs/modules/R1/record-revisions.md`)。
--
-- Ragic 使用者每天在看的「這筆單子被誰改了什麼」。我方原本只有 `updated_by` /
-- `updated_at` —— 知道誰、何時,**不知道改了哪一欄、從什麼變成什麼**。
--
-- **只存差異不存快照**(OQ-RV-2):Ragic 官方 `doc/81` 逐字「列出該筆資料
-- **詳細的修改內容**」就是差異視圖。代價是不能直接還原到某個版本 ——
-- 而 Ragic 本來就**不給單筆還原**(官方明文只給大量修改與匯入),代價與 parity 對齊。
--
-- 🔴 **與 `ddl_audit` / `action_audit` 不同,這張表開 RLS**:
-- 那兩張存的是「誰做了什麼動作」,這張存的是**欄位值本身**。
-- 值就該受租戶隔離的硬執法,而不是只靠 app 層記得帶 `tenant_id`(鐵則 3)。

CREATE TABLE "record_revision" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "record_revision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"record_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"actor_id" bigint,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- 單筆檢視:最新的在前
CREATE INDEX "record_revision_record_idx"
  ON "record_revision" ("tenant_id", "form_id", "record_id", "id" DESC);--> statement-breakpoint
-- P1 的全庫「資料修改紀錄」頁 —— 結構先留好,免得日後要在大表上加索引
CREATE INDEX "record_revision_recent_idx"
  ON "record_revision" ("tenant_id", "created_at" DESC);--> statement-breakpoint

ALTER TABLE "record_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_revision" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "record_revision_tenant" ON "record_revision"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

-- **只增不改**:app 車道沒有 UPDATE / DELETE。
-- 修改紀錄能被改就不是修改紀錄了(同傳票不可竄改的鐵則)。
-- 保留期清理屬維運動作,走特權車道(P1)。
GRANT SELECT, INSERT ON public.record_revision TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.record_revision_id_seq TO weyver_app;
