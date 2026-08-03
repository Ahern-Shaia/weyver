-- 🔴 F-2 M4|小圖表(widget)。可釘在列表頁 / 表單頁的小型圖表。
--
-- **採 Ragic 形態**(doc/122):widget 帶自身篩選 + **可見群組**,
-- 且可見群組為 **widget 級 all-or-nothing**(OQ-PC-9)—— 不做部分聚合遮蔽。
-- 理由:部分遮蔽會讓聚合值本身變成推論管道(遮掉一格但總和還在,就能反推那一格)。
--
-- ⚠️ **`visible_role_ids` 不是提權路徑**(OQ-PC-12 = A):候選清單由 service 先以
-- **來源表單權限**過濾,選不到一個對來源表單沒權限的角色。
-- Ragic 官方逐字:「可檢視群組會列出對來源表單具有表單權限的群組」
-- 「若未設定,報表將依來源表單的權限顯示」——
-- 空陣列即「依來源表單權限」,不是「所有人可見」。

CREATE TABLE IF NOT EXISTS "widget_def" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "form_id" bigint NOT NULL REFERENCES "form_def"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  /* bar | line | pie —— 與 chart-view 同一組,不另立型別 */
  "chart_type" text NOT NULL DEFAULT 'bar',
  /* 分組維度(欄位顯示名)。空 = 尚未設定,前端不渲染 */
  "dimension" text NOT NULL,
  /* 聚合:NULL = 計數(count);否則 {fn, field} */
  "measure_fn" text,
  "measure_field" text,
  /* widget 自身的篩選(RecordQuery 的 filters 子集)。
     🔴 列表頁的優先序是「固定篩選 > 使用者篩選 > **本欄**」(OQ-PC-10 = A)——
     本欄是**最低**優先,不是唯一來源。表單頁 / 首頁沒有中間那層。 */
  "own_filter" jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* 釘在哪:list | form */
  "placement" text NOT NULL DEFAULT 'list',
  "position" integer NOT NULL DEFAULT 0,
  /* 空 = 依來源表單權限(Ragic 語意),非「所有人可見」 */
  "visible_role_ids" bigint[] NOT NULL DEFAULT ARRAY[]::bigint[],
  "created_by" bigint REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "widget_def_chart_type" CHECK ("chart_type" IN ('bar', 'line', 'pie')),
  CONSTRAINT "widget_def_placement" CHECK ("placement" IN ('list', 'form')),
  /* 聚合欄與函式要嘛都有要嘛都沒有 —— 只有一個時語意不明,
     而不明的聚合會被下游各自猜成不同的東西 */
  CONSTRAINT "widget_def_measure_pair" CHECK (
    ("measure_fn" IS NULL) = ("measure_field" IS NULL)
  )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "widget_def_form_idx"
  ON "widget_def" ("tenant_id", "form_id", "placement", "position")
  WHERE "deleted_at" IS NULL;--> statement-breakpoint

ALTER TABLE "widget_def" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "widget_def" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "widget_def_tenant" ON "widget_def"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.widget_def TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.widget_def_id_seq TO weyver_app;
