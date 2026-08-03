# views-group-kanban-calendar.md — [F-1] 分組 / 看板 / 行事曆檢視設計文件

| | |
|---|---|
| 狀態 | ✅ **SHIPPED v1.0(2026-07-30,M1→M5)** — OQ-VG-1..9 全採建議 |
| 建立 | 2026-07-29 |
| 上游 | docs/25 §F(分組 🟡 / Kanban ⬜ / Calendar ⬜)· [views-list](views-list.md) v1.0 之 P1 殘留 · docs/27 §3 P1 |
| 依賴 | views-list(view_def / filter / sort / keyset)· authz(RLS 記錄範圍 + 欄位級)· actions-approval(簽核鎖) |

---

## 1. 目標與範圍

### 1.1 為什麼是這一批

`docs/25` §226 的優先序原話:「以『讓既有 Ragic 客戶遷移』為 R1 目標,36% 的功能覆蓋撐不起遷移 —— **客戶第一週就會撞到通知與報表**」。
通知(H-1)與動態權限(E-1)已 SHIPPED,本批是清單上的下一項。

### 1.2 目標(P0)

1. **分組(group by)+ 群組小計** —— 列表檢視的擴充
2. **Kanban 看板** —— 依單一欄位分欄 + 拖曳改值
3. **Calendar 行事曆** —— 依日期欄呈現 + 拖曳改期

### 1.3 三者的關係(這決定了工程順序)

研究得到一個明確且可操作的結論:

- ✅ **Kanban 的 stack 就是 group-by 的一階特例** —— 同一套「單欄分組 + 每組計數 + 每組分頁」後端可完整共用
- ❌ **Calendar 不是 group-by** —— 它是**區間重疊查詢**(`start <= rangeEnd AND coalesce(end,start) >= rangeStart`),
  需要日期範圍索引與「一筆佔多格」的跨日展開;而 group-by 假設**一筆屬一組**

→ 故 M1 先建分組地基,M2 Kanban 直接吃它,Calendar 走獨立查詢路徑。

### 1.4 不做的事

- ❌ **樞紐分析(pivot)/ 圖表 / 儀表板** —— docs/25 另列(pivot 5 人月),非本批
- ❌ **Gallery / Timeline / Map 檢視** —— docs/27 §3 P2
- ❌ **重複事件(recurring events)** —— Ragic 亦無;RFC 5545 的 RRULE 是獨立題目
- ⏳ **Kanban 卡片手動排序** —— 見 OQ-VG-5,建議 P0 不做

---

## 0. 深度研究(2026-07-29)— 業界實證

> 專案 P0 規則:研究即寫入 doc,附來源連結並標注證據強度。
> ⚠️ **2026-08-03 更正(clean-room)**|原句「Baserow / NocoDB / Teable **皆 OSS**」**不正確**。
> 本專案自己的 `dynamic-permissions.md` §0.8 早**一天**(2026-07-28)就記下:
> **NocoDB 自 2026-01-29 起改 Sustainable Use License,已非 OSS**;Directus 同、
> Baserow enterprise 為專有、Teable `apps/` 為 AGPL → 該節明令「一律只讀公開文件與介面形狀,
> **不看實作原始碼**」(`AGENTS.md` 鐵則 5)。本檔 v0.1 於次日仍引用了
> `nocodb/src/db/BaseModelSqlv2/group-by.ts` 等實作路徑。
> **這不是「當時不知道」,是自家 repo 前一天就寫了而沒查**(巨人第一站)。
>
> **處置**|(a) Baserow(MIT/開源)與 Teable `packages/*`(MIT)之引用維持有效;
> (b) **NocoDB 之結論一律降級為「待以公開文件重新推導」**,在此之前不得作為承重依據;
> (c) 本模組已 SHIPPED,**尚未評估既有實作是否實質依賴該來源** —— 列入待辦,由決策方裁定
> 是「重新推導後確認結論不變」或「以公開文件重寫該節」。
>
> 原句意旨(原始碼證據強度高於行銷式描述)對**授權允許**的來源仍成立。
> ⚠️ **clean-room 邊界**:僅閱讀公開原始碼以理解「業界怎麼解這個問題」,不複製任何實作。

### 0.1 分組 × 分頁:三種真實做法

| 系統 | 機制 | 證據 |
|---|---|---|
| **Baserow** | 列照常分頁(依 group key 排序);**群本身以樹狀分頁,預設 40 群/頁、後代群上限 2000**。群計數對**未分頁 queryset** 另跑 count | 原始碼 `views/grid/utils.py`、`handler.py` |
| **NocoDB** | 真 SQL `GROUP BY` + `count(*)`,**limit/offset 套在「群」上**(bulkGroupBy `limitGroup` 25);組內記錄另發查詢 | 原始碼 `db/BaseModelSqlv2/group-by.ts` |
| **Teable** | Server 回**群骨架**(`Header{depth,value,isCollapsed}` + `Row{count}`);記錄用 **skip/take(offset)**,並把 **`collapsedGroupIds` 傳後端** | 原始碼 `packages/openapi/src/aggregation/*` |
| **Airtable** | 整 base 載入客戶端(靠 base 級 50k/125k/500k 記錄上限撐),分組與小計在完整資料上算 | 官方 plans 頁 |
| **Ragic** | 分群是**獨立報表引擎**,不是列表分頁 | [doc/92 分群報表](https://www.ragic.com/intl/zh-TW/doc/92/分群報表) |

**業界基準的反證(最有價值的一條)**|AG Grid 官方明載:
「**Infinite Row Model 不支援 aggregation / grouping,因為那需要知道整個資料集**」
([AG Grid Infinite Row Model](https://ag-grid.com/javascript-grid/infinite-scrolling/))。
本專案的 keyset 分頁正是 infinite model 的處境 —— 這句話直接點名了本模組的核心矛盾。

### 0.2 聚合一律在 DB 端算,且 Baserow 的原始碼註解是最誠實的證據

Baserow 原始碼註明「要計數的列可能落在分頁範圍外」,故群計數對 **base_queryset(未分頁)** 另跑;
且它**乾脆不做 per-group 小計**,只做 footer 全域小計 —— 因為要做對很貴。

> **推論**:任何「在前端對已載入的頁做加總」的實作都會給出**錯誤的數字**,而且錯得很安靜。
> 誠實標注:查不到具名的「小計只算當前頁」公開抱怨串,但 AG Grid 的 infinite-model 限制是同一問題的側證。

### 0.3 🔴 聚合與記錄級權限的洩漏 —— PG 有正解,但 Ragic 有現成的反面教材

**擔憂**:使用者只看得到自己的 3 筆,分組標頭卻顯示「已完成:47 筆」→ 洩漏了看不到的資料之存在與數量。

**PostgreSQL 層的正解**|官方明載 policy 運算式
「**evaluated for each row prior to any conditions or functions coming from the user's query**」
([PG Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html))
→ **`COUNT` / `SUM` 天然只算通過 RLS 的列**,不需另做事。

**但前提是**:用**同一個受 RLS 約束的 role、同一個 `SET LOCAL` 交易**。真正的洩漏路徑只有三條:
1. 用 `BYPASSRLS` 或高權限連線去算小計 ← **本 session 已三度踩到這一類**(app 車道回落特權連線)
2. 非 LEAKPROOF 運算子被 optimizer 提前套用,洩漏被過濾列的值
3. timing side channel

**🔴 Ragic 的現成反面教材**|官方寫「分析結果只包含該使用者有權限瀏覽的資料」,
**但同頁警告「報表快照以系統管理員權限產生,可能包含檢視者無權存取的資料」**
—— **快取 / 快照就是那個洞**。這是明確的競爭切入點,也是本模組必須避開的形狀。

> 若威脅模型連「存在 47 筆」都不可洩漏,業界成方是 **aggregation threshold / k-anonymity**
> ([BigQuery analysis rules](https://cloud.google.com/bigquery/docs/analysis-rules));本專案 R1 不需要,列 P2。

### 0.4 分組的邊界情況

| 議題 | 業界行為 |
|---|---|
| **多選欄分組** | **最大分歧**:Airtable = 依「值組合」成一組(記錄只屬一組,社群長期抱怨);Ragic = **有「多選欄位值分開分群」選項**(一筆進多組) |
| 日期粒度 | 只有 Ragic 原生支援(每日/月/年);Airtable 要繞 `DATETIME_FORMAT` 公式欄 |
| 空值 | Baserow `(Empty)` 獨立群;Airtable/Notion 可「隱藏空群」 |
| 層數 | Airtable 3 · Teable 3(原始碼 `depth.max(2)`)· Baserow 5 · **Notion 2**(group + sub-group) |

⚠️ **`unnest` 的陷阱**:多選欄若拆值分組,記錄會被**重複計數**,**`SUM` 不可加總**(同一筆會被加多次)。

### 0.5 Kanban:分欄型別與拖曳語意

| 系統 | 可分欄型別 | 多選 | 無值 | 證據 |
|---|---|---|---|---|
| **Airtable** | 單選 / 使用者 / 連結記錄(限單筆) | ❌ 官方明載須單選「確保一筆只屬一欄」 | Uncategorized | 官方 |
| **Baserow** | **僅單選** | ❌ | Uncategorized 欄,**拖進去 = 清空值** | 官方 |
| **NocoDB** | **僅 SingleSelect** | ❌ | Uncategorized 固定 index 0 | 原始碼 + issue #6184 |
| **Notion** | 近乎全型別(數字可設**區間級距**、日期可按日/週/月/年) | ✅ | 「No X」群組 | 官方 |
| **Teable** | 除附件/按鈕外多數;**computed 欄不可拖** | 未載 | 隱藏空 stack | 官方 |

→ **多選分欄業界近乎沒人做**;唯一走「全型別 + 數字區間」的是 Notion。

**🔴 拖曳寫入 —— Jira 是最有紀錄的反面教材**

| 面向 | 實證 |
|---|---|
| 寫入時機 | 全部**立即寫、無確認**(Teable / Baserow 官方明載) |
| 失敗 | 樂觀 UI 先移動 → 失敗**彈回原位**。**Jira 的卡片彈回且常無明確錯誤訊息**,Atlassian KB 還把「排序失敗」與「狀態轉換失敗」列為兩種不同原因([Atlassian KB](https://support.atlassian.com/jira/kb/unable-to-drag-and-drop-to-reorder-issues-on-a-kanban-board-in-jira/)) |
| 並發 | 普遍 **last-write-wins、無記錄鎖**。**查不到任何表單資料庫在拖曳 API 上做顯式樂觀鎖的官方文件** |
| 靜默失敗抱怨 | ✅ Airtable Interface kanban「拖了彈回、無變化、無提示」(社群) |

> **本專案的機會**:既有 `PATCH record` 已有 `expectedVersion` 樂觀鎖 + 欄位級 + RLS + 簽核鎖四層。
> 拖曳只要走同一條路,就**天然優於業界的 LWW**,代價僅是「要把失敗訊息說清楚」。

**卡片順序**|Trello = `pos` 64-bit double 取前後平均(過近觸發重編號)· Baserow = 高精度 decimal + `before_id` move API ·
Figma / Linear = **fractional indexing**(字串任意精度)+ 週期 rebalance · Airtable = **有排序就依排序、「Keep sorted」開啟即禁手動排**。

### 0.6 Calendar:時區是經典坑,RFC 5545 是權威錨

| 系統 | 時區處理 | 結果 |
|---|---|---|
| **Airtable** | 內部存 GMT;date 欄可勾「所有協作者用同一時區」,**不勾即依瀏覽器** | **經典差一天**(官方 Timezones and Locales + 多起社群案例) |
| **Baserow** | 預設 UTC,**時區設在欄位層非檢視層** | 所有檢視一致 |
| **Notion** | — | 大量「-1 天」抱怨(社群) |

**權威錨**([RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545)):
- 全天事件用 `VALUE=DATE`、**無時區(floating)**
- `DTEND` **排他(exclusive)**

[Google Calendar API](https://developers.google.com/workspace/calendar/api/concepts/events-calendars) 同構:
`timeZone` 對全天事件無意義、end 需 +1 天。PostgreSQL 對應:全天用 `date`、有時刻用 `timestamptz`
([PG 官方](https://www.postgresql.org/docs/current/datatype-datetime.html)、[Don't Do This](https://wiki.postgresql.org/wiki/Don't_Do_This))。

**載入慣例**|[FullCalendar](https://fullcalendar.io/docs/events-json-feed):依可見範圍帶 `start`/`end`(ISO8601)+ `timeZone`,`lazyFetching` 預設 true。
**每日上限**|Airtable date height 展開上限 **1000 筆/日**、compact 顯示 `+2 more`;NocoDB 亦為 `+N more`。

### 0.7 誠實聲明:查不到的

- Airtable kanban 每 stack 的載入筆數與 stack 數上限(官方未載)
- 任何主流產品在拖曳 API 上做**顯式樂觀鎖**的官方文件(全是 LWW)
- Notion / Teable 欄內卡片順序如何持久化
- Airtable calendar 官方頁**完全未提時區**
- 具名的「群組小計只算當前頁」公開抱怨串

### 0.8 來源

分組|[Baserow group rows](https://baserow.io/user-docs/group-rows-in-baserow) · [Baserow footer aggregation](https://baserow.io/user-docs/footer-aggregation) · [Baserow 原始碼 views/grid/utils.py](https://github.com/baserow/baserow/blob/develop/backend/src/baserow/contrib/database/api/views/grid/utils.py) · [NocoDB group-by 原始碼](https://github.com/nocodb/nocodb/blob/develop/packages/nocodb/src/db/BaseModelSqlv2/group-by.ts) · [Teable get-group-points](https://github.com/teableio/teable/blob/develop/packages/openapi/src/aggregation/get-group-points.ts) · [Airtable grouping](https://support.airtable.com/docs/grouping-records-in-airtable) · [Notion views/filters/sorts](https://www.notion.com/help/views-filters-and-sorts) · [Ragic doc/92 分群報表](https://www.ragic.com/intl/zh-TW/doc/92/分群報表) · [Ragic doc/9 報表](https://www.ragic.com/intl/zh-TW/doc/9/reports)
分頁基準|[AG Grid SSRM grouping](https://www.ag-grid.com/javascript-data-grid/server-side-model-grouping/) · [AG Grid row pagination](https://www.ag-grid.com/javascript-data-grid/row-pagination/) · [AG Grid infinite model](https://ag-grid.com/javascript-grid/infinite-scrolling/)
權限×聚合|[PG Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) · [pganalyze RLS / LEAKPROOF](https://pganalyze.com/blog/5mins-postgres-row-level-security-bypassrls-security-invoker-views-leakproof-functions) · [BigQuery aggregation threshold](https://cloud.google.com/bigquery/docs/analysis-rules) · [Salesforce sharing](https://help.salesforce.com/s/articleView?language=en_US&id=platform.managing_the_sharing_model.htm&type=5)
Kanban|[Airtable kanban](https://support.airtable.com/docs/getting-started-with-airtable-kanban-views) · [Teable kanban](https://help.teable.ai/en/basic/view/kanban) · [Baserow kanban](https://baserow.io/user-docs/guide-to-kanban-view) · [NocoDB kanban](https://nocodb.com/docs/product-docs/views/view-types/kanban) · [nocodb#6184 分欄型別](https://github.com/nocodb/nocodb/issues/6184) · [nocodb#7537 Uncategorized bug](https://github.com/nocodb/nocodb/issues/7537) · [Atlassian:拖曳失敗排查](https://support.atlassian.com/jira/kb/unable-to-drag-and-drop-to-reorder-issues-on-a-kanban-board-in-jira/) · [Airtable sorting / Keep sorted](https://support.airtable.com/docs/sorting-records-in-airtable-views)
排序|[Trello pos 為 64-bit float](https://news.ycombinator.com/item?id=10957165) · [Figma realtime ordered sequences](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/) · [Fractional indexing](https://observablehq.com/@dgreensp/implementing-fractional-indexing)
Calendar|[RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545) · [Google Calendar API events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars) · [Airtable timezones and locales](https://support.airtable.com/docs/timezones-and-locales) · [Baserow timezones](https://baserow.io/user-docs/working-with-timezones) · [Airtable calendar](https://support.airtable.com/docs/getting-started-with-airtable-calendar-views) · [NocoDB calendar](https://nocodb.com/docs/product-docs/views/view-types/calendar) · [FullCalendar lazyFetching](https://fullcalendar.io/docs/lazyFetching)

---

## 2. 現況走查

| 項目 | 現況 | 本批需要 |
|---|---|---|
| `view_def.config` | ✅ JSONB(fields/filter/sorts/search/pageSize) | 加 `group` / `kanban` / `calendar` 子物件(**加法,零 migration**)|
| filter / sort 白名單解析 | ✅ 型別感知 operator + metadata 白名單 | 直接複用 |
| keyset 分頁 | ✅ 複合 cursor(#95 修過 NULLS LAST + 混合方向) | **擴充**:group key 前置進排序鍵 |
| 聚合能力 | ❌ **完全沒有**(無 count / 無 sum) | 從零建 |
| RLS 記錄範圍 | ✅ RESTRICTIVE policy(E-1) | 聚合必須跑在同一 role / 同一交易 |
| 欄位級 hidden | ✅ `maskRead` | **分組欄與聚合欄都必須先過白名單** |
| 樂觀鎖 | ✅ `expectedVersion`(record.service) | Kanban 拖曳直接用 |
| 簽核鎖 | ✅ `ApprovalLockInterceptor` | 拖曳天然受管 |
| 租戶時區 | ✅ `tenants.timezone` | Calendar 分桶依據 |
| 前端網格 | ✅ Glide Data Grid(集合視圖) | 分組需 header 列 |

---

## 4. 設計要點

### 4.1 🔴 分組 = 排序的變形,不是聚合查詢(本模組的核心決斷)

AG Grid 說「infinite model 不支援 grouping」是對的 —— **前提是把分組理解成「先聚合再展開」**。
若改成「**分組只是把 group key 前置到排序鍵**」,keyset 就能完整保留:

```sql
-- 列表查詢本身幾乎不變,只是排序鍵前面多了 group key
ORDER BY g1, g2, g3, <使用者排序鍵…>, id
-- cursor 編成複合值 (g1, g2, g3, s1, …, id) —— 承 #95 已建立的複合 cursor 機制
```

「第 2 頁」= 扁平序列的下一段(等同 AG Grid 的 `paginateChildRows=true` 語意);
**分組純粹是前端在邊界插 header 列**。

> **不採 offset**:Teable 能用 offset 是因為它先把整個群骨架算好;本專案已有可靠的複合 cursor,
> 退回 offset 等於放棄 #95 修好的東西。

### 4.2 兩個 endpoint,一份 filter 編譯器

```
GET  /forms/:id/records            ← 既有,keyset,不變(只是 sorts 前面多 group key)
POST /forms/:id/records/group-stats ← 新增:吃同一份 filter/search/groupBy,回每組 count 與聚合
```

- 多層小計用 **`GROUPING SETS` / `ROLLUP` 一次查完所有層級**,不要每層一條查詢
- **絕不在前端對已載入頁加總**(§0.2 的教訓)
- 🔴 **兩者必須跑在同一 tenant 交易 / 同一 RLS role** —— 這是唯一會真洩漏的路徑,
  且**本 session 已三度踩到「特權連線遮蔽權限」**(RLS 假綠、`action_audit` 缺 grant、`approval_instance` 走錯車道)。
  故直接寫成測試斷言:**A 建 47 筆,B 的 group-stats 必須回 3**。

### 4.3 折疊必須傳到後端

`collapsedGroups` → rows 查詢加排除條件。否則折疊只是前端隱藏、照樣吃掉 page size,
使用者會看到「明明折疊了卻出現空白頁」。承 Teable 的 `collapsedGroupIds` 語意。

### 4.4 Kanban:stack = 單欄 group-by + 拖曳走既有 PATCH

**不開任何後門**。拖曳走既有 `PATCH /records/:id`,天然吃到四層防護:
`expectedVersion` 樂觀鎖 · `assertWritable` 欄位級 · RLS 記錄級 · `ApprovalLockInterceptor` 簽核鎖。

**失敗必須具名**(Jira 的坑,§0.5):前端樂觀移動 → 失敗**彈回 + 具名 toast**,至少三種訊息:
- 「無權修改此欄位」
- 「此記錄簽核中,不可異動」
- 「已被他人改動,請重新整理」

**禁拖的情況**:stacking 欄為 `formula` / `rollup` / `lookup` / `autoNumber` 等 computed 型別時,UI 直接禁止(比照 Teable)。
拖曳請求帶 idempotency key(既有機制)。

### 4.5 Calendar:時區三態明確化

| 欄型 | 儲存 | 「屬於哪一天」的判定 |
|---|---|---|
| `date` | PG `date` | **無時區**(RFC 5545 floating);查詢直接 `date` 比較,**任何路徑禁 timestamptz cast** |
| `dateTime` | PG `timestamptz` | 一律 `AT TIME ZONE tenants.timezone` 分桶 —— **不是瀏覽器時區** |

- API 請求與回應都顯式帶 `timeZone`(FullCalendar 慣例)
- 月份查詢用**半開區間 `[start, end)`**,end 排他(RFC 5545 / Google Calendar API 同構)
- 每日顯示上限 + `+N more`(對齊 Airtable / NocoDB)

### 4.6 已知陷阱(來自研究,逐條對應緩解)

| 陷阱 | 緩解 |
|---|---|
| 多選欄 `unnest` 分組 → 記錄重複計數、**`SUM` 不可加總** | OQ-VG-2:v1 只做「值組合」分組(對齊 Airtable);要拆值需明確標示小計語意 |
| `NULL` 自成一組時,`ORDER BY NULLS FIRST/LAST` 與群排序方向不一致 → `(Empty)` 群被切成兩段 | 群排序與 NULL 位置一併決定,寫成測試 |
| 群數爆炸(高基數欄位分組) | OQ-VG-8:群數上限 + 複合索引 `(g1,g2,g3,id)` |
| 欄位級 hidden 的欄位被拿來分組 → **group header 的值本身即是資料**,比小計更早洩漏 | 分組欄必須先過 `maskRead` 白名單;Baserow 對 public view 即用 `allowed_field_ids` 擋 |
| 未來做「報表快照 / 匯出」重蹈 Ragic 覆轍 | 快照須記錄產生者權限並在**檢視時重新授權**;本批不做快照 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 分組地基(後端)** | group key 前置進排序鍵 + 複合 cursor 擴充 · `group-stats` endpoint(GROUPING SETS)· 折疊排除 · 白名單/RLS 斷言測試 | 0.10 mo |
| **M2 分組(前端)** | 列表 header 列 + 折疊 + 小計顯示 + 分組設定 UI | 0.08 mo |
| **M3 Kanban** | stack = 單欄 group-by(共用 M1)+ 卡片 + 拖曳 PATCH + 三種失敗訊息 + 禁拖判定 | 0.10 mo |
| **M4 Calendar** | 區間查詢 endpoint(獨立路徑)+ 月/週檢視 + 時區分桶 + 拖曳改期 + `+N more` | 0.10 mo |
| **M5 收尾** | FMEA + Playwright 固化 + doc v1.0 + MODULES + docs/25 回填 | 0.04 mo |

**合計 ≈ 0.42 mo**。前後端分開 commit。

---

## 10. 開放問題(OQ-VG-N)— ✅ **已裁定 2026-07-30(全採建議)**

裁定結果:1=A(排序變形 + 複合 cursor)· 2=A(值組合)· 3=A(3 層)· 4=A(7 個聚合函數)·
5=A(P0 不做手動排序)· 6=A(單選 + member)· 7=A(單一日期欄 + 選填結束欄)· 8=A(2000 群 / 40 群一頁)· 9=A(三者一批,各自 commit)

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-VG-1** ⭐⭐ | 分組與分頁的模型 | A. **group key 前置進排序鍵 + 複合 cursor**(扁平序列)<br>B. 群骨架 + 組內 offset(Teable)<br>C. 群本身分頁(Baserow / NocoDB) | **A** — 本專案已有 #95 修好的複合 cursor,B/C 都要退回 offset 或另建群分頁機制。A 的代價是「無法直接跳到第 N 組」,但那不是 Ragic 客戶的既有心智(Ragic 分群是報表不是列表)。**證據**:AG Grid `paginateChildRows` 即此語意 |
| **OQ-VG-2** ⭐ | 多選欄分組語意 | A. **依「值組合」成一組**(記錄只屬一組,Airtable)<br>B. 拆值,一筆進多組(Ragic)<br>C. 不支援多選分組 | **A** — B 會讓記錄**重複計數且 `SUM` 不可加總**(§0.4),語意需要一整套額外說明才不誤導;C 則比 Ragic 弱。A 先上,B 列 P1 並在 UI 明示小計語意。**代價**:與 Ragic 行為不同,遷移時需說明 |
| **OQ-VG-3** ⭐ | 分組層數上限 | A. **3 層**(Airtable / Teable)<br>B. 1 層<br>C. 5 層(Baserow) | **A** — 3 層是業界收斂值(Airtable 3 / Teable 原始碼 `depth.max(2)` / Notion 2);`GROUPING SETS` 一次查完不隨層數線性增加查詢數。5 層在 UI 上已不可讀 |
| **OQ-VG-4** | 聚合函數範圍 | A. **count / empty / filled / sum / avg / min / max**<br>B. 只 count<br>C. 全套 20 種(Teable) | **A** — count 類是分組的最低要求;sum/avg 對「訂單金額依客戶分組」這種真實場景是必要的。中位數 / 標準差等留 P1 |
| **OQ-VG-5** ⭐ | Kanban 卡片手動排序 | A. **P0 不做**,依 `view_def.sorts` 排(Airtable「有排序即依排序」)<br>B. P0 即做 fractional index + 側表 | **A** — B 要背上 rebalance 成本與 per-view 順序側表;而**卡片順序不是 Ragic 客戶的既有心智**(Ragic 無 Kanban)。P1 再上側表 `record_view_order`,**不新增使用者可見欄位**(順序是表現層,塞進 Tier-2 動態表會污染使用者 schema) |
| **OQ-VG-6** | Kanban 分欄型別 | A. **單選 + 使用者(member)**<br>B. 只單選(Baserow / NocoDB)<br>C. 近乎全型別 + 數字區間(Notion) | **A** — 單選是業界共同底線;member 額外開放的理由是本專案剛做完 E-1「指派即授權」,「依負責人看板」是直接的真實用途。C 的數字區間需要另一套級距 UI,列 P1 |
| **OQ-VG-7** | Calendar 日期範圍 | A. **單一日期欄 + 選填結束欄**<br>B. 只單一日期欄<br>C. 多組日期欄(Airtable 付費功能) | **A** — 結束欄是「請假單 / 專案期間」的基本需求,且 PG 區間查詢一次寫好即涵蓋兩種;C 的多組日期欄連 Airtable 都列為付費 |
| **OQ-VG-8** | 群數 / 每組筆數上限 | A. **群數 2000、每頁 40 群**(對齊 Baserow),超過明示提示<br>B. 不設限 | **A** — 高基數欄位分組會直接產生數萬群;不設限等於把瀏覽器打死。**誠實訊息不靜默截斷**(承 views-list 匯出慣例) |
| **OQ-VG-9** ⭐ | 本批範圍 | A. **三者一批**(分組 → Kanban → Calendar)<br>B. 先分組 + Kanban,Calendar 另批 | **A** — Kanban 共用分組地基,Calendar 雖是獨立查詢路徑但共用 view_def / 權限 / 拖曳語意;三者同屬 docs/25 §F 的「客戶第一週會撞到」清單。**風險**:一批較大,故 M1–M5 各自 commit,任一里程碑可獨立回退 |

---

## 4.7 落地結果(2026-07-30)

| 里程碑 | 內容 | 結果 |
|---|---|---|
| **M1** | group key 前置排序 + 複合 cursor 擴充 · `group-stats`(GROUPING SETS)· 折疊排除 · 租戶時區 GUC | ✅ 11 條整合測 |
| **M2** | 分組面板(≤3 層 + 日期粒度)· 分組清單呈現 · 小計顯示 | ✅ |
| **M3** | Kanban(共用 M1 統計)· 拖曳走既有 PATCH · 三類具名錯誤 · computed 欄禁拖 | ✅ |
| **M4** | 行事曆區間查詢(獨立路徑)· 月檢視 · 跨日展開 · `+N 筆` | ✅ 6 條整合測 |
| **M5** | e2e 3 條固化 · FMEA 回填 · docs/25 覆蓋率重算 | ✅ |

**驗證**|api 583 + web 87 + e2e 3 全綠。實走:分組三組計數正確、折疊後列數 5→3 而標頭與「2 筆」仍在、
看板拖曳「甲」新單→已完成 DB 實際寫入且欄位計數同步、行事曆跨月假在 7 月佔 4 格 / 8 月佔 2 格。

### 🔴 實走揪出的既有 P0(與本模組無關,但由本模組浮現)

`choicesOf` 只收字串,而 **#105 已把 `options.choices` 改成 `{id,name}` 物件** ——
**填單的單選/多選下拉、篩選面板、看板分欄全部拿到空清單**,使用者根本選不了值。
型別上是 `unknown`,所以它靜默通過了型別檢查與當時的全部測試;直到看板的欄位生不出來才浮現。
已相容兩種形狀並排除 `retired` 選項,補四條迴歸測試(反向驗證過)。

> 這是本 session 第 N 次「**舊讀取端沒跟上新寫入端**」:同類還有 member 欄在送出邊界被字串分支丟掉(#96)。
> 共同結構:**型別標為 `unknown` 的邊界,改了一端不會有任何提示**。

### 設計上與 M0 的偏離(有理由)

M0 §4.1 假設分組會在既有的 Glide 網格上插 header 列。實作改為**分組時切換到可讀清單**:
canvas 網格插入非資料列需自行維護「行號 ↔ 記錄索引」映射,折疊時還要重算 ——
那是 Teable 為了在 canvas 上做分組而付的代價(其 server 因此要回 group points 骨架)。
分組情境下使用者要的是看結構而非編儲存格,故把網格留給未分組的預設檢視,P0 不背這個複雜度。

---

## 12. 失效場景反思(FMEA)— pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| G1 | 🔴 **群組小計以特權連線計算 → 洩漏使用者看不到的記錄數量**(Ragic 快照即此形狀) | 聚合與列表跑**同一 RLS role / 同一交易**;測試斷言「A 建 47 筆,B 的 group-stats 回 3」 | **P0** |
| G2 | 🔴 **hidden 欄位被拿來分組** → group header 的值即是資料,比小計更早洩漏 | 分組欄先過 `maskRead` 白名單,查無即拒 | **P0** |
| G3 | **小計只算已載入頁** → 數字錯且錯得安靜 | 聚合一律 DB 端算;前端不得對已載入資料加總(以 code review + 測試斷言頁大小改變不影響小計) | **P0** |
| G4 | Kanban 拖曳失敗**靜默彈回**(Jira 的坑) | 三種具名錯誤訊息;computed 欄禁拖 | **P0** |
| G5 | 拖曳繞過簽核鎖 / 欄位級權限 | 走既有 `PATCH record`,不開新路徑 —— **本 session 已四度出現「新路徑天然不受橫切防護」** | **P0** |
| G6 | Calendar 時區導致**日期差一天**(Airtable / Notion 的經典抱怨) | `date` 欄無時區、`dateTime` 依租戶時區分桶;半開區間;寫跨時區測試(UTC+8 邊界) | **P0** |
| G7 | 高基數欄位分組 → 群數爆炸打死瀏覽器 | 群數上限 + 誠實提示 + 複合索引 | P1 |
| G8 | 多選欄拆值分組 → 重複計數、SUM 錯誤 | v1 採值組合語意(OQ-VG-2) | P1 |
| G9 | `(Empty)` 群因 NULLS 排序方向不一致被切成兩段 | 群排序與 NULL 位置一併決定並測試 | P1 |
| G10 | 折疊未傳後端 → 折疊後仍吃 page size,出現空白頁 | `collapsedGroups` 進查詢條件 | P1 |

---

### 12.2 實作後回填(2026-07-30)

| # | 結果 |
|---|---|
| G1 小計洩漏 | ✅ 聚合與列表同一 RLS role/同一交易;測試斷言「ALICE 建 7 筆、BOB 建 3 筆 → BOB 的 group-stats 回 3」。**已反向驗證** |
| G2 隱藏欄分組 | ✅ 分組鍵與聚合欄皆先過 `assertReadable`。**已反向驗證** |
| G3 小計只算當前頁 | ✅ 測試斷言 page size 2 與 50 的小計數字相同 |
| G4 拖曳靜默彈回 | ✅ 三類具名訊息(簽核中 / 已被他人改動 / 後端原訊息);computed 欄禁拖並明示 |
| G5 拖曳繞過橫切防護 | ✅ 走既有 `PATCH record`,不開新路徑 |
| G6 行事曆差一天 | ✅ `date` 無時區、`dateTime` 依租戶時區;UTC+8 邊界測試(2026-02-10T23:00Z → 台北 2/11)。**已反向驗證** |
| G7 群數爆炸 | ✅ 上限 2000 + 明示截斷訊息 |
| G8 多選拆值重複計數 | ✅ 採值組合語意(OQ-VG-2),未做拆值 |
| G9 `(Empty)` 群被切兩段 | ✅ 測試斷言空值群位置連續 |
| G10 折疊未傳後端 | ✅ 實走驗證折疊後列數下降而標頭計數不變 |

**殘留**|(a) Kanban 卡片手動排序未做(OQ-VG-5=A 之裁定,P1 再上 `record_view_order` 側表);
(b) 分組僅在列表模式,記錄模式不受影響;(c) 行事曆僅月檢視,週/日檢視列 P1;
(d) 多選欄拆值分組列 P1。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-30 | **v1.0 SHIPPED** | M1→M5 落地(§4.7)。**核心決斷成立**:分組作為排序變形,keyset 完整保留、無需退回 offset。Kanban 完整共用分組地基,Calendar 走獨立區間路徑。FMEA G1–G10 全數緩解,其中 G1/G2/G6 已反向驗證。**實走揪出既有 P0**:`choicesOf` 未跟上 #105 的選項物件化 → 填單下拉/篩選/看板分欄全空(§4.7)。設計上偏離 M0 一處:分組不在 Glide 網格插 header 列而改用可讀清單,理由見 §4.7。api 583 + web 87 + e2e 3 全綠 | Claude Code |
| 2026-07-29 | v0.1 | M0 DRAFT。承 docs/25 §226 優先序(通知 / 動態權限已 SHIPPED,本批為下一項)。**兩路深度研究,多條結論取自競品原始碼**(Baserow / NocoDB / Teable 皆 OSS)。**核心決斷**:分組是**排序的變形**而非聚合查詢 → keyset 可完整保留(AG Grid 明載 infinite model 不支援 grouping,前提是把分組理解成先聚合再展開)。**Kanban 的 stack = group-by 的一階特例可共用地基;Calendar 不可共用**(區間重疊查詢)。**§0.3 查明聚合 × RLS**:PG 官方明載 policy 先於 user query 求值 → COUNT/SUM 天然只算可見列,唯一洩漏路徑是特權連線 —— 而**本 session 已三度踩到該類**;Ragic 官方自承「報表快照以管理員權限產生」即現成反面教材。OQ-VG-1..9 待裁定 | Claude Code |
