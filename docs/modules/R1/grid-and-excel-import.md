# grid-and-excel-import.md — [P0-2] 網格主檢視 + Excel 建表 onboarding 設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-19)— M0–M4 全數達成;OQ-GEI-1..7 全採建議裁定**
>
> P0-2 兩大招牌:**(1) Excel-like 網格主檢視**(Glide canvas,可直接改格 —— Ragic 用戶最熟悉的操作面)+ **(2) 用既有 Excel 建表 onboarding**(上傳 xlsx → 推斷欄位 → 生成表單 + 灌入資料),docs/10 標「Ragic 差異化 onboarding 神器」。上游 = form-engine-core v1.0(引擎 API)+ form-designer-ui v1.0(client 層 / builder)+ packages/ui `GridSheet`(Glide 封裝已備)。
>
> 作者:Claude Code(草擬)
> 版本:v1.1(2026-07-19)

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
| Excel 解析 | ❌ 無 xlsx 套件 | 需選型(⚠️SUPERSEDED-OQ-GEI-3;SheetJS `xlsx` 純前端解析)|
| mockup grid | `/app/_components/po-grid-view.tsx`(Glide + 靜態 fx 資料)| 視覺基準;本模組出真 grid,mockup 標「示意」|
| 型別 registry | ✅ 15 型別 + 前端 field-types meta | 推斷邏輯映射到此子集(text/number/money/date/singleSelect…)|

---

## 2-bis. 巨人的肩膀:企業級 data grid + Excel 匯入做法對照(2026-07-19 web 研究,retrospective 補)

> ⚠️ **2026-08-03 稽核附註|本節是 retrospective 自評,結論的可靠度結構性偏高。**
> 同日(2026-07-19)以相同形態補寫的 §2-bis 共四份
> (`form-engine-core` / `form-designer-ui` / `grid-and-excel-import` / `formula-and-linkload`),
> 其中兩份的結論已被後續的 0-bis 推翻。**成因不是不用功,是問題設錯了** ——
> 第一輪 retrospective 問的是「我當初選對了嗎」,而那個問題的答案幾乎必然是「對」。
> 該問的是「**這個套件 / 這個競品在這一題附近還給了什麼我沒用到的**」。
> 依 `_template.md` §0.4:**禁寫「無向上缺口」這類終局結論。**
> 稽核見 `docs/modules/_audit/giants-shoulders-audit-A.md`。


> 兩招牌各對照企業級標竿:網格對 data grid 三雄、Excel 匯入對專業匯入 UX(flatfile 式)。

| 領域 | 標竿 | 對 Weyver 的意義 |
|---|---|---|
| **Canvas data grid** | **Glide Data Grid**(選用,MIT):canvas 渲染、百萬列、原生捲動,「React 追求原始捲動效能時很有說服力」 | ✅ 選型獲驗證 |
| | **AG Grid**:企業功能矩陣最完整 **但進階功能商用授權** | OSS-only 排除(docs/11 v5 已定);功能缺口以自建 pivot/master-detail 補 |
| | **Handsontable**:試算表 + 內建公式 + Excel 編輯,**但 GPL/商用** | 授權排除;公式走自建 P0-3(fork Teable MIT) |
| **Excel 匯入 UX** | **flatfile.com**(專業匯入 SaaS)模式:**parse → 型別推斷 → 欄位對映 / 校正 → 驗證 → commit** | **Weyver ExcelImportPanel 正是此流程**(SheetJS parse → heuristic 推斷 → 預覽校正 → bulk;M3 已 SHIPPED)✅ 已對齊 |

**結論**|網格選 Glide(canvas + OSS + 捲動效能)在三雄取捨中站對(AG Grid 卡商用、Handsontable 卡 GPL);Excel 匯入的「解析→推斷→校正→灌入」流程與專業匯入 SaaS(flatfile)同構。~~皆 ✅ 已對齊,無向上缺口。~~

🔴 **2026-08-03 作廢後半句。** 「無向上缺口」已證實為錯:同一個 Glide 版本的型別檔逐字寫著
`onPaste` 會「split the data by tabs and newlines and paste into available cells」、
`onCellsEdited`「provides all edits inbound as **a single batch**」,
而 `packages/ui/src/components/grid-sheet.tsx` 當時只設了 `getCellsForSelection`,
兩者全 repo 零命中 → **從 Excel 貼一整塊資料進網格是不可能的**。
而「一一複製貼上極度耗時」正是客戶離開 Excel 的第一理由。
缺口延誤約六週,直到 2026-08-03 才另立 `grid-paste` 模組補。

**本句錯的方式值得記住**:選型(Glide vs AG Grid vs Handsontable)確實選對了,
研究也做了 —— 但只查到「這個套件該不該選」就停,沒查「選了之後它給了什麼我沒接」。
前半句「Glide 站對」仍然成立,**錯的是把選型正確當成能力已用盡**。

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
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-GEI-1..7)| — | ✅ 2026-07-19 |
| **M1** A1 | bulk 建立 API + hooks + 整合測試 | ~3 天 | ✅ 2026-07-19(fa05d65;api 64 tests + live smoke;rollback+rowIndex)|
| **M2** A2 | Glide 網格接引擎(讀 + cell edit + 新增列)| ~1.5 週 | ✅ 2026-07-19(RecordGridPanel「網格」模式;cursor 分頁 200/頁 + 載更多;cell edit → updateRecord 樂觀鎖;必填表停用新增列;MCP 實測 v1→v2 持久化 + 補 Glide `#portal` 掛載點)|
| **M3** A3+A4 | Excel 解析 + 型別推斷 + 預覽校正 + 建表灌資料 | ~2 週 | ✅ 2026-07-19(ef24075;SheetJS CDN 0.20.3 前端解析 + 推斷 heuristic 9 單元測 + ExcelImportPanel 預覽校正 + createForm→bulk;MCP 實測 8 列真檔 6 型別全對灌入 PG;面板動態 import)|
| **M4** A5 + 收尾 | Playwright 固化 + FMEA + SHIPPED | ~4 天 | ✅ 2026-07-19(`e2e/grid-import.spec.ts` 固化:匯入→推斷預覽→建表→網格 canvas 改格→「資料」DOM 驗證落庫;bulk 原子性/rollback/上限/租戶整合測試已於 M1;§12 FMEA;SHIPPED v1.0)|

---

## 10. 開放問題(OQ-GEI-N)— ✅ 已裁定(2026-07-19,全採建議)

| # | 議題 | 裁定 | 落地影響 |
|---|---|---|---|
| **OQ-GEI-1** | 網格唯讀/可編輯 | **A 可編輯** | A2 cell edit → updateRecord(樂觀鎖 409 提示);stub/autoNumber 唯讀 |
| **OQ-GEI-2** | 資料載入 | **A 一次一頁 + 載更多** | 落地頁大小取 list 端點上限 200(非 500);完整 lazy 無限捲列 P1-I scale backlog |
| **OQ-GEI-3** | Excel 解析在哪 | **A 前端 SheetJS** | 原檔不上傳;`xlsx` 套件裝於 web;大檔限大小 |
| **OQ-GEI-4** | 匯入目標 | **A 只做 Excel→新表單** | 匯入到既有表(欄位對映)列 P1-I |
| **OQ-GEI-5** | 推斷積極度 | **A 保守 + 預覽可改** | §4.4 heuristic;信心不足 fallback text |
| **OQ-GEI-6** | 網格 vs FDU 資料表 | **A 各自保留** | grid 為新「網格」模式;FDU「資料」表格留;mockup grid/list 標示意 |
| **OQ-GEI-7** | bulk 失敗策略 | **A 全 rollback + 回失敗列** | A1 單一 tx;任一列敗整批退 + 回失敗列 index/原因 |

---

## 11. SOP(維運)

- **匯入除錯**:bulk 失敗回 `BulkRowError{rowIndex,reason}`(422),對照預覽列即定位;推斷誤判於預覽改型別重送。
- **回歸守護**:`e2e/grid-import.spec.ts`(匯入→網格改格→資料驗證)+ `records.integration.test.ts`(bulk 原子性/上限/租戶)+ `excel-import.test.ts`(推斷 heuristic)三層,改動 GEI 前後必綠。
- **依賴**:SheetJS 鎖 CDN `xlsx-0.20.3`(Apache-2.0);升版時逐檔 review + 重跑 e2e。

## 12. FMEA(上線前失效反思;P0 未緩解不得上 prod)

| # | 失效路徑 | 嚴重 | 緩解(狀態)|
|---|---|---|---|
| F1 | 匯入欄名挾帶 SQL identifier 注入 | **P0** | 欄名僅為 metadata;物理 identifier 由引擎 generated column(`'f'||id`)產生、不拼接使用者字串;建欄走 identifier regex 白名單(引擎鐵則 1)。✅ 繼承引擎防線 |
| F2 | bulk 部分失敗留髒資料 | **P0** | 單一 `inTenantTx`,任一列敗整批 rollback + 回失敗列 index。✅ M1 整合測試 |
| F3 | 跨租戶 bulk 灌入他人表 | **P0** | `resolveForm` tenant-scoped + RLS FORCE;租戶 B 拒。✅ M1 整合測試斷言 |
| F4 | 金額以 float 落庫失精度 | **P0** | `toImportValue` money 去符號後保十進位字串;引擎欄為 `numeric`(禁 float)。✅ 單元測 + MCP 實測(12.5→"12.5000")|
| F5 | 大檔/多列凍 UI 或 DoS | P1 | 前端解析(不佔後端);解析與 bulk 皆 ≤5000 列上限,超出截斷並提示。✅ |
| F6 | 型別誤判寫壞值 | P1 | 保守推斷(信心邊界 fallback text)+ 預覽可覆寫;最終仍過引擎 `validateValues`,誤判至多 422 不落壞值。✅ 9 單元測涵蓋各型別 |
| F7 | 網格改格與他人並發衝突 | P1 | `expectedVersion` 樂觀鎖,衝突回 409 → 提示重載。✅ M2 |
| F8 | Glide overlay 無 `#portal` → 編輯靜默失敗 | P1 | layout 掛 `<div id="portal">`;e2e 固化含 canvas 改格→落庫驗證守回歸。✅ 已修 + 固化 |
| F9 | singleSelect 匯入值不在 choices | P2 | choices 由該欄 distinct 生成通常涵蓋;越界值引擎拒(422)。可接受 |
| F10 | SheetJS 供應鏈風險 | P1 | 取官方 CDN 維護版(Apache-2.0);`ignore-scripts` 無 install script。✅ |

**結論**|F1–F4(P0)全數緩解且具測試佐證,無 P0 未緩解項 → 可上 prod。

---

---

## 0-bis. 追溯稽核(2026-07-29)— **本模組原無證據段,事後補**

### 🔴 已修:型別推斷吃掉前導零(commit `ae5d2bb`)

**實測確認為真 bug 而非取捨**(`node -e` 直接跑):

| 輸入 | 原本判定 | 匯入後 |
|---|---|---|
| `00123`(郵遞區號 / 舊料號)| number | **`123`** —— 前導零永久消失 |
| `0912345678`(台灣手機)| number | **`912345678`** |
| 15 位以上純數字 | number | 超過 `MAX_SAFE_INTEGER`,**精度損毀** |

客戶手上的舊 Excel 幾乎必有電話 / 統編 / 郵遞區號欄,**而匯入正是 onboarding 第一線**。

**修法**|一票否決規則(前導零 / 超精度 / 8–14 位純數字 / 含電話分隔符),
且**只要有一格命中就整欄退 text** —— 寧可讓使用者手動改成數字(可改),也不能讓前導零消失(不可逆)。
欄名為量值時(數量/金額/單價…)不誤擋。
**踩點**|初版把否決放在最前面,結果 `2026-07-22` 也被擋(`6-0` 命中電話分隔規則)→ 移到日期判定之後。

**Flatfile / Dromo(廠商文件)明示**:「前導零有語意的欄(郵遞區號 / 員工編號)**就該定為 Text**」。

### 🔴 已修:批次匯入只回第一個錯誤列(commit `3ddea8a`)

原本 `createManyRecords` 逐列 `throw BulkRowError` → **5000 列有 30 個錯要來回試 30 次**。
業界一律一次回報完整清單:**Salesforce Data Loader** 產 success/error 兩份 CSV、**Ragic** 逐列處理可跳過。
**修法**|交易內先全列預檢(不插入)→ 收集所有失敗 → `BulkValidationError` 帶完整清單;原子性維持。

> **業界共識**:all-or-nothing 是 **PostgreSQL `COPY` 的資料庫預設,不是 UX 預設**。
> CSVBox / Integrate.io:「a few bad rows blocks progress and frustrates customers」。
> **Salesforce NPSP 有明確 Dry Run 兩階段。**

### 🔴 未修:parity 破口 —— 已立 [task #106]

> **Ragic 官方的匯入主入口是「既有 sheet 的列表頁 → Tools → Import Data From File」**
> —— 遷移後客戶每天在做的是這件事,不是建表。而 OQ-GEI-4 裁定只做「Excel→新表單」。

| 項 | 內容 |
|---|---|
| **匯入既有表 + 欄位對映** | Airtable 策略:欄名完全相符自動配對,其餘下拉手動;多出的欄 →「建立新欄位 / 忽略」;**模糊比對只做建議不自動套(誤配比未配更貴)** |
| **upsert by key** | 無此功能則重覆匯入必產生重複資料。**Ragic 官方三政策**:新增 / 更新既有 / 只更新不新增;Airtable 有「Merge with existing records」 |
| **匯入撤銷** | **Ragic 官方有** Recent Changes → Revert 整批還原。已有 soft delete 地基 → 加 `import_batch_id` 即可,低成本高價值 |
| **大檔** | 目前主執行緒同步讀、無 Worker、無 `dense`、**硬上限 5000 列直接截斷**。SheetJS 官方要求大檔用 `dense:true` + Web Worker,>100M cells 撞 V8 字串上限,官方明說「處理很大的檔應在伺服器端」。**客戶 3 萬列的舊 Excel 現在無解 —— 對「既有客戶遷移」定位是硬傷** |
| 靜默錯誤 | **多工作表寫死 `SheetNames[0]` → 靜默吃錯表**;標題列寫死 `matrix[0]`;合併儲存格 SheetJS 只左上格有值 → 靜默空值 |

### 推斷規則的其餘改進(未修)

- 取樣改 **200 列且分層**(頭 50 / 中 100 / 尾 50)—— 目前只取前 50,舊資料常集中檔頭。**Power Query 官方即取前 200 列**
- 命中門檻由 100%(`allMatch`)改 **≥95%**,離群列列入預檢報告
- 日期改用 `cellDates:true` 取 **Excel 序列值**(序列值本身無地區歧義),文字才走 regex;`x/y/z` 且無任一段 >12 時標「歧義」要使用者選 MDY/DMY(對齊 Excel 匯入精靈)
- 面板加「自動推斷 開/關」+「全部設為文字」逃生鍵(**對齊 Airtable 的可關閉開關**)

#### 推斷規則 v2 完整規格(可直接實作)

```
取樣:分層 200 個非空值(頭 50 / 中 100 / 尾 50)
門檻:命中 ≥95%(未達 → text,離群列列入預檢報告)

【一票否決 —— 先於所有數值判定,任一格命中即整欄 text】   ← 已實作(ae5d2bb)
  A. /^0\d/                    前導零(郵遞區號 / 舊料號)
  B. /^-?\d{15,}$/             超 MAX_SAFE_INTEGER
  C. /^\d{8,14}$/ 且無小數無千分位  統編 8 / 身分證 10 / 手機 10
                               —— 除非欄名含 數量|金額|單價|重量|qty|amount
  D. 含 - + ( ) 的數字串          電話 02-1234-5678、+886

【正判定順序】
  1 checkbox      全為 true/false/是/否/Y/N
  2 date/dateTime 優先取 cellDates 的 Date 物件;純文字僅認 ISO;
                  x/y/z 且無任一段 >12 → 標「歧義」要使用者選 MDY/DMY
  3 money         欄名含 金額|價|費|成本|amount|price|cost,或含貨幣符號
                  ⚠️ **單靠「兩位小數」不足** —— 0.25 是比率不是金額
  4 number        其餘數值
  5 singleSelect  distinct ≤ min(50, rowCount × 0.1)
                  且 rowCount ≥ 20 且 distinct ≥ 2
  6 text          其餘
```

> **與現行實作的差距**|一票否決(A–D)已實作;**取樣仍為前 50 列、門檻仍為 100%
> (`allMatch`)、日期仍走文字 regex 而非 `cellDates`、singleSelect 門檻為
> `min(10, rowCount × 0.3)` 且 `rowCount ≥ 5`(較上表寬鬆,易在小樣本誤判)**。

### ✅ 產品方向確認

**Ragic 建表時是引導使用者逐欄指定型別、不靜默猜**;Airtable 的自動推斷可關閉。
→ 本專案的「**猜 + 預覽可覆寫**」其實比 Ragic 前進,方向對,值得保留為差異化;
要補的只有推斷規則的三個經典坑(已修其一)與逃生鍵。
**前端解析(SheetJS in browser)的取捨也正確**(隱私 + 零 infra),只需加 Worker/dense + 後端補一條超大檔路徑。

### 來源

- [Ragic — Importing and Exporting(官方)](https://www.ragic.com/intl/en/doc/41/importing-and-exporting) · [Mass Update by Importing](https://www.ragic.com/intl/en/doc-kb/65/Mass-Update-by-Importing) · [Migrate Excel Data](https://www.ragic.com/intl/en/doc-kb/54/migrate-excel-data-to-ragic)
- [Airtable — Creating a new base via CSV import](https://support.airtable.com/hc/en-us/articles/202579399-Creating-a-new-base-via-CSV-import) · [CSV Import Extension](https://support.airtable.com/docs/csv-import-extension)
- [Microsoft — Data types in Power Query(前 200 列推斷)](https://learn.microsoft.com/en-us/power-query/data-types)
- [SheetJS — Large Datasets / dense mode](https://docs.sheetjs.com/docs/demos/bigdata/stream/) · [Web Workers](https://docs.sheetjs.com/docs/demos/bigdata/worker/) · [issue #1136 — 90MB 檔案](https://github.com/SheetJS/sheetjs/issues/1136)
- [Salesforce Trailhead — Import Dry Run](https://trailhead.salesforce.com/content/learn/projects/import-your-data-using-npsp-data-importer/perform-an-import-dry-run)
- [CSVBox — Support partial imports with valid rows only](https://blog.csvbox.io/partial-import-valid-rows/) · [Dromo — Common data import errors](https://dromo.io/blog/common-data-import-errors-and-how-to-fix-them) · [Flatfile — Top 6 CSV import errors](https://flatfile.com/blog/top-6-csv-import-errors-and-how-to-fix-them/)
- [Airtable Community — Undo an import](https://community.airtable.com/other-questions-13/undo-an-import-16986)

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v0.1 | 初版 DRAFT — A1–A5 切分 + OQ-GEI-1..7;上游 = form-engine-core v1.0 + form-designer-ui v1.0 + packages/ui GridSheet | Claude Code |
| 2026-07-19 | v0.2 | OQ-GEI-1..7 全採建議裁定;狀態 DRAFT → APPROVED;進 M1(bulk API) | Claude Code |
| 2026-07-19 | v0.3 | M1 ✅(bulk API)· M2 ✅(Glide 網格接引擎:讀/編輯/新增列 + `#portal`);頁大小校正 500→200(list 上限) | Claude Code |
| 2026-07-19 | v0.4 | M3 ✅(Excel→建表:SheetJS 前端解析 + 型別推斷 + 預覽校正 + bulk 灌資料;面板動態 import);dep SheetJS 官方 CDN 0.20.3 | Claude Code |
| 2026-07-19 | v1.0 | **M4 ✅ → SHIPPED**;Playwright 固化 `grid-import.spec.ts`(overlay `.fill()` 穩定改格)+ §11 SOP + §12 FMEA(F1–F4 P0 全緩解)| Claude Code |
| 2026-07-19 | v1.1 | **retrospective 補企業級 giants 對照(§2-bis)**:Glide vs AG Grid(商用)vs Handsontable(GPL)三雄取捨驗證選型;Excel 匯入「解析→推斷→校正→灌入」對映 flatfile 式專業匯入 UX;皆已對齊無缺口。不改實作 | Claude Code |
