-- 🔴 R1·I-1 M1|資料匯出的工作佇列(#145)。
--
-- ## 為什麼是一張表而不是 BullMQ(OQ-EX-1=A)
--
-- 全量匯出必須非同步(Salesforce / Google Takeout 皆然;綁在 HTTP 請求上必然逾時)。
-- 但本專案目前**沒有任何背景工作**,為單一功能引入 Redis 等於同時引入一整套新的
-- 失效模式與 dev/prod 的第二個服務。`export_job` 本身就是佇列:狀態欄 + 一支
-- `@nestjs/schedule` 輪詢 + advisory lock 就足夠。日後出現第二個長工作再升 BullMQ,
-- 屆時這張表可直接轉成 payload。
--
-- ## 為什麼過期不刪列
--
-- 「誰在什麼時候把整包公司資料帶走了」是內控要問的問題。到期清掉的是 **storage 物件**,
-- 列留下並標 `expired`。
--
-- ## 保存期限與下載次數(OQ-EX-2=A,照 Google Takeout)
--
-- 「Your archive expires in about 7 days.」「We only allow each archive to be
-- downloaded 5 times」。我方情境更接近它而非 Salesforce 的 48 小時 ——
-- 停權與 PDPA 請求都不保證有人當班盯著。

CREATE TABLE IF NOT EXISTS "export_job" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "requested_by_actor_id" bigint NOT NULL REFERENCES "users"("id"),
  /* queued → running → ready | failed;到期後 ready → expired */
  "status" text NOT NULL DEFAULT 'queued',
  /* NULL = 全部表單;非 NULL = 指定的表單 id(一律仍逐表過權,見 service) */
  "form_ids" bigint[],
  "include_attachments" boolean NOT NULL DEFAULT false,
  "object_key" text,
  "size_bytes" bigint,
  "row_count" bigint,
  "download_count" integer NOT NULL DEFAULT 0,
  /* 失敗原因給使用者看,故**不得放內部細節**(service 負責轉譯) */
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "ready_at" timestamptz,
  "expires_at" timestamptz,
  CONSTRAINT "export_job_status" CHECK (
    "status" IN ('queued', 'running', 'ready', 'failed', 'expired')
  )
);--> statement-breakpoint

/* worker 的查詢形狀:找最舊的 queued */
CREATE INDEX IF NOT EXISTS "export_job_queue_idx"
  ON "export_job" ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_job_tenant_idx"
  ON "export_job" ("tenant_id", "created_at" DESC);--> statement-breakpoint

/* 🔴 同一租戶**同時只允許一個進行中**(OQ-EX-8=A)。
   寫成部分唯一索引而非應用層檢查 —— 兩個請求同時進來時,應用層的
   「先查再寫」擋不住;這裡由 DB 保證。 */
CREATE UNIQUE INDEX IF NOT EXISTS "export_job_one_active_per_tenant"
  ON "export_job" ("tenant_id")
  WHERE "status" IN ('queued', 'running');--> statement-breakpoint

ALTER TABLE "export_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "export_job" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "export_job_tenant" ON "export_job"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

/* app 車道:建立與查詢自己的匯出。
   **不授 UPDATE / DELETE** —— 狀態推進與到期清理只由 worker(特權車道)做,
   使用者不得改自己那一列的 status / expires_at / download_count。 */
GRANT SELECT, INSERT ON public.export_job TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.export_job_id_seq TO weyver_app;
