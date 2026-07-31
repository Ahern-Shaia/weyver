-- 🔴 R1·H-3 M1|跨表全文搜尋之集中式索引表。
--
-- ## 為什麼是「集中一張表」而非「逐欄 tsvector」
--
-- Baserow 官方 issue #3642 第一手承認逐欄做法失敗:「doubles the number of columns」、
-- 「已撞到 PostgreSQL 的 column limit of 1600」、Celery 同步「proven fragile」、
-- 「increases the likelihood of deadlocks」、「can become out of sync」。
-- 動態 schema(使用者自建表、欄位隨時增減)下逐欄索引是死路,已有人替我們撞過。
--
-- 集中式的額外好處:跨表搜尋是**對單一表查詢**,無 UNION fan-out,表增減不動 DDL。
--
-- ## 為什麼是 pg_bigm 而非 pg_trgm / to_tsvector
--
-- 本機 200K 筆繁中實測(見 docs/modules/R1/full-text-search.md §0.1):
--   · to_tsvector('simple') 把整串中文當**單一 token** —— 搜「食品」搜不到
--     「大成食品股份有限公司」,只有完整字串才命中(那是等值比對不是搜尋)
--   · pg_trgm 有 **3 字門檻**:2 字查詢(食品/鋼板/螺栓 —— 中文最常見的長度)
--     湊不出完整 trigram → 退回全表掃描 ~50ms
--   · pg_bigm:同樣查詢 **4.6ms 且 planner 自選索引**
-- Cloud SQL 官方支援 pg_bigm(需 flag `cloudsql.enable_pg_bigm`),
-- 而 pgroonga / zhparser / pg_jieba / pg_cjk_parser **皆不在支援清單**。

CREATE EXTENSION IF NOT EXISTS pg_bigm;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "search_doc" (
  "tenant_id" bigint NOT NULL,
  "form_id" bigint NOT NULL,
  "record_id" bigint NOT NULL,
  "field_id" bigint NOT NULL,
  -- 欄位顯示名快照:搜尋結果要說得出「命中哪一欄」,而 field_def 可能已改名
  "field_name" text NOT NULL,
  "value_text" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "search_doc_pk" PRIMARY KEY ("tenant_id", "form_id", "record_id", "field_id")
);--> statement-breakpoint

-- 繁中主索引:1–2 字查詢即可走索引(bigram 的 2-gram 特性)
CREATE INDEX IF NOT EXISTS "search_doc_value_bigm"
  ON "search_doc" USING gin ("value_text" gin_bigm_ops);--> statement-breakpoint

-- 英數料號(如 CHO331344-GERMANY)走 trigram —— pg_bigm 官方明載 1.1+ 可與 pg_trgm 共存
CREATE INDEX IF NOT EXISTS "search_doc_value_trgm"
  ON "search_doc" USING gin ("value_text" gin_trgm_ops);--> statement-breakpoint

-- 權限 pre-filter 與結果彙總用
CREATE INDEX IF NOT EXISTS "search_doc_scope_idx"
  ON "search_doc" ("tenant_id", "form_id", "record_id");--> statement-breakpoint

-- 🔴 S1(P0)|租戶隔離沿用既有機制 —— 這正是「不上外部搜尋引擎」的核心理由:
-- 外部引擎會讓 RLS 失效,把已驗證的 DB 層防線換成「應用層記得簽對 token」。
ALTER TABLE "search_doc" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_doc" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "search_doc"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

-- app 車道需完整 DML:索引與記錄寫入在**同一個交易**內(OQ-FTS-3=A)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_doc TO weyver_app;--> statement-breakpoint
