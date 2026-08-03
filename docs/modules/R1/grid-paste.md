# grid-paste.md — [R1·P0-2 殘留] 網格貼上 Excel 區塊

> ⏳ **狀態:M0 草擬,待裁定(OQ-GP-1..8)**
>
> **一句話**|客戶離開 Excel 的**第一理由**是「一一複製貼上,極度耗時且容易出錯」,
> 而我們的網格**貼不進一整塊 Excel 資料**。實測 `onPaste` / `getCellsForSelection` / `onCellsEdited`
> 於 `apps/web/src` **零命中**(2026-08-03 覆查仍為零)。
>
> **為什麼現在做**|R1 是「把既有客戶從 Ragic / Excel 搬過來」的 land 階段,
> 而這一條是 land 動作的**正面衝突** —— 我們用「不用一一複製貼上」當理由請客戶搬家,
> 搬過來卻連貼上都不行。
>
> 作者:Claude Code(草擬) · 版本:v0.1(2026-08-03)

---

---

## 0. 站在巨人的肩膀(2026-08-03 補;v0.1 完全缺這一節)

> ⚠️ **v0.1 沒有研究節就直接進設計,而其他模組都有。**
> 被 review 點出後補。缺的不只是競品 —— **連我們腳下這個套件本身都沒查**,
> 而它恰恰決定了這個模組有多大。

### 0.1 巨人一:自家 repo(v0.1 唯一做對的一層)

見 §2 走查。最有價值的一條是「**有 bulk create,沒有 bulk update**」——
它把「這是純前端」這個直覺當場推翻。

### 0.2 🔴 巨人二:Glide Data Grid 本身 —— **它已經做掉一半**

一手依據為**已安裝版本**(`@glideapps/glide-data-grid@6.0.3`)之型別註解逐字:

| 能力 | 逐字 | 對本模組的意義 |
|---|---|---|
| **複製** | 「Used for copy/paste, **if unset copy will not work**」;傳 `true` 則「the data grid will internally use the `getCellContent` callback to provide a basic implementation」 | 我們**已經設了** `getCellsForSelection`(`grid-sheet.tsx:95`)→ **複製應已可用**,OQ-GP-7 的工作是實測不是實作 |
| **貼上與 TSV 解析** | 「If `onPaste` evaluates to true the grid will attempt to **split the data by tabs and newlines and paste into available cells**」 | 🔴 **TSV 解析不必自己寫** —— §3.1「自寫剪貼簿解析」大部分不需要 |
| **批次寫入的縫** | `onCellsEdited`:「provides all edits inbound as **a single batch**」 | 🔴 **一次貼上天然就是一批** —— 正好對上「一個 tx 的 bulk update」與「一步 undo」 |
| **不會加列** | 「The grid **will not attempt to add additional rows** if more data is pasted then can fit. In that case it is advisable to simply **return false from onPaste and handle the paste manually**」 | 🔴 **OQ-GP-3(貼超出最後一列)是真正得手工做的那一塊**,而且套件官方就建議此時自行接管 |

**結論:模組的形狀因此改變。** 原以為主要工程量在「解析剪貼簿 + 逐格寫入」,
實際上那兩件套件都給了;**真正的工作是**:
(a) 後端 bulk update(§2 的發現,不變)·
(b) 把 `onCellsEdited` 的單一批次接到 (a) ·
(c) **加列**(套件明說不做)·
(d) 型別先驗與錯誤格標示 ·
(e) 計算欄跳過 ·
(f) 一步 undo。

**這也是為什麼「巨人的肩膀」第二站必須是自己的相依套件** ——
不查就會自己重寫一份它已經給你的東西,而且寫得比較差。

### 0.3 巨人三:競品的行為決策(研究中)

套件只決定「做得到什麼」,**做不到「該怎麼表現」** ——
貼超出時要不要加列、上限多少、貼到計算欄怎麼講、錯誤格怎麼標,
這些是產品決策,要看別人踩過什麼。**研究進行中,回填後再裁定 OQ-GP-2/3/4/5。**

> ⚠️ **OQ-GP-2 的 1000 列是猜的**,本節回填前不得當成依據(見該題註記)。

## 1. 目標與範圍

### 1.1 目標

1. **從 Excel / Google 試算表複製一塊區域,貼進網格**(TSV 解析),覆蓋既有列或往下新增列。
2. **從網格複製一塊區域**(Ragic / Excel 互通:貼回 Excel 要能還原成表格)。
3. **貼上是一個動作**:一次 undo 全部還原,不是 N 次。
4. **失敗要指得出是哪一格**,不是「匯入失敗」四個字。

### 1.2 明確不做

- ❌ **不做填滿把手(fill handle)拖曳** —— 另立(同屬 Ragic-parity,但互動與資料路徑不同)
- ❌ **不做跨表單貼上**(A 表複製 → B 表貼上的欄位對映)—— 那是 `import-to-existing-form` 的範圍
- ❌ **不做公式 / lookup / rollup / autoNumber 欄的貼入** —— 計算欄不可寫(見 OQ-GP-4)
- ❌ **不改型別推斷** —— 沿用既有 heuristic(`grid-and-excel-import` A4)
- ❌ **不做剪下(cut)** —— 語意上是「複製 + 清空」,清空是刪資料,風險等級不同,另議

---

## 2. 現況走查(2026-08-03,對程式碼)

| 項目 | 現況 | 路徑 |
|---|---|---|
| 網格元件 | `GridSheet`(Glide 封裝,99 行) | `packages/ui/src/components/grid-sheet.tsx` |
| 對外介面 | `onCellEdited` / `onCellClicked` / `gridSelection` / `onGridSelectionChange` | 同上 L17-28 |
| **貼上相關 props** | 🔴 `onPaste` / `onCellsEdited` **未曝露**(貼上確實不可能)| 同上 |
| **複製** | ⚠️ **v0.1 寫錯**:`getCellsForSelection` **已設為 `true`**(L95)。Glide 型別註解逐字:「Used for copy/paste, **if unset copy will not work**」、傳 `true` 則「the data grid will internally use the `getCellContent` callback to provide a basic implementation」→ **複製很可能已經可用,待實測確認** | `grid-sheet.tsx:95` |
| 單格編輯 | `onCellEdited` → `useUpdateRecord`(逐格一個請求) | `records/grid-panel.tsx:88,107` |
| 批次**新增** | ✅ `POST /forms/:id/records/bulk` → `createManyRecords`,**單一 tx** | `records.controller.ts:156` · `record.service.ts:993` |
| 批次**更新** | 🔴 **不存在** | 只有 `@Patch(":recordId")` 單筆 |
| 欄位級權限 | `EffectivePermissions` 已貫穿 create / update / bulk | `records.controller.ts` 全數傳入 |

### 🔴 最重要的一條

**有 bulk create,沒有 bulk update。** 而貼上到既有列 = 大量 update。
所以本模組**必然要動後端**,不是純前端 —— 這一點在開工前就要說清楚,
否則會像 UP-3c 一樣以為是「純前端渲染層」結果動到別的地方。

**⚠️ 反過來說也要誠實**:若逐格發 N 個 `PATCH`,貼 500 格就是 500 個請求,
且**沒有原子性**(第 300 格失敗時前 299 格已寫入)。這不是效能問題,是**正確性問題**。

---

## 3. 關鍵設計

### 3.1 剪貼簿格式

| 來源 | 格式 | 處理 |
|---|---|---|
| Excel / Google 試算表 | `text/plain` **TSV**(欄以 `\t`、列以 `\r\n`) | 主要路徑 |
| 同上 | `text/html`(`<table>`) | **次要**,用於保留換行儲存格;TSV 對含換行的儲存格會壞掉 |
| 純文字 | 單格 | 沿用既有單格編輯 |

⚠️ **TSV 的已知陷阱**|儲存格內含換行時,Excel 會用**引號包起來**,而 `split("\n")` 會把它切成兩列。
故 **必須解析引號**,不能單純 split。這是 CSV/TSV 解析的經典坑,不是邊角。

### 3.2 寫入路徑(依 OQ-GP-1 裁定)

```
貼上 → 解析成 rows[][] → 逐格型別轉換(沿用 toSubmitValue)
     → 前端先驗(型別 / 必填 / 選項白名單)→ 顯示錯誤格,不送
     → 全部合法才送 → 後端單一 tx → 全成或全敗
```

### 3.3 一次 undo

貼上前快照受影響的 `(recordId, fieldName) → 舊值`,
undo 時用同一支 bulk update 寫回。**不重用 layout 的草稿模型**(那是 metadata,這是資料)。

---

## 4. 資料模型變動

**無 schema 變動。** 新增一支端點 + 一個 service 方法。

---

## 5. cross-cutting 檢核

| 面向 | 檢核 |
|---|---|
| 🔒 **租戶** | 沿用 `@Tenant()` + RLS;bulk update 的 `WHERE` **必須含 tenant_id 且逐筆驗 recordId 屬本租戶**(BOLA:貼上時 client 送的 recordId 陣列是**使用者可控輸入**)|
| 🔒 **欄位級權限** | 🔴 **每一格都要驗**。貼上是最容易繞過欄位權限的路徑 —— 使用者看不到「成本」欄,但若前端把它算進貼上範圍,後端沒擋就寫進去了。E-1 已 SHIPPED,必須套用 |
| 🔒 **動態 identifier** | 欄名 → metadata catalog 白名單(鐵則 1),貼上不得引入新欄名 |
| ⚙️ **冪等性** | 貼上帶 idempotency key —— 重試不重複寫(鐵則:所有 mutation) |
| ⚙️ **原子性** | 單一 tx,部分失敗全 rollback(與 bulk create 同語意)|
| ⚙️ **配額** | 單次貼上上限(OQ-GP-2);超過要**明確拒絕並說明**,不是靜默截斷 |
| 📊 **效能** | 5000 格的解析在主執行緒會卡;需量測後決定是否切 chunk |
| ♿ **a11y** | `⌘V` 之外需有選單入口(可發現性 —— 與 OQ-FDW-9 同一條論據)|
| 📝 **稽核** | 貼上寫 audit:一次貼上一筆事件(含影響列數),不是 N 筆 |

---

## 6. 開放問題(OQ-GP-N)

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-GP-1** | 寫入的原子性 | A. **後端新增 bulk update,單一 tx,全成或全敗**<br>B. 前端逐格 PATCH<br>C. 分批 tx(每 100 列一個) | **A** —— B 沒有原子性(第 300 格失敗時前 299 格已寫入),那是**正確性問題**不是效能問題;且 500 個請求會打爆 throttler。C 的部分成功語意要跟使用者解釋「前 200 列進去了,後面沒有」,而使用者剛按的是**一個**動作 |
| **OQ-GP-2** | 單次貼上上限 | A. **無上限**<br>B. **列數上限(建議 1000 列)+ 超過時明確拒絕並建議改用 Excel 匯入**<br>C. 靜默截斷 | **B** —— C 絕對不行(Ragic 的 2000 筆重算上限就是「靜默失效」的反例,見 docs/31)。上限值需**量測後定**,1000 是待驗證的起點,不是查得的 |
| **OQ-GP-3** | 貼上超出最後一列 | A. **自動新增列**(Excel 語意)<br>B. 截斷到現有列<br>C. 詢問 | **A** —— 這是使用者從 Excel 帶來的預期;B 會靜默丟資料。⚠️ 但新增列必須套**建立權限**(有些人只能改不能新增) |
| **OQ-GP-4** | 貼到計算欄(formula / rollup / lookup / autoNumber) | A. **跳過該欄並在結果中說明「N 格因為是計算欄未寫入」**<br>B. 整批拒絕<br>C. 靜默跳過 | **A** —— B 太嚴(使用者從 Excel 複製一整塊很自然會含計算欄);C 違反「不靜默」原則 |
| **OQ-GP-5** | 型別轉不過去的格(例:文字貼進日期欄) | A. **前端先驗,標紅該格,整批不送**<br>B. 送出後由後端逐格報錯<br>C. 盡力而為,轉不過去的留空 | **A** —— 使用者在**貼上當下**就看到哪幾格有問題,而不是送出後才知道。C 會靜默改變資料 |
| **OQ-GP-6** | undo 範圍 | A. **一次貼上 = 一步 undo**<br>B. 逐格 undo<br>C. 不支援 undo(靠回收桶) | **A** —— 使用者按的是一個動作,undo 就該還原一個動作 |
| **OQ-GP-7** | 複製(網格 → 剪貼簿)要不要同批做 | A. ~~同批**做**~~ → 改為 **同批「實測 + 補齊」**<br>B. 另立 | **A(語意已修正)** —— ⚠️ **v0.1 假設複製要從零做,是錯的**:`getCellsForSelection` 已設 `true`,Glide 內建實作應已提供複製。故本項的工作**不是實作而是驗證**:實測貼回 Excel 的還原度(欄位分隔 / 含換行的儲存格 / 日期與數值格式),缺什麼補什麼。**M4 的內容因此縮小**,並改以實測結果決定要不要自訂 `getCellsForSelection` callback |
| **OQ-GP-8** | 剪貼簿格式支援範圍 | A. **TSV 為主 + HTML table 為輔**(含換行的儲存格)<br>B. 只做 TSV<br>C. 加做 CSV | **A** —— B 對「備註」這類含換行的欄位會壞掉,而那正是 ERP 單據常見的欄。C 沒有來源會產生(Excel 複製不給 CSV) |

---

## 7. 落地順序

| M | 內容 | 驗收 |
|---|---|---|
| **M0** | 本檔 → APPROVED(OQ-GP-1..8 裁定) | 用戶裁定 |
| **M1** | 後端 bulk update(單一 tx + 欄位級權限 + 逐筆驗租戶 + idempotency) | 整合測試:部分失敗全 rollback · **跨租戶 recordId 被拒** · 無權限欄位被拒 |
| **M2** | `GridSheet` 曝露 `onPaste` / `getCellsForSelection` / `onCellsEdited`;TSV + HTML 解析(含引號換行) | 單元測試:含換行 / 含引號 / 含定位字元的儲存格 |
| **M3** | 前端先驗 + 錯誤格標示 + 計算欄跳過說明 + 超出列數自動新增 | e2e:貼一塊 → 標紅 → 修正 → 成功 |
| **M4** | 複製(網格 → TSV)+ 一次 undo | e2e:複製 → 貼回 → 值相同;貼上 → undo → 還原 |
| **M5** | 量測(1000 格 / 5000 格)定上限 + FMEA + docs 回填 | 上限值有量測依據,不是猜的 |

---

## 8. 變更紀錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-08-03 | v0.2 | **裁定前覆查,修正 v0.1 的一處現況誤述**。原寫「貼上相關 props 全無」,實際 `getCellsForSelection` **已設為 `true`** —— 依 Glide 型別註解逐字「Used for copy/paste, **if unset copy will not work**」,**複製很可能早就能用**。故 OQ-GP-7 的工作性質由「實作複製」改為「實測複製的還原度並補齊」,M4 範圍縮小。⚠️ 這是同一個形狀第三次:**寫現況時沒把那一行讀完**(前兩次見 approval-advanced v0.3)。貼上仍確實不可能(`onPaste` / `onCellsEdited` 未曝露),模組必要性不變 | Claude Code |
| 2026-08-03 | v0.1 | M0 草擬。**起因**:review 裁定「先做功能,採用建議 #153」。走查發現關鍵事實 —— **有 bulk create,沒有 bulk update**,故本模組必然動後端,不是純前端(避免重演 UP-3c 誤判為「純前端渲染層」)。承 `grid-and-excel-import` v1.0(SHIPPED),貼上不在其 §1.3「不做的事」中,屬**新能力**故另立 M0 |
