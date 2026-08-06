-- R1·C-4 M1|事件觸發器。
--
-- 🔴 為什麼是新表而不是掛在 `conditionalFormats` 底下:
-- 條件式格式是「顯示時、每次算、無副作用」,觸發器是「存檔時、算一次、有副作用」。
-- 塞進同一張規則清單的後果是使用者改一條顏色規則時會**發動作** —— 那是類別錯誤。
-- 條件的**型別**仍與條件式格式共用(`@weyver/rules`),共用的是判斷不是容器。

CREATE TABLE "trigger_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trigger_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"name" text NOT NULL,
	-- 觸發時機。刪除時**刻意不做**(記錄已軟刪,動作要改的東西不在了)。
	"on_create" boolean DEFAULT false NOT NULL,
	"on_update" boolean DEFAULT false NOT NULL,
	-- 🔴 「更新時」限定某些欄位變更才算。空 = 任何更新。
	-- 只給「任何更新」的話,「金額改變時重算」會被迫每次存檔都跑一遍,
	-- 而條件語言寫不出「跟上次比」。前後值 `record_revision` 已經存了(H-4)。
	"watch_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	-- 條件:`@weyver/rules` 的 FormatCondition[],與條件式格式同一份判斷
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	-- 🔴 `openUrl` 不在此列:沒有人在場,沒有瀏覽器可以開。
	-- 動作型別的白名單與 `button_def` 是**兩份**,因為兩者允許的集合本來就不同 ——
	-- 共用一個 CHECK 會讓「觸發器不能開網址」這條規則沒有地方寫。
	CONSTRAINT "trigger_def_action_type" CHECK (action_type IN ('updateSelf','pushTo')),
	-- 兩個時機都沒勾的觸發器永遠不會跑,那是設定錯誤不是有效狀態
	CONSTRAINT "trigger_def_has_timing" CHECK (on_create OR on_update)
);
--> statement-breakpoint

CREATE TABLE "trigger_run" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trigger_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"trigger_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	"record_id" bigint NOT NULL,
	"actor_id" bigint,
	-- ran(跑了) / skipped(條件不符) / denied(權限不足) / failed(執行錯) / depth(連鎖過深)
	"outcome" text NOT NULL,
	-- 🔴 `denied` 與 `depth` 一定要留得下來。
	-- 靜默停止的自動化比不會動的自動化更難查 —— 使用者只會說「它沒反應」。
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trigger_run_outcome" CHECK (outcome IN ('ran','skipped','denied','failed','depth'))
);
--> statement-breakpoint

ALTER TABLE "trigger_def" ADD CONSTRAINT "trigger_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_def" ADD CONSTRAINT "trigger_def_form_id_form_def_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_run" ADD CONSTRAINT "trigger_run_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_run" ADD CONSTRAINT "trigger_run_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."trigger_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "trigger_def_tenant_form_idx" ON "trigger_def" USING btree ("tenant_id","form_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "trigger_run_lookup_idx" ON "trigger_run" USING btree ("tenant_id","trigger_id","created_at" DESC);--> statement-breakpoint

ALTER TABLE "trigger_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trigger_def" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "trigger_def_tenant" ON "trigger_def"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

ALTER TABLE "trigger_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trigger_run" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "trigger_run_tenant" ON "trigger_run"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trigger_def TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.trigger_def_id_seq TO weyver_app;--> statement-breakpoint

-- 🔴 執行紀錄**只能新增不能改**,與 `action_audit` / `record_revision` 同一條理由:
-- 「這條觸發器當時做了什麼」若可竄改,稽核就不成立。不授 UPDATE / DELETE。
GRANT SELECT, INSERT ON public.trigger_run TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.trigger_run_id_seq TO weyver_app;
