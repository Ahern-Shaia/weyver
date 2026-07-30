# pivot-and-charts.md — [F-2] 樞紐分析 + 圖表設計文件

| | |
|---|---|
| 狀態 | 🚧 **APPROVED — OQ-PC-1..9 已裁定(2026-07-30,全採建議),進 M1** |
| 建立 | 2026-07-30 |
| 上游 | docs/25 §F(pivot 5 / 圖表 4 / 儀表板 4 人月,皆 ⬜)· [views-group-kanban-calendar](views-group-kanban-calendar.md) v1.0 之 group-stats 地基 |
| 依賴 | F-1(GROUPING SETS 聚合 + 同一 RLS role 的計數保證)· authz(記錄級 + 欄位級)· views-list(view_def) |

---

## 1. 目標與範圍

### 1.1 為什麼是這一批

F-1 補完了報表的「**檢視方式**」(分組 / 看板 / 行事曆),但 `docs/25` §F 的大宗是「**分析**」:
pivot(5)+ 圖表(4)+ 儀表板(4)。F 段覆蓋率因此仍只有 27% ——
而客戶說「報表」時多半指的是後者。

### 1.2 🔴 研究推翻了原規劃的兩個前提

**(a) 儀表板不是「拖拉排版」——** `docs/10` §131 記載「儀表板(Dashboard)|**拖拉排版 + 多圖表組合**」。
連線複核 Ragic 官方文件,**與事實不符**:

> [Ragic 資料儀表板](https://www.ragic.com/intl/zh-TW/doc/7/dashboard-report)逐字:
> 「各欄位統計數據會**依據表單中的位置,從左到右、從上到下依序排列**顯示」

即 Ragic 的資料儀表板是**自動生成、單表單、無版面編輯**,使用者只能移除/加回欄位項目。
**真正可拖曳的是「小圖表(widgets)」**([doc/122](https://www.ragic.com/intl/zh-TW/doc/122/widgets)):

> 「在**表單頁**或**列表頁**進入設計模式,在任何位置點右鍵,選擇『插入小圖表』」
> 「小圖表能夠**拖曳到表單的任何位置**,一張表單也可以插入多個小圖表」
> 「也可以設定**存取這個小圖表所需的權限**,指定哪些使用者群組可以看到此小圖表」

且其首頁是**受限直欄版面**([doc/90](https://www.ragic.com/intl/zh-TW/doc/90/customizing-your-database-home)):
「區塊只能在各自的直欄內調整位置,**無法將左側直欄的區塊移動至右側直欄**」。

→ **`docs/10` 該行需更正**;且「拖拉式儀表板」在 parity 上根本不是必要項。

**(b) 這與 `docs/24` 的定位一致而非衝突**|該文件明載「主要畫面 = 使用者自己建自己填的表單資料庫,
**非唯讀 KPI 儀表板**」「儀表板為主管角色之**次要視圖**;以儀表板為主畫面即『為 SaaS 而 SaaS』」。
Ragic 自己也是這樣做的 —— 圖表**嵌在表單頁/列表頁旁**,而不是另闢一個儀表板畫布。

### 1.3 目標(P0)

1. **樞紐分析(pivot)** —— 列軸(≤3)× 欄軸(1)× 值,共用 F-1 的聚合引擎
2. **檢視級圖表(chart view)** —— 掛在既有 `view_def` 之下,繼承該列表頁的篩選
3. **小圖表(widget)** —— 可釘在列表頁 / 表單頁,帶自身篩選與**可見群組**

### 1.4 不做的事(附理由)

- ❌ **拖拉式多來源儀表板(react-grid-layout)** —— §1.2 證實非 Ragic parity 必要項;
  且 `react-grid-layout` 近期 release 全在修 ResizeObserver loop / 容器寬度量測 / resize preview 約束
  ——**那些就是坑本身**。列 R2,屆時再評估
- ❌ **SQL 客製報表** —— Ragic 有,但屬進階客戶功能,且會開一條原生 SQL 面(與動態 identifier 安全鏈衝突)
- ❌ **報表快照 / 排程寄送** —— 承 F-1 §0.3 的教訓:Ragic 官方自承「報表快照以系統管理員權限產生,
  可能包含檢視者無權存取的資料」。要做必須**檢視時重新授權**,非本批
- ⏳ **甘特圖 / 地圖** —— ECharts 有,但需額外的資料語意設計,列 P1

---

## 0. 深度研究(2026-07-30)— 業界實證

> 專案 P0 規則:研究即寫入 doc,附來源連結並標注證據強度。
> 多條結論取自**閱讀競品原始碼**(Metabase / Superset 皆 OSS)與**官方 advisory**。
> ⚠️ clean-room:僅閱讀公開原始碼以理解「業界怎麼解」,不複製實作。

### 0.1 🔴 業界一致回**長表**,沒有一家回動態寬表

| 系統 | 做法 | 證據 |
|---|---|---|
| **Metabase** | 跑 N 個 breakout 組合的子查詢再串接,每列帶 `pivot-grouping` bitmask → **長表**,前端轉置。新路徑改單一 `GROUPING SETS`,**輸出仍是長表** | 原始碼 [pivot.clj](https://github.com/metabase/metabase/blob/master/src/metabase/query_processor/pivot.clj) |
| **Superset** | SQL 只做 group by,`charts/post_processing.py` 以 pandas `pivot_table` 轉置 | [PR #15879](https://github.com/apache/superset/pull/15879) |
| **Cube** | `pivotConfig.x/.y` + `resultSet.tablePivot()` —— **純客戶端** | [官方](https://cube.dev/docs/reference/frontend/cubejs-client-core) |

**硬理由**|PostgreSQL 官方限制 **result set 最多 1,664 欄 / 表 1,600 欄**
([PG Limits](https://www.postgresql.org/docs/current/limits.html))。寬表在 SQL 層就有天花板。
且寬表的 JSON key 會變成**使用者資料** —— 跳脫、撞名、洩漏全發生在 key 上。

### 0.2 `crosstab` 不可用

PostgreSQL `tablefunc` 的 `crosstab` **要求輸出欄名與型別在呼叫端 FROM 子句寫死**
([官方](https://www.postgresql.org/docs/current/tablefunc.html))。
動態化只能 PL/pgSQL + `EXECUTE format()` —— 在多租戶動態表情境等於**再開一條動態 identifier 注入面**,
且回傳型別不定、無法 prepared。**直接排除。**

### 0.3 grouping set 要明列,**不要用 `CUBE`**

pivot 實際需要的是 **(|列軸|+1) × (|欄軸|+1)** 組(Metabase 的 breakout-combination 定義 = 列軸前綴 × 欄軸前綴),
而 `CUBE(n)` 是 2ⁿ 組。3 列軸 + 2 欄軸:**CUBE 32 組 vs 明列 12 組**。

**Metabase 原始碼揭露的兩個 PG 陷阱**:
1. breakout 若是**表達式**(如 `date_trunc`),在 `GROUPING SETS` 與 `GROUPING()` 中各自出現時,
   planner 的 GROUPING-matcher 視為不同運算式而**拒絕 query** → 必須先在內層 subquery **物化成具名欄**
   ([nest_for_pivot.clj](https://github.com/metabase/metabase/blob/master/src/metabase/query_processor/middleware/nest_for_pivot.clj))
2. window function(累計)套在 GROUPING SETS 上無意義,Metabase 直接 fallback 多查詢

> ⚠️ 陷阱 1 **直接命中本專案** —— F-1 的日期分組正是 `date_trunc` 表達式。

### 0.4 各系統的軸能力(Ragic 是唯一有欄軸的對標)

| 系統 | 列軸 | 欄軸 | 上限 | 證據 |
|---|---|---|---|---|
| **Ragic 樞紐分析** | 多組 | **多組** | **任一邊 >1000 行即拒絕產生** | [doc/22](https://www.ragic.com/intl/zh-TW/doc/22/pivot-table) |
| **Ragic 分群報表** | 多層 | **無** | — | [doc-user/42](https://www.ragic.com/intl/zh-TW/doc-user/42/grouping-report) |
| Airtable Pivot 擴充 | **1** | **1** | 未載 | [官方](https://support.airtable.com/docs/pivot-table-extension) |
| **Baserow** | 5 | **無** | — | pivot 需求 [#363](https://github.com/baserow/baserow/issues/363)、[#827](https://github.com/baserow/baserow/issues/827) **至今未做** |
| **NocoDB** | 3 | **無** | — | 官方 |
| **Teable** | group | **無** | — | repo 搜 `pivot`/`crosstab` = **0 筆** |
| Notion | 子群 1 | 群 1 | 僅 2 維 | 官方 |
| Google Sheets | 多 | 多 | `PivotGroupLimit` = 每軸 **top-N** | [API schema](https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/pivot-tables) |

**關鍵取捨**|**Baserow / NocoDB / Teable 全都只做多層列軸、不做欄軸** ——
「不做欄軸」是 OSS 表單資料庫的主流選擇,因為欄軸帶來的是**資料形狀問題**而非計算問題。
本專案要做欄軸的唯一理由是 **Ragic parity**(客戶已在用)。

**欄位爆炸實證**|Superset [#35981](https://github.com/apache/superset/issues/35981)(20k 列 × 10 欄凍瀏覽器)·
Metabase [#15672](https://github.com/metabase/metabase/issues/15672)(2000 列截斷導致樞紐只算到前 3 個月)·
[#58087](https://github.com/metabase/metabase/issues/58087)(下載被限 10k)。

### 0.5 🔴 洩漏面:**維度值清單**才是主角,不是聚合值

F-1 已確立「PG policy 先於 user query 求值 → `COUNT`/`SUM` 天然只算可見列」。
但 pivot / 圖表**多出一個面**:欄標頭、圖例、軸標籤、tooltip 會把 `GROUP BY` 的維度值**全部列舉**。

**真實 CVE**|[CVE-2024-55951 / GHSA-rhjf-q2qw-rvx3](https://github.com/metabase/metabase/security/advisories/GHSA-rhjf-q2qw-rvx3)
(Metabase Enterprise 1.52.0–1.52.2.4):filter 下拉的 **field values 被跨 sandbox 使用者快取共用** ——
第二個使用者看到第一個的值。**洩漏的不是列,是維度值清單。**

**同類**|Superset [#10804](https://github.com/apache/superset/issues/10804) /
[#37094](https://github.com/apache/superset/discussions/37094):RLS 未進 cache key → 跨使用者看到彼此結果。

**另一條**|Metabase 官方明文:row/column security **不套用於 public questions / public dashboards**,
亦不套用於 native SQL 結果([官方](https://www.metabase.com/docs/latest/permissions/row-and-column-security))。
→ **圖表的內嵌分享與匯出必須各自重跑權限**,不可沿用已算好的聚合。

**Ragic 的做法**|小圖表為 **widget 級 all-or-nothing**(可設可見群組),不做部分聚合遮蔽 ——
parity 上先做這個最省也最安全。

### 0.6 圖表庫選型(OSS-only 硬約束)

| 庫 | SPDX | 最新版 | gzip | React 19 | a11y | Ragic parity 缺口 |
|---|---|---|---|---|---|---|
| **ECharts** | **Apache-2.0**(含專利授權;ASF 治理,使用者無 CLA) | **6.1.0 / 2026-05** | 全包 359KB,**tree-shake ~80–100KB** | 框架無關,需 `"use client"` | **內建 `aria.enabled`** 自動產生描述 + **decal 紋理**(色盲);鍵盤導覽有缺陷([#18585](https://github.com/apache/echarts/issues/18585)) | **無**(甘特/地圖/雙 Y 軸皆有) |
| Recharts | MIT | 3.10.1 / 2026-07 | 144KB,SVG DOM 難 tree-shake | peer 明列 ^19 | **鍵盤導覽最完整**(`accessibilityLayer`) | 無甘特、無地圖 |
| Chart.js | MIT | 4.5.1 / 2025-10 | ~92KB | 需 react-chartjs-2 | ❌ 官方明言 **canvas 內容螢幕閱讀器讀不到** | 無甘特/地圖/雙 Y 軸 |
| visx | MIT | 4.0.0 / 2026-06 | 組合式 | ✅ | 自己做 | 低階圖元,每型自寫 |
| Nivo | MIT | 0.99.0 / **2025-05(14 個月未發版)** | 78KB | ✅ | 部分 | 無甘特/地圖 |
| Observable Plot | ISC | 0.6.17 / **2025-02(17 個月未發版)** | 125KB | 需 client-only | 有限 | 無甘特 |
| uPlot | MIT | 1.6.32 / 2025-03 | **21.3KB 最小最快** | 框架無關 | ❌ | 只做時序線圖 |

→ **維持 ECharts**(docs/25 早期規劃仍成立),但**不用 `echarts-for-react`**
(其 peer 只寫 `>=16.0.0`、未明列 19,且只是 3.5KB 薄封裝,自寫 wrapper 更可控)。

理由:① Apache-2.0 含**明確專利授權**,比 MIT 更適合企業採購與 clean-room 政策
② **a11y 是一行開關**(政府/大企業採購的實質要求)③ 甘特+地圖+雙 Y 軸一次補齊 parity,不必湊三個庫
④ ASF 治理非單人專案。

⚠️ **查不到**:ECharts 官方對 **CJK 在 Node SSR 的字型處理**說明(SSR 算字寬需註冊字型檔,CJK 字型 5–10MB)
→ **圖表一律 client-only 渲染**規避。

### 0.7 圖表的資料來源:與 pivot **共用 spec、分岔執行**

- **Ragic** 兩者都有:條狀圖是**獨立聚合**(選分析數據 + 加總方式 + 主要/次要分類);
  而樞紐分析報表**內建「產生圓餅圖」勾選**,圖吃 pivot 結果([doc/137](https://www.ragic.com/intl/zh-TW/doc/137/bar-chart))
- **Metabase** 為了小計必須跑多支不同 breakout 的查詢([#13573](https://github.com/metabase/metabase/issues/13573))

→ **建議**:共用同一份 aggregate spec 與 SQL builder,**但執行分岔** ——
pivot 走 `GROUPING SETS` 取小計,chart 只走單一 `GROUP BY`。
硬綁成同一查詢會讓圖表背上 pivot 的多查詢成本(Metabase 就是這個下場)。

### 0.8 「儀表板被高估」的證據強度

- **強**|Gartner / BARC 調查:BI 分析工具的員工採用率僅 **~29–30%**(BARC 版本更低)
  ([TechTarget 報導](https://www.techtarget.com/searchbusinessanalytics/news/365530077/BI-adoption-poised-to-break-through-barrier-finally))
- **弱,不引用**|二手部落格稱「60%+ 儀表板 90 天未被開啟」「72% 使用者回頭用試算表」—— 查無原始出處
- **同向**|Airtable Interface Designer 新版 layout 官方自述為「a more straight-forward, **constrained** approach」

→ 方向一致:**分析嵌在工作流旁,比獨立儀表板更被使用**。這也正是 Ragic 小圖表的形態。

### 0.9 誠實聲明:查不到的

- Ragic 官方未公布其圖表底層庫
- ECharts 官方對 CJK SSR 字型的指引
- 任何產品公開討論 **pivot 空白格的存在性推斷**(PG 文件明載的 covert channel 是 constraint/RI 檢查,不含聚合)
- Airtable pivot 擴充的欄數上限

---

## 2. 現況走查(F-1 留下的地基)

| 項目 | 現況 | 本批需要 |
|---|---|---|
| `group-stats` 端點 | ✅ `GROUPING SETS` 多層聚合、7 個聚合函數 | **拆軸**:`groupBy` → `rowGroupBy[]` + `colGroupBy[]` |
| grouping set 產生器 | ✅ 前綴 rollup(`(g1),(g1,g2),(g1,g2,g3)`) | 改為**兩組前綴的笛卡兒積** |
| RLS / 同交易 / filter / 聚合 / 截斷 | ✅ 全部就位 | **完全不動** |
| 日期分組表達式 | ✅ `date_trunc` + 租戶時區 | ⚠️ §0.3 陷阱 1:須先物化成具名欄 |
| 欄位級 hidden 白名單 | ✅ 分組鍵與聚合欄皆已擋 | 沿用至軸與 measure |
| 圖表庫 | ❌ **完全沒有** | 裝 ECharts(tree-shaken)+ 自寫 client wrapper |
| `view_def.config` | ✅ JSONB 加法擴充 | 加 `pivot` / `chart` 子物件 |
| widget 資料模型 | ❌ 無 | 新表 `widget_def`(含可見群組) |

> **最省的結論**(研究原話):RLS / 同交易 / filter / 聚合 / 截斷**全部不動**,只改 grouping set 產生器。

---

## 4. 設計要點

### 4.1 pivot ≠ 雙軸 group-by(計算層是,契約層不是)

**計算層:是** —— 一條 `GROUPING SETS` 算完,差別僅在 grouping set 集合的定義。

**契約層三處本質不同**:
1. **輸出是二維的** → 需要 rowKeys × colKeys 的稀疏→密集物化,列數 ≠ 回傳列數
2. 🔴 **欄軸基數是查詢的輸出而非輸入** → 下查詢前不知會產生幾欄,無法預估 payload,
   且**欄軸無法 keyset 分頁**(必須一次全取)。這正是 `crosstab` 不可用、也是 group-by 從未遇過的問題
3. **欄標頭被提升到 schema 位置** → 因而進入權限面,且更容易被誤從別處取值(§0.5)

→ **引擎層複用,API 契約與前端另立。**

### 4.2 API 回長表

```
POST /forms/:id/records/pivot
  { rowGroupBy[≤3], colGroupBy[≤1], aggregates[], filters, q }
→ { cells: [{ rowKeys, colKeys, grouping, measures }], rowHeaders, colHeaders, truncated }
```

前端負責稀疏→密集轉置。**不回動態欄位的寬表**(§0.1)。

### 4.3 🔴 欄標頭的防洩漏鐵則

欄清單**只能**從同一交易、同一 RLS role、同一 filter 的那組 grouping set(僅欄維度的列)導出。

**禁止**從以下取值:
- 單選欄的**選項定義**(那是 metadata,不受 RLS)
- metadata catalog
- **任何快取**

若要快取,cache key 必須含 `tenant_id` **+ 有效權限指紋**(actor 角色 + 記錄範圍 policy 版本)——
否則就是 CVE-2024-55951 的形狀。hidden 欄不得當軸、不得當 measure。

### 4.4 上限(承 F-1 的誠實截斷慣例)

| 項目 | 上限 | 依據 |
|---|---|---|
| 列軸 | 3 層 | 對齊 F-1 分組 / Airtable / Teable |
| 欄軸 | **1 層** | Airtable 亦僅 1;Ragic 雖多層但 >1000 行即拒絕 |
| 欄軸 distinct | **≤100**,超過走 top-N + 「其他」 | Google Sheets `PivotGroupLimit` 之形態 |
| 總格數 | **≤20,000** 明示截斷 | Ragic 1000 行為可對標下限;沿用 F-1 截斷機制 |

### 4.5 圖表:與 pivot 共用 spec、分岔執行

pivot 走 `GROUPING SETS`(要小計),chart 走單一 `GROUP BY`(不要小計)——
硬綁同一查詢會讓圖表背上 pivot 的多查詢成本(§0.7)。

**ECharts 一律 client-only 渲染**(§0.6 的 CJK SSR 字型問題),開 `aria.enabled` 與 decal 紋理。

### 4.6 小圖表(widget)採 Ragic 形態

可釘在列表頁 / 表單頁,帶自身篩選 + **可見群組**(widget 級 all-or-nothing,不做部分聚合遮蔽 ——
§0.5 明示這是最省也最安全的 parity 做法)。

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 pivot 引擎** | grouping set 產生器改笛卡兒積 · `date_trunc` 表達式物化成具名欄(§0.3 陷阱)· `/pivot` 端點回長表 · 欄軸 top-N · 洩漏測試 | 0.10 mo |
| **M2 pivot 前端** | 交叉表呈現(稀疏→密集)· 軸設定 UI · 截斷提示 | 0.10 mo |
| **M3 圖表** | 裝 ECharts(tree-shaken)+ client wrapper · chart view(繼承 view 篩選)· bar/line/pie/雙 Y 軸 | 0.10 mo |
| **M4 小圖表** | `widget_def` + 可見群組 · 釘在列表頁/表單頁 | 0.08 mo |
| **M5 收尾** | FMEA · e2e · doc v1.0 · MODULES · docs/25 回填 · **更正 docs/10 §131** | 0.04 mo |

**合計 ≈ 0.42 mo**。前後端分開 commit。

---

## 10. 開放問題(OQ-PC-N)— ✅ **已裁定 2026-07-30(全採建議)**

裁定:1=A(長表)· 2=A(欄軸 1 層)· 3=A(明列 grouping set)· 4=A(top-N ≤100)·
5=A(ECharts tree-shaken + 自寫 wrapper)· 6=A(共用 spec 分岔執行)· **7=A(不做拖拉儀表板,改小圖表)**·
8=A(不快取)· 9=A(widget 級 all-or-nothing)

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-PC-1** ⭐⭐ | 回長表還是寬表? | A. **長表 + 前端轉置**<br>B. 動態欄位寬表 | **A** — 業界**沒有一家**回寬表(Metabase/Superset/Cube 皆長表);PG result set 1,664 欄是硬天花板;且寬表的 JSON key 會變成使用者資料(跳脫/撞名/洩漏全在 key 上)。**證據**:三家原始碼 + PG Limits |
| **OQ-PC-2** ⭐ | 做欄軸嗎? | A. **做,但只 1 層**<br>B. 不做(只多層列軸,同 Baserow/NocoDB/Teable)<br>C. 多層欄軸(同 Ragic) | **A** — B 是 OSS 表單資料庫的主流選擇,但**客戶已在用 Ragic 的樞紐分析**,不做等於 parity 破口;C 的複雜度(多層欄標頭合併儲存格)與收益不成比例,且 Ragic 自己 >1000 行就拒絕產生 |
| **OQ-PC-3** ⭐ | grouping set 怎麼產生? | A. **明列 (列軸前綴 × 欄軸前綴)**<br>B. `CUBE` | **A** — `CUBE(n)` = 2ⁿ 組,3 列 + 2 欄時 32 組 vs 明列 12 組。**證據**:Metabase 的 breakout-combination 定義 |
| **OQ-PC-4** ⭐⭐ | 欄軸高基數怎麼辦? | A. **top-N(≤100)+ 「其他」**<br>B. 直接拒絕(同 Ragic >1000 行)<br>C. 不設限 | **A** — B 對使用者是「按了沒反應」;C 會凍瀏覽器(Superset #35981 實證 20k×10 即凍)。top-N 是 Google Sheets 的官方形態(`PivotGroupLimit`),且**必須明示**已截斷 |
| **OQ-PC-5** ⭐ | 圖表庫 | A. **ECharts(tree-shaken + 自寫 wrapper)**<br>B. Recharts<br>C. Chart.js | **A** — Apache-2.0 含專利授權(優於 MIT 於企業採購)· a11y 一行開關 · 甘特/地圖/雙 Y 軸一次補齊 parity。B 的 a11y 最好但缺甘特/地圖且 144KB 打不散;C 的 canvas a11y 缺口對企業投標是硬傷。**不用 `echarts-for-react`**(peer 未明列 React 19) |
| **OQ-PC-6** | 圖表與 pivot 的查詢關係 | A. **共用 spec、分岔執行**(pivot 走 GROUPING SETS,chart 走單一 GROUP BY)<br>B. 圖表吃 pivot 結果 | **A** — B 會讓圖表背上 pivot 的多查詢成本(Metabase #13573 即此下場)。共用 spec 保證兩者母體一致,分岔執行避免不必要的小計 |
| **OQ-PC-7** ⭐⭐ | 儀表板做到什麼程度? | A. **不做拖拉儀表板;做「小圖表可釘在列表頁/表單頁」**(Ragic 形態)<br>B. 做拖拉式 grid 儀表板<br>C. 兩者都做 | **A** — §1.2 證實 **Ragic 的資料儀表板根本不可拖拉**(欄位依表單位置自動排列),可拖曳的是小圖表;`docs/24` 亦明定儀表板為次要視圖。B 要引 `react-grid-layout`,其近期 release 全在修 ResizeObserver loop 與量測問題 ——**那些就是坑**。**順帶**:`docs/10` §131 的記載需更正 |
| **OQ-PC-8** ⭐ | 圖表/pivot 的維度值快取? | A. **不快取**(每次重算)<br>B. 快取但 key 含租戶 + 權限指紋 | **A** — CVE-2024-55951 正是「維度值被跨 sandbox 使用者快取共用」;Superset 亦有 RLS 未進 cache key 的重複事故。R1 量級不需要快取,**先不開這個面**;真需要時才走 B 並把權限指紋列為 key 的一部分 |
| **OQ-PC-9** | 小圖表的權限粒度 | A. **widget 級 all-or-nothing**(可設可見群組,同 Ragic)<br>B. 部分聚合遮蔽 | **A** — B 需要 k-anonymity 那一套(最小分組門檻),複雜且易錯;Ragic 亦僅做 A。聚合值本身已受 RLS 保護,widget 級控制是額外的一層 |

---

## 12. 失效場景反思(FMEA)— pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| P1 | 🔴 **欄標頭列舉出使用者看不到的維度值**(CVE-2024-55951 形狀) | 欄清單只從同一交易/同一 RLS role 的 grouping set 導出;禁從選項定義/metadata/快取取值。測試斷言「A 建 500 個客戶、B 只看得到 3 個 → B 的欄標頭只有 3 個」 | **P0** |
| P2 | 🔴 hidden 欄被當軸或 measure | 沿用 F-1 的 `assertReadable`,軸與 measure 皆過 | **P0** |
| P3 | 🔴 圖表匯出 / 內嵌分享繞過權限(Metabase 官方明文其 public question 不套用 RLS) | 匯出與分享各自重跑權限,不沿用已算好的聚合;R1 不做公開分享 | **P0** |
| P4 | `date_trunc` 表達式在 GROUPING SETS 中被 planner 拒絕(§0.3 陷阱 1) | 內層 subquery 先物化成具名欄;整合測涵蓋日期軸 | P1 |
| P5 | 欄軸高基數 → 欄位爆炸凍瀏覽器 | top-N ≤100 + 總格數 ≤20,000 + 明示截斷 | P1 |
| P6 | 前端轉置時稀疏格處理錯誤 → 數字錯位 | 以 (rowKeys, colKeys) 為鍵而非索引位置;單元測涵蓋稀疏矩陣 | P1 |
| P7 | ECharts SSR 的 CJK 字型問題 | 一律 client-only 渲染 | P1 |
| P8 | 圖表無 a11y → 企業採購受阻 | 開 `aria.enabled` + decal 紋理;圖表旁提供資料表切換 | P1 |
| P9 | 小圖表的可見群組設定被繞過 | widget 資料查詢與可見性判定在後端;前端不得只隱藏 | **P0** |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | v0.1 | M0 DRAFT。承 docs/25 §F 之 pivot(5)+ 圖表(4)+ 儀表板(4)。**兩路深度研究推翻原規劃兩個前提**:(a) **Ragic 的資料儀表板根本不可拖拉**(官方逐字「依據表單中的位置,從左到右、從上到下依序排列」),可拖曳的是**小圖表 widgets**,且首頁為受限直欄版面 → `docs/10` §131「拖拉排版」記載有誤需更正,拖拉式儀表板非 parity 必要項;(b) **業界一致回長表**,沒有一家回動態寬表(Metabase/Superset/Cube 原始碼),PG result set 1,664 欄為硬天花板。**最省的結論**:F-1 的 group-stats 只需改 grouping set 產生器(前綴 rollup → 兩組前綴笛卡兒積),RLS/交易/filter/聚合/截斷全部不動。**§0.5 洩漏面主角是維度值清單而非聚合值** —— CVE-2024-55951(Metabase filter values 跨 sandbox 快取共用)為直接可引之公開事件。圖表庫維持 ECharts(Apache-2.0 + a11y 一行開關 + 甘特/地圖一次補齊),但不用 `echarts-for-react`。OQ-PC-1..9 待裁定 | Claude Code |
