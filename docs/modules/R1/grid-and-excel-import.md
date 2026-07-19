# grid-and-excel-import.md — [P0-2] 網格主檢視 + Excel 建表 onboarding 設計文件

> ✅ **狀態:APPROVED — OQ-GEI-1..7 全採建議(2026-07-19 裁定),進 M1**
>
> P0-2 兩大招牌:**(1) Excel-like 網格主檢視**(Glide canvas,可直接改格 —— Ragic 用戶最熟悉的操作面)+ **(2) 用既有 Excel 建表 onboarding**(上傳 xlsx → 推斷欄位 → 生成表單 + 灌入資料),docs/10 標「Ragic 差異化 onboarding 神器」。上游 = form-engine-core v1.0(引擎 API)+ form-designer-ui v1.0(client 層 / builder)+ packages/ui `GridSheet`(Glide 封裝已備)。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-19)

---

## 1. 目標與範圍

### 1.1 目標

1. **網格檢視可讀**:表單記錄以 Glide canvas 網格呈現(欄=欄位、列=記錄),大量列滑順(canvas 虛擬化)。
2. **網格可直接編輯**:點格改值 → 存回(updateRecord 樂觀鎖);新增列 → createRecord。Ragic 式「像 Excel 一樣填」。
3. **用 Excel 建表**:上傳 .xlsx → 讀首列為欄名 + 推斷型別 → 預覽可調 → 一鍵生成表單(createForm)+ 批次灌入資料列(bulk)。
4. **批次寫入原子性**:Excel 匯入之資料列一次交易灌入(部分失敗全 rollback + 明確錯誤)。
5. **走通即固化**:上傳範例 xlsx → 建表 → 網格檢視 → 改格 之 golden path 進 Playwright CI。

### 1.2 對應 Stakeholder 訴求

| 子題 | 主要訴求 | 次要訴求 | 對應點 |
|---|---|---|---|
| A1 bulk 寫入 API | ③ 遷移場景 | ② | Excel 千列一次灌;單一 tx |
| A2 網格檢視(唯讀→編輯) | ② docs/24 「主要畫面=可編輯網格」 | ① | Ragic 核心操作面;取代 mockup grid 示意 |
| A3 Excel-to-form onboarding | ③ 既有客戶遷移 land | ① Ragic 招牌 | 貼舊 Excel → 秒建表 + 帶資料,零重建 |
| A4 型別推斷 | ③ | — | 減少手動設欄位;客戶感受「它懂我的表」 |
| A5 固化 | AGENTS 前端鐵則 | — | MCP 探索 → Playwright spec |

### 1.3 不做的事

- ❌ **不做 pivot 樞紐 / master-detail**(P0-2 進階,docs/13;列 P1-I 或後續模組)
- ❌ **不做 Excel 匯出 / 列印**(後續;本模組只做匯入)
- ❌ **不做 Kanban / Calendar / Map 視圖**(P0-2 其餘視圖,另立)
- ❌ **不做 List(TanStack Table)視圖**(FDU 已有「資料」表格檢視;本模組以 grid 為主,list 沿用或 P1-I 補)
- ❌ **不做公式 / Link 欄在網格內即時算**(P0-3)
- ❌ **不改 form-engine-core 型別系統**(沿用 15 型別;Excel 推斷只映射到現有型別)
- ❌ **不做匯入既有表單(append into existing form)**(本模組只做「Excel → 新表單」;匯入到既有表 = OQ-GEI-6 遞延)
- ❌ **不做 auth**(沿用 DevTenantGuard)

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| Glide 封裝 | ✅ `packages/ui GridSheet`(canvas + token theme + onCellEdited)| 需接引擎 records:欄→GridColumn、記錄→getCell、cell edit→updateRecord |
| 記錄 API | ✅ list / query(cursor 分頁)/ get / **update(樂觀鎖)** / create / saveWithLines | **無 bulk 建立**(Excel 匯入需要;見 A1)|
| client 層 | ✅ engine client + hooks(FDU M1)| 加 useUpdateRecord / useBulkCreate |
| Excel 解析 | ❌ 無 xlsx 套件 | 需選型(OQ-GEI-3;SheetJS `xlsx` 純前端解析)|
| mockup grid | `/app/_components/po-grid-view.tsx`(Glide + 靜態 fx 資料)| 視覺基準;本模組出真 grid,mockup 標「示意」|
| 型別 registry | ✅ 15 型別 + 前端 field-types meta | 推斷邏輯映射到此子集(text/number/money/date/singleSelect…)|

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 估算 |
|---|---|---|
| **A1 bulk 建立 API**(後端)| `POST /api/forms/:formId/records/bulk`(≤N 列單一 tx;每列同 validateValues;回成功數 + 失敗列索引)+ per-tenant 列數上限 | ~3 天 |
| **A2 網格檢視(Glide 接引擎)**| records → GridColumn(依欄位型別對映 cell kind)+ getCell(值格式化)+ **cell edit → updateRecord**(樂觀鎖 409 提示)+ 新增列 + 分頁/lazy(見 OQ-GEI-2)| ~1.5 週 |
| **A3 Excel-to-form**|上傳 xlsx → 解析(首列欄名 + 資料)→ **型別推斷**(A4)→ 預覽表(可改欄名/型別/略過欄)→ createForm + bulk 灌資料 → 開新表單網格 | ~1.5 週 |
| **A4 型別推斷 heuristic**|逐欄取樣 → 判 number/money/date/dateTime/checkbox/singleSelect(低基數)/text;信心不足 fallback text | ~3 天 |
| **A5 測試 + 固化**|bulk API 整合測試(原子性/部分失敗/租戶)+ 推斷單元測 + Playwright(上傳→建表→網格改格)| ~4 天 |

**合計** ≈ **4.5–5 週純 focus**。

---

## 4. 關鍵設計

### 4.1 A1|bulk 建立(後端)

- `RecordService.createManyRecords(tenantId, formId, rows[], actorId)`:單一 `inTenantTx` → 逐列 validateValues + insert;任一列驗證/寫入失敗 → throw → 整批 rollback(回失敗列 index + 原因);autoNumber 每列取號。
- 上限:`rows.length ≤ 5000`(超出分批由前端多次呼叫;避免單 tx 過大鎖表)。
- controller `POST .../records/bulk` body `{ rows: {values}[] }` → `{ created: number }`;錯誤走既有信封(422 帶失敗列)。

### 4.2 A2|網格(Glide 接引擎)

- 欄位型別 → Glide cell kind:text/longText/email/url/phone → Text;number/percent/money → Number(money 顯示字串,edit 收字串);date/dateTime → Text(自訂格式;Glide date cell 為 P1-I);checkbox → Boolean;singleSelect → Text(dropdown overlay P1-I);autoNumber/system → 唯讀 Text。
- **編輯**:onCellEdited(col,row,value)→ 解析成 field + record → `updateRecord(recordId, expectedVersion, {fieldName: value})`;成功後 patch 快取,失敗(409)提示重載。stub/autoNumber 欄唯讀(拒編輯)。
- **資料源**:useRecords 取一頁(見 OQ-GEI-2);rowCount = 已載入數(+ lazy 載更多)。
- **新增列**:底部 trailing row → createRecord。

### 4.3 A3|Excel-to-form onboarding

- 上傳 .xlsx(≤ 合理大小)→ 前端解析(OQ-GEI-3)→ 取工作表首列為欄名、其餘為資料。
- **預覽 / 校正 UI**:表格顯示推斷結果(欄名 + 推斷型別 + 前幾列樣本);使用者可改欄名、改型別(限可建型別)、勾選略過欄、設必填。
- **送出**:createForm(校正後 spec)→ ready → bulk 灌資料(略過欄不送;型別轉換複用 toSubmitValue)→ 開新表單網格。
- 空欄名 / 重複欄名 → 自動命名(欄1、欄2)或提示改。

### 4.4 A4|型別推斷 heuristic(逐欄取樣前 ~50 列非空值)

| 判定序 | 條件 | → 型別 |
|---|---|---|
| 1 | 全 `true/false/是/否/Y/N` | checkbox |
| 2 | 全符合日期時間格式(含時分)| dateTime |
| 3 | 全符合日期格式 | date |
| 4 | 全數值 + 有貨幣符號 / 兩位小數樣態 | money |
| 5 | 全數值 | number |
| 6 | 相異值 ≤ min(10, 列數×0.3)且列數足 | singleSelect(相異值為 choices)|
| 7 | 其餘 | text |

> 推斷為輔助,使用者於預覽可覆寫;信心邊界 case 一律保守 fallback text(可改不可壞)。

---

## 7-bis. cross-cutting(節錄)

- **安全**:xlsx 前端解析(不上傳原檔至後端,除非 OQ-GEI-3=B);bulk 值全走 validateValues + 參數綁定(繼承引擎防線);列數上限防 DoS;租戶綁定。
- **失效**:bulk 部分失敗全 rollback + 回失敗列;網格 cell edit 409 樂觀鎖提示;大檔解析於 worker 或限大小避免凍 UI。
- **效能**:網格 canvas 虛擬化(Glide 本就支援);bulk 分批;網格 cell edit debounce/單筆即存。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Vitest(api)| bulk 原子性(部分失敗全 rollback)/ 列數上限 / autoNumber 每列取號 / 租戶隔離 | `apps/api/test/` Testcontainers |
| Vitest(web)| 型別推斷 heuristic(各型別樣本)/ xlsx 解析純函式 / cell 值↔記錄映射 | `apps/web/**/*.test.ts` |
| **Playwright(固化)**| 上傳範例 xlsx → 預覽 → 建表 → 網格顯示資料 → 改一格存 | `apps/web/e2e/` |
| Playwright MCP | 開發期真瀏覽器驗證 | 開發期 |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-GEI-1..7)| — | ⏳ |
| **M1** A1 | bulk 建立 API + hooks + 整合測試 | ~3 天 | ✅ 2026-07-19(fa05d65;api 64 tests + live smoke;rollback+rowIndex)|
| **M2** A2 | Glide 網格接引擎(讀 + cell edit + 新增列)| ~1.5 週 | ⏳ |
| **M3** A3+A4 | Excel 解析 + 型別推斷 + 預覽校正 + 建表灌資料 | ~2 週 | ⏳ |
| **M4** A5 + 收尾 | Playwright 固化 + FMEA + SHIPPED | ~4 天 | ⏳ |

---

## 10. 開放問題(OQ-GEI-N)— ✅ 已裁定(2026-07-19,全採建議)

| # | 議題 | 裁定 | 落地影響 |
|---|---|---|---|
| **OQ-GEI-1** | 網格唯讀/可編輯 | **A 可編輯** | A2 cell edit → updateRecord(樂觀鎖 409 提示);stub/autoNumber 唯讀 |
| **OQ-GEI-2** | 資料載入 | **A 一次一頁(500)+ 載更多** | 完整 lazy 無限捲列 P1-I scale backlog |
| **OQ-GEI-3** | Excel 解析在哪 | **A 前端 SheetJS** | 原檔不上傳;`xlsx` 套件裝於 web;大檔限大小 |
| **OQ-GEI-4** | 匯入目標 | **A 只做 Excel→新表單** | 匯入到既有表(欄位對映)列 P1-I |
| **OQ-GEI-5** | 推斷積極度 | **A 保守 + 預覽可改** | §4.4 heuristic;信心不足 fallback text |
| **OQ-GEI-6** | 網格 vs FDU 資料表 | **A 各自保留** | grid 為新「網格」模式;FDU「資料」表格留;mockup grid/list 標示意 |
| **OQ-GEI-7** | bulk 失敗策略 | **A 全 rollback + 回失敗列** | A1 單一 tx;任一列敗整批退 + 回失敗列 index/原因 |

---

## 11. SOP / 12. FMEA

> M4 收尾時填(照 form-engine-core / form-designer-ui 模式)。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v0.1 | 初版 DRAFT — A1–A5 切分 + OQ-GEI-1..7;上游 = form-engine-core v1.0 + form-designer-ui v1.0 + packages/ui GridSheet | Claude Code |
| 2026-07-19 | v0.2 | OQ-GEI-1..7 全採建議裁定;狀態 DRAFT → APPROVED;進 M1(bulk API) | Claude Code |
