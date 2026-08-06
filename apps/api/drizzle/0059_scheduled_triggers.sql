-- R1·C-5 M1|定時觸發 + 排程管理。
--
-- ## 兩件事,兩張 schema 變更
--
-- 1. `trigger_def` 加第三種時機(每日 / 每週 / 每月的指定時刻)—— C-4 的延伸
-- 2. `schedule_def` 讓租戶設定既有背景功能的執行時間 —— Ragic `doc/96` 的 parity
--
-- 🔴 時區是 `tenants.timezone`(已存在,預設 Asia/Taipei),**判斷一律在 PG 做**。
-- 應用層自己算時區的話,會與 `record.service` 既有的日期分組用兩套規則,
-- 而那正是「兩份鏡射必然漂移」。

ALTER TABLE "trigger_def" ADD COLUMN "on_schedule" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- daily / weekly / monthly。NULL = 不是定時觸發。
ALTER TABLE "trigger_def" ADD COLUMN "schedule_freq" text;--> statement-breakpoint

-- 租戶時區的 0–23 時。**最小粒度是小時**,對齊 Ragic 的「每天 19:00」語意 ——
-- 分鐘級排程會讓「馬上執行」與稽核都變得難解釋,而且沒有真實需求。
ALTER TABLE "trigger_def" ADD COLUMN "schedule_hour" integer;--> statement-breakpoint

-- weekly:0–6(0 = 週日,對齊 PG 的 `EXTRACT(dow)`)
-- monthly:1–28,**或 0 = 當月最後一天**
--   🔴 上限訂 28 而不是 31:2 月沒有 29–31 號,允許使用者選一個「有些月份不會發生」
--   的日期,是在賣一個會靜默漏跑的設定。要月底就選 0 —— 那是 ERP 月結的真實需求,
--   而 `date_trunc + interval` 算得出來,不必讓使用者自己去想 2 月幾號結束。
ALTER TABLE "trigger_def" ADD COLUMN "schedule_day" integer;--> statement-breakpoint

-- 🔴 上次跑的時刻。**漏跑補一次靠它**(OQ-SCH-5):
-- 比對的是「換算成租戶時區之後的日期」有沒有變,而不是「距上次幾小時」——
-- 後者在停機三天後會補跑 72 次,那是災難。
ALTER TABLE "trigger_def" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint

-- 既有的 `trigger_def_has_timing` 只認 on_create / on_update,加了第三種時機要一起放行。
ALTER TABLE "trigger_def" DROP CONSTRAINT "trigger_def_has_timing";--> statement-breakpoint
ALTER TABLE "trigger_def" ADD CONSTRAINT "trigger_def_has_timing"
  CHECK (on_create OR on_update OR on_schedule);--> statement-breakpoint

-- 🔴 定時觸發的欄位要嘛全有要嘛全無。少一個就是「設了但永遠不會跑」,
-- 而那種設定在畫面上看起來是正常的。
ALTER TABLE "trigger_def" ADD CONSTRAINT "trigger_def_schedule_shape" CHECK (
  (NOT on_schedule AND schedule_freq IS NULL AND schedule_hour IS NULL)
  OR (
    on_schedule
    AND schedule_freq IN ('daily','weekly','monthly')
    AND schedule_hour BETWEEN 0 AND 23
    AND (
      (schedule_freq = 'daily' AND schedule_day IS NULL)
      OR (schedule_freq = 'weekly' AND schedule_day BETWEEN 0 AND 6)
      OR (schedule_freq = 'monthly' AND schedule_day BETWEEN 0 AND 28)
    )
  )
);--> statement-breakpoint

CREATE INDEX "trigger_def_schedule_idx" ON "trigger_def"
  USING btree ("schedule_hour") WHERE on_schedule AND deleted_at IS NULL;--> statement-breakpoint

-- ## 排程管理(Ragic `doc/96` parity)
--
-- 官方逐字:「設定一項功能的排程會**套用到資料庫所有該功能的執行時間**」——
-- 故 key 是 (租戶, 功能),**不是逐筆設定**。
--
-- 🔴 只開放「租戶看得到後果」的功能(OQ-SCH-1)。
-- `event-fanout` / `webhook-delivery` / `trigger-async` **刻意不開** ——
-- 那是**投遞延遲**不是排程,開放只會讓人把它調慢然後抱怨系統慢。
-- `security.purgeAudit` / `scan` / `usage` 是平台維運,租戶不該能調。
CREATE TABLE "schedule_def" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedule_def_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"feature" text NOT NULL,
	"hour" integer NOT NULL,
	"last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_def_feature" CHECK (feature IN ('notification','trashPurge')),
	CONSTRAINT "schedule_def_hour" CHECK (hour BETWEEN 0 AND 23)
);
--> statement-breakpoint

ALTER TABLE "schedule_def" ADD CONSTRAINT "schedule_def_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_def_tenant_feature_uq" ON "schedule_def" USING btree ("tenant_id","feature");--> statement-breakpoint

ALTER TABLE "schedule_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_def" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "schedule_def_tenant" ON "schedule_def"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON public.schedule_def TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.schedule_def_id_seq TO weyver_app;
