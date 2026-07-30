-- H-2 M1|回收桶索引表。
-- 現況盤查:9 類實體都有 deleted_at,但(a) 沒有還原入口 (b) 程式註解所稱的
-- 「清理 job 之後收」那個 job 不存在 → 刪掉的東西既拿不回來、也沒真的刪。
-- 本表補 (a);(b) 由 TrashPurgeService 直接掃 deleted_at 補(刻意不依賴本表)。
CREATE TABLE "trash_entry" (
	"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" bigint NOT NULL,
	"form_id" bigint,
	"title" text NOT NULL,
	"related_ids" bigint[] DEFAULT '{}' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_by" bigint,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'trashed' NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "trash_entry_pkey" PRIMARY KEY("id"),
	CONSTRAINT "trash_entry_type" CHECK (resource_type IN ('record','form','field')),
	CONSTRAINT "trash_entry_state" CHECK (state IN ('trashed','restored','purged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trash_entry_active_uq" ON "trash_entry" USING btree ("tenant_id","resource_type","resource_id") WHERE state = 'trashed';--> statement-breakpoint
CREATE INDEX "trash_entry_list_idx" ON "trash_entry" USING btree ("tenant_id","state","deleted_at");--> statement-breakpoint
CREATE INDEX "trash_entry_purge_idx" ON "trash_entry" USING btree ("purge_after") WHERE state = 'trashed';--> statement-breakpoint
ALTER TABLE "trash_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trash_entry" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "trash_entry"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.trash_entry TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.trash_entry_id_seq TO weyver_app;
