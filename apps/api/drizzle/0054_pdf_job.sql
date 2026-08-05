-- 🔴 R1·後續-2b M1|伺服器端 PDF(`docs/modules/R1/server-pdf.md`)。
--
-- 現況只有 `window.print()` —— 人站在電腦前可以印,但**產不出一個檔案**:
-- 寄一份採購單給供應商、把出貨單存回附件欄、一次匯 500 張合成一份,三件都做不到。
--
-- 佇列與狀態沿用 `export_job`(0046)的形狀:**狀態欄就是佇列**,
-- 一支 `@Interval` worker 以 `FOR UPDATE SKIP LOCKED` 取件。
-- 不為第二個功能引入 Redis —— 那等於同時引入一整套新的失效模式。
--
-- 🔴 **`ticket_hash` 是本表最需要解釋的一欄**(OQ-PDF-6)。
-- 渲染器是一個沒有身分的瀏覽器,而 PDF **必須以請求者的權限產生**
-- (否則沒有薪資欄權限的人印一張 PDF 就拿到薪資)。
-- 作法:worker 撿件時發一張**一次性、短效**的渲染票,渲染器拿它換資料;
-- 換資料時後端以**該工作的 actor** 的有效權限去讀,遮罩走既有的同一條路,
-- 不另寫一份權限判斷。
-- **票只存雜湊**,與 API 金鑰同一個道理:資料庫外洩時票不能被直接使用。

CREATE TABLE "pdf_job" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pdf_job_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"requested_by_actor_id" bigint NOT NULL,
	"form_id" bigint NOT NULL,
	-- 一或多筆。多筆合併成一份 PDF(Ragic 亦然:合併成一份只支援 PDF/XLSX/PPTX)
	"record_ids" bigint[] NOT NULL,
	"status" text NOT NULL DEFAULT 'queued',
	"object_key" text,
	"size_bytes" bigint,
	-- 一次性渲染票:**只存雜湊**,而且**只在 worker 撿件的那一刻才寫進來**。
	-- 建立工作時不發票 —— 票只在真的要渲染的那幾秒內存在,
	-- 而且明文永遠只在 worker 行程裡,不經過 API 回應、不經過使用者。
	"ticket_hash" text,
	"ticket_used_at" timestamp with time zone,
	"download_count" integer DEFAULT 0 NOT NULL,
	-- 給使用者看的訊息 —— 不得放 SQL / 路徑 / 堆疊
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "pdf_job_status" CHECK (
		"status" IN ('queued', 'running', 'ready', 'failed', 'expired')
	),
	-- 一次的量要有上限,否則一個請求可以叫渲染器跑到天亮
	CONSTRAINT "pdf_job_record_count" CHECK (
		array_length("record_ids", 1) BETWEEN 1 AND 200
	)
);--> statement-breakpoint

CREATE INDEX "pdf_job_tenant_idx" ON "pdf_job" ("tenant_id", "created_at" DESC);--> statement-breakpoint
-- worker 撿件:只掃 queued
CREATE INDEX "pdf_job_queue_idx" ON "pdf_job" ("status", "id") WHERE "status" = 'queued';--> statement-breakpoint
-- 票查詢(渲染器換資料)
CREATE UNIQUE INDEX "pdf_job_ticket_idx" ON "pdf_job" ("ticket_hash");--> statement-breakpoint

ALTER TABLE "pdf_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pdf_job" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "pdf_job_tenant" ON "pdf_job"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

-- app 車道只能建立與查詢自己的。狀態推進、票的核銷、到期清理都是 worker 的事,
-- 走特權車道 —— 與 `export_job` 同一個切法(使用者不該能把自己的工作改成 ready)。
GRANT SELECT, INSERT ON public.pdf_job TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.pdf_job_id_seq TO weyver_app;
