# views-list.md — [R1·UP-2] 視圖系統 + 集合(browse)視圖設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-25;M1–M5 全綠;api 220 + web 12 e2e 過)**
> **裁定摘要**|1=A 單層 AND\|OR · 2=A **forcedFilter 移出 view 歸 authz 軸(修正 docs/27 §3)** · 3=A Glide 可編輯 grid · 4=A lazy 預設檢視 · 5=A 伺服器端 ILIKE textual · 6=A client-side 匯出上限 · 7=A 列表為進表預設。
> **落地**|M0 `570c81a` · M1 後端 `f986477`(view_def 0009 + CRUD + records combinator/搜尋)· M2 `3300561`(集合視圖 + 雙模式)· M3 `9ccda81`(facet 篩選 + 排序 + 儲存檢視)· M4 `9c7cdba`(批次刪除 + 匯出)· M5 `ad2a4c2`(views.spec 固化)。
>
> docs/27 §6 順序 2(承 workspace-ia SHIPPED)。落地 D2 裁定「Ragic 語意、Airtable 骨架」的視圖模型:每張表恆有**集合(browse)視圖**(Glide 網格,套 view 的選欄/篩選/排序),與既有 Object Page 記錄頁並列**雙模式**;其上以 `view_def` 持久層支援**儲存檢視三態**(個人/共通/預設)+ facet 篩選 + 多鍵排序 + 快速搜尋 + 批次 + 匯出。直接補「單日常使用面」缺口(集合檢視是 Ragic 客戶每天第一眼的畫面)。
>
> **本 M0 提出一個對 docs/27 §3 的證據驅動修正**(OQ-VL-2):§3 P0 將 `forcedFilter`(固定/強制篩選)列為 `view_def` 屬性軸之一;競品研究顯示這是 row-level security,不應做進可移除的 view filter —— 建議移出 view、歸 authz 軸。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-25)
> 證據:docs/27 §3(D2 裁定 + P0/P1/P2 分級)、本地競品參照庫(Ragic doc/19·doc/38·doc-user/4·15·16、Airtable views/filter/shared-view-url-filters、Teable view/authority-matrix、Baserow filter-group)、現況盤點(records API filter/sort/cursor 白名單鏈、field-type-registry operator、maskRead 伺服器端強制、record-grid-panel Glide 可複用)

---

## 1. 目標與範圍

### 1.1 目標

1. **集合(browse)視圖**|每張表恆有一個網格檢視(複用 `record-grid-panel` 的 Glide Data Grid):欄=view 選欄、套 view 的篩選/排序;可 inline 編輯(依欄位寫入權限)。與 Object Page 記錄頁並列**雙模式**(列表 ↔ 記錄),列表為進表預設(Ragic 心智:開表先看列表頁)。
2. **`view_def` 持久層 + 儲存檢視三態**|個人(私有)/ 共通(租戶共享,設計者/admin 建)/ 預設(進表自動套用);承 record-workbench-ui A1、docs/27 §3 P0。
3. **facet 篩選 + 多鍵排序 + 快速搜尋 + 分頁**|左側 facet rail(欄型別感知 operator,承 `field-type-registry`)、標頭多鍵排序、關鍵字快速搜尋(ILIKE)、cursor 分頁(既有)。
4. **批次 + 匯出**|勾選 + 批次刪除;當前視圖結果匯出 CSV/Excel(view-scoped:套篩選/排序/選欄)。
5. **誠實邊界**|強制/固定篩選作為列級安全**不做進 view**(歸 authz 軸,OQ-VL-2);inline 編輯依既有 `assertWritable`(伺服器端強制);view 選欄純表現層(`maskRead` 已是後端硬底,D4)。

### 1.2 對應訴求

| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| 視圖系統 + 集合視圖 | Ragic 客戶遷移零學習之「列表頁 + 儲存篩選」日常使用面 | docs/27 D2 + §3 P0;docs/25 F「列表視圖」4+1 人月;「單薄」反饋之日常使用面解(每天第一眼) |

### 1.3 不做的事

- ❌ **固定/強制篩選作列級安全(forcedFilter as RLS)**|移出 `view_def`,歸 P0-4 authz 軸(role/tenant-bound、伺服器端不可繞)。證據:Airtable 明文「view filter 不是安全邊界、使用者可移除、不得用於隱藏私密資料」;Teable 走 Authority Matrix(角色權限)非 view 屬性;Ragic 雖有 固定篩選 但另有獨立 RLS(doc/54 資料指派)。半成品 RLS = 洩漏面(OQ-VL-2)。
- ❌ **巢狀 filter groups**|Airtable/Teable 皆 3 層巢狀;P0 只做**單層 combinator(AND|OR over flat conditions)**,groups → P1(OQ-VL-1)。
- ❌ **Kanban / Calendar / Gallery / Timeline 檢視**|docs/27 §3 P1/P2。
- ❌ **分組小計 / summary bar / 標頭加總、凍結欄、星號、row coloring / row height**|docs/27 §3 P1/P2。
- ❌ **伺服器端串流 / 非同步大量匯出 email、>1000 筆 preview 策略**|P1;P0 = client-side 當前視圖上限匯出(OQ-VL-6)。
- ❌ **個人模式 overlay + Exit-and-sync(Teable 特色)、檢視分享連結、URL 篩選參數**|P2。
- ❌ **分組(group by)呈現**|P1(§3 P1);P0 只做扁平清單。

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| records list API | ✅ `GET /forms/:id/records`(cursor 分頁)+ `POST .../records/query`(filters flat max20 / sort max5);field 名 → catalog 白名單(`resolved.byName.get`→`UnknownFieldError`),物理欄 `f{id}` 從不直拼 | **無快速搜尋、無 combinator(現隱含 AND)、無 OR** |
| operator registry | ✅ `field-type-registry` 每型別 `filterOperators`(eq/neq/contains/gt/gte/lt/lte/anyOf/isEmpty/isNotEmpty)| 前端未有 facet 對映 UI |
| 欄位級遮罩(D4)| ✅ `maskRead` 伺服器端刪 hidden 欄(P0-4a);`assertWritable` 擋越權寫 | 無 —— view 選欄天然只能是表現層(後端已剝除),floor 已在 |
| 集合網格 UI | ✅ `record-grid-panel`(Glide)於 builder;`useInfiniteRecords` cursor;inline cell edit | **末在 end-user forms 頁作為 browse view**;未套 view 的選欄/篩選/排序 |
| 雙模式(列表↔記錄)| ❌ `forms/[formId]/page.tsx` 目前只有 Object Page(master-detail rail) | 全新:加 mode 切換 + collection 落地為預設 |
| `view_def` 持久層 | ❌ 無 | 全新表(migration 0009)+ CRUD API |
| 匯出 | ❌ 無 CSV/Excel 匯出;`xlsx` lib 已在(import 用) | 全新(client-side 可複用 xlsx) |
| 批次刪除 | ✅ DELETE 記錄 API(soft delete) | 批次勾選 UI + 迴圈/批次端點 |
| metadata migration | ✅ 最高 `0008_resource_inheritance` | `view_def` = `0009` |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端** | `view_def` 表(migration 0009)+ CRUD API(TenantGuard;個人/共通/預設;`is_default` 唯一約束)+ records query 擴充:單層 `combinator(and|or)` + 快速搜尋 `q`(ILIKE 跨 textual 欄,catalog 白名單)+ integration 測(跨租戶隔離 / combinator / search / 權限)| 0.10 mo |
| **M2 前端(集合視圖 + 雙模式)** | `forms/[formId]` 加 mode 切換(列表 collection ↔ 記錄 Object Page);集合視圖複用 Glide grid,欄=view.fields∩readable,套 filter/sort;inline edit → PATCH(權限 gate);點列 → 記錄頁 | 0.08 mo |
| **M3 前端(facet + 排序 + 儲存檢視)** | 左 facet 篩選 rail(型別感知 operator)+ 標頭多鍵排序 + 儲存檢視三態 UI(個人/共通/設預設 + 切換 + 重新命名/刪除,locked config-lock)| 0.10 mo |
| **M4 前端(批次 + 匯出)** | 勾選 + 批次刪除(確認)+ 匯出 CSV/Excel(當前視圖,client-side,上限 ~5000 + 誠實訊息)| 0.06 mo |
| **M5 固化 + FMEA** | Playwright spec(建 view→篩選→排序→存個人檢視→設預設→批次刪→匯出→雙模式切換)+ §12;doc v1.0 + MODULES ✅ | 0.03 mo |

**合計 ≈ 0.37 mo**(對應 docs/25 F「列表視圖」4+1 人月之 P0 首期落地)。M1 後端 / M2–M5 前端**分開 commit**([[feedback_separate_frontend_backend]])。

---

## 4. 設計要點

### 4.1 `view_def` 資料模型(M1)

```
view_def(
  id            bigint identity,
  tenant_id     bigint NOT NULL → tenants,
  form_id       bigint NOT NULL → form_def,
  name          text   NOT NULL,
  scope         text   NOT NULL,   -- 'personal' | 'shared'
  is_default    boolean NOT NULL DEFAULT false,  -- 進表自動套用(僅 shared 可為 default)
  locked        boolean NOT NULL DEFAULT false,  -- config-lock(admin;非安全邊界,Airtable 模型)
  config        jsonb  NOT NULL,   -- { fields:[fieldId], filter:{combinator,conditions[]}, sorts:[{field,dir}], search?:string, pageSize? }
  position      integer NOT NULL,
  created_by    bigint → users,
  created_at/updated_at/deleted_at,
  UNIQUE(tenant_id, form_id, name) WHERE deleted_at IS NULL
)
-- 每 (tenant,form) 至多一筆 is_default=true(部分唯一索引)
```

- **不含 `forced_filter`**(OQ-VL-2 裁定後定;§1.3、§7-bis)。`config.filter` 走既有白名單 filter 鏈,值參數綁定。
- `scope='personal'` → 僅 `created_by` 可見/用;`scope='shared'` → 租戶內可見(建立限 admin/設計者)。`is_default` 僅 `shared` 可設。

### 4.2 records query 擴充(M1)

- `listQuerySchema` 由 `filters:[]`(隱含 AND)擴為 `filter:{ combinator:'and'|'or', conditions:[{field,op,value}] }`(**單層**,OQ-VL-1);向後相容:舊 `filters` 陣列視為 `{combinator:'and',conditions}`。
- 新增 `q?:string` 快速搜尋:對**textual 型別欄**(catalog 白名單解析出的物理欄)`ILIKE %q%` OR 串接;值參數綁定;`statement_timeout` + 既有 row limit 兜底(OQ-VL-5)。
- 維持 cursor keyset 分頁(既有);排序多鍵(sort max5 既有,前端接多鍵 UI)。

### 4.3 集合(browse)視圖 grid(M2)

- 複用 `record-grid-panel`(Glide);抽為 end-user 可用元件。欄 = `view.config.fields ∩ readable`(後端 `maskRead` 已剝 hidden → view 只能收窄不能擴,D4 floor)。
- 套用 `view.config.filter/sorts/search` 呼 `POST .../records/query`;`useInfiniteRecords` cursor 續抓。
- **inline 編輯**(OQ-VL-3):cell 編輯 → PATCH 該筆;欄位寫入權限由後端 `assertWritable` 強制(唯讀欄 grid 顯示不可編)。**編輯後不即時 re-sort/re-filter**(edited row 留位至下次 refetch;對齊 Airtable 可接受 UX,避免游標分頁 + 即時重排的複雜度)。

### 4.4 雙模式(列表 ↔ 記錄)(M2)

- `forms/[formId]/page.tsx` 加 `mode`(nuqs URL:`?view=list|record`);**預設 list**(OQ-VL-7:Ragic 開表先列表頁;Airtable/Teable 皆 grid-first)。
- list = 集合視圖(§4.3);record = 既有 Object Page(master-detail)。點集合列 → 導 `?view=record&rid=<id>`(記錄頁 rail 選中該筆)。

### 4.5 儲存檢視三態(M3)

- 屬性軸 = `scope × is_default × locked`(**去掉 forcedFilter**,OQ-VL-2)。
  - **個人**|`scope=personal`,私有(僅建立者)。所有登入者可建。
  - **共通**|`scope=shared`,租戶可見;建立限 admin/設計者;可設 `is_default`;`locked=true` 時非 admin 不可改其組態(Airtable「locked view」語意 —— 僅鎖組態編輯,**非**列級安全)。
  - **預設檢視 lazy**|無 `is_default` row 時,前端計算預設 =(全 readable 欄、field 序、無 filter);設計者客製並「設為預設」→ 落 `shared+is_default` row。零回歸(對齊 [[workspace-ia]] lazy pattern)。
- UI:視圖切換下拉(當前 view 名 + 個人/共通分組)+ 另存新檢視 + 重新命名/刪除(自己的個人 view 或 admin 對共通)+「設為預設」。

### 4.6 批次 + 匯出(M4)

- 批次:grid 左勾選欄 → 勾選集 → 批次刪除(確認 dialog → 迴圈 DELETE 或批次端點;soft delete)。
- 匯出(OQ-VL-6):**client-side**,當前視圖結果(套 filter/sort/選欄,用已 `maskRead` 的資料)→ `xlsx` 產 CSV/Excel;上限 ~5000 筆(對齊 import cap),超過顯示「僅匯出前 N 筆,完整匯出待伺服器端(P1)」誠實訊息。hidden 欄不在資料內(後端已剝)。

---

## 7. 資料模型變動

### 7.2 SQL Migration
- **`0009_view_def.sql`**(純加法):新 `view_def` 表(§4.1)+ 部分唯一索引(name / is_default)。惰性零回歸(無此表時前端走 lazy 預設檢視)。
- **down**:`DROP TABLE view_def`(無既有依賴)。

### 7.3 RLS / Permission — **循 authz Tier-1 車道(非 RLS,app 層 tenant scope)**
- `view_def` 為授權/metadata 類 Tier-1 表(如 `roles`/`form_permissions`/`form_categories`)—— **走特權 DRIZZLE 車道 + 每查詢 `where tenant_id = ?` app 層綁定**,**不掛 RLS**(與 `form_categories` 一致;authz.repository §4/§7 既定模式:「授權表非 RLS;每查詢以 tenant_id 綁定 + app 層 scope」)。動態記錄資料才走 `weyver_app` RLS 車道(record.service);view 只是「存查詢」,不是 tenant 記錄資料。跨租戶隔離由 app 層 scope + integration 測強制。
- records query 擴充**不改權限模型**:`maskRead`/`assertWritable` 仍為硬底(APP_KNEX RLS 車道);combinator/search 僅擴查詢表達,identifier 仍走 catalog 白名單、值參數綁定。

---

## 7-bis. 安全(擇要;完整見 [[rule_security_standards]] + docs/22)

| 攻擊面 | 緩解 |
|---|---|
| filter/sort/search identifier 注入 | field 名 → catalog 白名單解析物理欄(既有鏈);查無即 `UnknownFieldError`;`q` 值參數綁定 ILIKE(不拼接);operator 走 `field-type-registry` 相容白名單 |
| `view_def` 跨租戶洩漏 | DRIZZLE 車道每查詢 `where tenant_id = ?` app 層綁定(同 authz 表);integration 測:B 租戶讀不到 A 的 view;`form_id` 驗屬本租戶 |
| view 選欄「洩」hidden 欄 | **不可能** —— `maskRead` 後端已刪 hidden 欄;view.fields 只能是收窄的表現層(D4);e2e 斷言 hidden 欄不在 grid/匯出 |
| 固定篩選誤當安全邊界 | **明確不做進 view**(OQ-VL-2);列級安全歸 authz 軸(role/tenant-bound、伺服器端不可繞);避免 Airtable 明文警告之反模式 |
| inline edit 越權寫 | `assertWritable` 伺服器端強制(mass-assignment 白名單);唯讀欄 grid 不可編 |
| 快速搜尋全表掃描 DoS | `statement_timeout` + 既有 row limit + textual 欄限縮 + cursor 分頁;metadata 快取(P1) |
| 大量匯出 OOM | client-side 上限 ~5000 + 誠實訊息;伺服器端串流/async = P1 |

Input validation:`config`(fields/filter/sorts/search/pageSize)全走 Zod 邊界驗證 + `z.infer` 推型別;`name` 長度/唯一;`scope`/`is_default`/`locked` 列舉/布林。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Integration(api)| `view_def` CRUD 跨租戶隔離(B 讀不到 A);records query combinator(and/or 語意)、search(ILIKE 命中)、sort 多鍵;inline edit 唯讀欄拒寫;is_default 唯一約束 | `apps/api/test/*.test.ts`(Testcontainers 真 PG)|
| e2e(Playwright)| 建表→集合視圖→facet 篩選→多鍵排序→另存個人檢視→設共通預設→切視圖→批次勾選刪除→匯出當前視圖→雙模式(列表↔記錄)切換;固化進 CI | `apps/web/e2e/views.spec.ts` |
| Unit | combinator 編譯 / operator 相容判定 / 預設檢視 lazy 計算 | `*.test.ts` |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** | 本檔 → APPROVED(OQ-VL-1..7 裁定)| ✅ |
| **M1** | 後端:view_def(0009)+ CRUD + records query combinator/search(`f986477`)| ✅ |
| **M2** | 前端:集合視圖 + 雙模式(列表↔記錄)(`3300561`)| ✅ |
| **M3** | 前端:facet 篩選 + 多鍵排序 + 儲存檢視三態(`9ccda81`)| ✅ |
| **M4** | 前端:批次刪除 + 匯出(`9c7cdba`)| ✅ |
| **M5** | views.spec 固化 + FMEA + doc v1.0 + MODULES ✅(`ad2a4c2`)| ✅ |

---

## 10. 開放問題(OQ-VL-N)— ✅ 已裁定 2026-07-25(全採建議 = 全 A)

> 全數採「建議」欄。進入 M1。**OQ-VL-2 之裁定同步修正 docs/27 §3**(forcedFilter 由 view 屬性軸移出,歸 authz 軸)。

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-VL-1** | filter combinator 模型 | A. **單層 combinator(AND\|OR over flat conditions)**<br>B. 單層 filter groups(每組一 combinator)<br>C. 3 層巢狀(Airtable/Teable) | **A** — Ragic parity(跨欄 AND + per-field 選 AND/OR)+ Airtable 最常見情境;backend 僅加 combinator + OR 支援(小改)。groups → P1、3 層巢狀 → P2。**證據**:Airtable/Teable 皆 3 層巢狀 upper-bound(`airtable-support/filtering-records-using-conditions`、`teable/toolbar.md`),Ragic 為 flat(`ragic doc-user/15`)|
| **OQ-VL-2** | 固定/強制篩選(forcedFilter)歸屬 —— **對 docs/27 §3 的修正** | A. **移出 view,歸 authz 軸**(role/tenant-bound、server-side 不可繞)<br>B. 做進 view_def 作 removable 屬性<br>C. 做進 view_def 作 unremovable(Ragic 固定篩選) | **A** — view filter 不是安全邊界。**證據**:Airtable 明文「使用者可移除、不得用於隱藏私密資料、只在載入後再過濾」(`airtable-support/shared-view-url-filters`);Teable 強制篩選做成 Authority Matrix 角色權限非 view 屬性(`teable/authority-matrix.md`);Ragic 固定篩選存在但另有獨立 RLS(doc/54)。做 C 即半成品 RLS = 洩漏面。列級安全統一歸 P0-4 authz 軸。若遷移盤點發現鮮勇重度依賴 Ragic 固定篩選,於 authz 軸補「admin 設租戶/角色級不可移除篩選」,仍非 view 屬性 |
| **OQ-VL-3** | 集合視圖 inline 編輯 | A. **複用 Glide 可編輯 grid**(P0;cell 編輯→PATCH,權限 gate)<br>B. 唯讀 + 下鑽 Object Page 編輯 | **A** — inline 編輯是三家 table-stakes 預設(Ragic「跟 Excel 一樣點選即編」doc-user/4;Airtable grid;Teable grid),唯讀會被感知為降級;infra 已在(record-grid-panel)。編輯後 re-sort/re-filter 延後(留位至 refetch)|
| **OQ-VL-4** | 預設檢視落點 | A. **lazy 計算**(無 is_default row → 全 readable 欄/field 序/無 filter)<br>B. 建表即物化 default row | **A** — 零回歸(對齊 workspace-ia lazy);設計者客製才落 row。Ragic 列表頁本就由設計者用「列表頁欄位選擇工具」控(doc/38),對映為「設計者設共通預設檢視」|
| **OQ-VL-5** | 快速搜尋範圍 | A. **伺服器端 ILIKE 跨 textual 欄**(catalog 白名單 + timeout)<br>B. 全欄 cast text 搜<br>C. client-only 過濾已載頁 | **A** — Ragic「先 ILIKE」(§3 P0);限 textual 欄避免全欄 cast 成本 + 保 index 可能性;client-only 在分頁下不完整。全庫跨表搜尋仍歸 P1-I(OQ-WIA-2 已裁)|
| **OQ-VL-6** | 匯出實作 | A. **client-side CSV/Excel 當前視圖上限 ~5000**<br>B. 伺服器端串流端點 | **A** — 對稱既有 client-side import;`xlsx` 已 bundled;view-scoped(套 filter/sort/選欄)。**證據**:三家匯出皆 view-scoped(Airtable/Teable/Ragic);Ragic >5000 轉 CSV、>30000 async email → **伺服器端串流 + async = P1**,P0 先上限 + 誠實訊息 |
| **OQ-VL-7** | 雙模式進表預設 | A. **列表(collection)為預設**,點列進記錄頁<br>B. 記錄頁(Object Page)為預設 | **A** — Ragic 開表先列表頁;Airtable/Teable 皆 grid-first;集合視圖是每天第一眼(直接解「單薄」日常面)。單筆 deep-link(`?view=record&rid=`)仍可直達記錄頁 |

---

## 12. 失效場景反思(FMEA)— M5 收尾(R17);✅=已驗證緩解

| # | 場景 | 緩解 | Sev | 狀態 |
|---|---|---|---|---|
| V1 | `view_def` 跨租戶洩漏(讀到他租戶檢視/篩選)| DRIZZLE 車道每查詢 `where tenant_id`;form_id 驗屬本租戶;integration 斷言 B 讀不到 A / B 改 A → 404 | P0 | ✅ views.integration 2 測 |
| V2 | filter/sort/search 之 field 名注入 | catalog 白名單解析物理欄(既有鏈);`q` 值參數綁定 ILIKE;operator 白名單 | P0 | ✅ 承既有 records 白名單鏈 + records combinator/search 測 |
| V3 | view 選欄使 hidden 欄外洩(grid/匯出)| `maskRead` 後端硬底已剝 hidden 欄;view.fields 只能收窄(displayFields ∩ form.fields)| P0 | ✅ by design(匯出用已 masked 之 records) |
| V4 | inline edit 越權寫唯讀/他人欄 | `assertWritable` 伺服器端白名單;grid 唯讀欄不可編(isGridEditable)| P0 | ✅ 承 P0-4a M4 |
| V5 | forcedFilter 誤當列級安全被繞過 | **不做進 view**(OQ-VL-2);列級安全歸 authz 軸;docs/27 §3 同步修正 | — | ✅ 不建即無面 |
| V6 | is_default 競態(兩共通 view 同設預設)| 部分唯一索引(每 form 至多一 default)+ 設預設交易內先清舊 | P1 | ✅ views.integration「至多一預設」測 |
| V7 | 快速搜尋 ILIKE 全表掃描拖慢 | `statement_timeout`(既有)+ textual 欄限縮(dbFieldType=text)+ cursor 分頁 | P1 | ✅ 限縮已實作;metadata/計數快取待 P1 |
| V8 | 大量匯出瀏覽器 OOM / 不完整 | client-side 匯出僅**已載入**記錄 + `hasNextPage` 時明標「僅含已載入 N 筆」| P1 | ⚠️ 已知殘留:完整大量匯出需伺服器端串流/async(P1);pilot 規模(<200)一頁涵蓋 |
| V9 | 部署順序:後端 code 先於 0009 migration | migration 必先(R10;dev 已 `db:migrate`);缺表時 useViews 回空 → 前端走 lazy 預設檢視(優雅降級)| P1 | ✅ |
| V10 | combinator 舊 API 相容 | `combinator`/`q` 皆 optional;舊 `filters:[]` 呼叫方 = 隱含 AND(listRecords `?? "and"`);saveWithLines/子表既有呼叫不受影響 | P1 | ✅ api 220 測全綠(含既有 records 測) |
| V11 | autoNumber/formula 欄篩選失敗(422)| autoNumber valueSchema=never → UI 僅給 contains/空值;formula 讀時算(DB 欄空)→ 不入篩選欄;未填值條件不送查詢 | P1 | ⚠️ 已知殘留:autoNumber eq / formula 值篩選未支援(治本 = 後端 filter 用 text schema 待 field-types-parity)|
| V12 | 前端 admin 動作對非 admin 顯示(共通/設預設)| 後端 ViewService admin-gating 為真實邊界(403 surfaced;view.service 8 單元測);dev superadmin=admin | P1 | ⚠️ 已知殘留:前端 `isAdmin` 暫傳 true(dev 為 superadmin),prod 非 admin 會見動作但後端 403 → 治本 = `/me` capabilities 端點(P1)|

> **檢查點**:P0(V1–V4)全 ✅ → 得標 SHIPPED。P1 殘留(V8/V11/V12)歸屬明確(伺服器端匯出 / field-types-parity 後端 filter / capabilities 端點),不阻 R1 pilot 使用。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-25 | v0.1 | 初版 DRAFT — docs/27 §6 順序 2(承 workspace-ia):集合(browse)視圖 + 雙模式 + `view_def` 儲存檢視三態 + facet 篩選 + 多鍵排序 + 快速搜尋 + 批次 + 匯出;**OQ-VL-2 提出對 docs/27 §3「forcedFilter 為 view 屬性」之證據驅動修正**(移出 view 歸 authz 軸);OQ-VL-1..7 待裁定 | Claude Code |
| 2026-07-25 | v0.2 | **OQ-VL-1..7 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。§7.3 定案:`view_def` 循 authz Tier-1 DRIZZLE 車道(非 RLS,app 層 tenant scope,與 form_categories 一致)。OQ-VL-2 同步修正 docs/27 §3(forcedFilter 移出 view 屬性軸)| Claude Code |
| 2026-07-25 | v1.0 | **M1–M5 SHIPPED**。M1 view_def(0009)+ views CRUD(三態 + admin-gating + 預設唯一)+ records query 單層 combinator(OR 包 group 不洩邊界)+ 快速搜尋(textual ILIKE)。M2 集合 Glide 視圖 + 雙模式(nuqs mode/rid,列表預設)+ inline edit + 下鑽。M3 facet 篩選(型別感知 operator)+ 多鍵排序 + 儲存檢視三態 UI + lazy 預設。M4 批次刪除(Glide 選取)+ client-side 匯出。M5 views.spec 5 測固化;workspace.spec 對齊列表預設。FMEA V1–V4 P0 全 ✅;殘留 V8/V11/V12 歸屬明確。api 220 + web 12 e2e 綠 | Claude Code |
