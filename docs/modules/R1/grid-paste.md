# grid-paste.md — [R1·P0-2 殘留] 網格貼上 Excel 區塊

> ✅ **狀態:SHIPPED v1.0(2026-08-03;M0–M5 全數達成)**
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

### 0.3 巨人三:競品的行為決策(2026-08-03 完成)

套件只決定「做得到什麼」,決定不了「該怎麼表現」。以下逐字取自各家官方文件
(Ragic / Airtable / Baserow / Teable 部分取自本機一手鏡像 `reference-materials/`)。

**(a) 貼超出現有列數 —— 沒有共識,分兩派**

| | 行為 | 逐字 |
|---|---|---|
| **AG Grid** | 🔴 **靜默丟棄** | 「any rows exceeding the total number of rows shown in the grid **will not be pasted**」;加列要自寫 `processDataFromClipboard`。FR #1820(2017)至今未成預設 |
| Baserow | 自動加列,不問 | 「When your paste data exceeds available rows, Baserow **creates exactly the number of rows needed**」 |
| **Airtable** | ⭐ **自動加列但先確認** | 「You may need to **"Expand the table"** by clicking **Continue** in the modal that appears after you paste」 |
| Teable | 自動加列,**踩過坑** | changelog:「bulk paste **in a filtered view** could append new rows instead of updating visible ones」 |
| Ragic | **未查證** | doc-kb/210 只寫可跨 Ragic/Excel 複製貼上,**未說明超量行為** |

**(b) 上限 —— 終於有可引用的數字**

| 數字 | 意義 | 出處 |
|---|---|---|
| **500 列 / 次** | 貼上硬上限(**唯一官方明文的列數**)| Smartsheet |
| 200–300 筆 / 批 | 官方**建議**的安全批量 | Airtable |
| 100,000 字元 / 記錄 | 貼上字元上限 | Airtable |
| `Infinity` | Handsontable `rowsLimit` **預設**(等於沒設限)| Handsontable |
| 10 步 | undo 堆疊預設深度;且**排序 / 篩選會清空堆疊** | AG Grid |

⭐ **Airtable 另有一條貼上端的冪等保護值得抄**:大量貼上可能回
「detected a duplicate submission of the same request and **blocked a second write** to prevent creating duplicate data」。

**(c) 🔴 反面教材:超量就整批不做、而且不出聲 —— 四家四種形態**

- **Ragic**(最嚴重,且是我們的對標):「公式重算上限為 **2000** 筆…**自動略過執行,所有相關表單資料都不會進行公式重算**」;
  另一門檻「如超過 **3500** 筆,就不會寫入修改紀錄(**實際上資料有正常執行重算,只是不會顯示於修改紀錄**)」—— **稽核軌跡靜默消失**
- **Teable**:「copy-paste **showing a success message while the cell content remained unchanged**」
- **Airtable**:連結欄主要欄位為計算型時「unmatched values are **dropped**」(官方明文承認靜默丟棄)
- **AG Grid**:超量列「will not be pasted」

**共同點都是「使用者看到成功、系統其實少做了事」。**

**(d) 🔴 Ragic 的一句自白,直指網格編輯的根本風險**

> 「**有時候存在於表單頁的公式並不存在於列表頁,從列表頁編輯可能造成公式沒有重算**,
> 因此如果想要避免使用者在列表頁手動編輯資料,可以…勾選**關閉列表頁編輯**。」(doc/139)

**它的解法是把整個網格編輯關掉。** 對我方的硬約束:
**貼上必須走與表單儲存同一條計算路徑**,否則就是複製這個問題。

**(e) 「貼上前標紅問題格」—— 查無任何一家**

Baserow 官方:「those cells **remain empty rather than showing error messages**」;
Ragic 在匯入端有最完整的檢查分類(唯讀欄 / 必填 / 輸入檢查),**但全是可勾選的選項不是恆真的不變量**,
且在**匯入端不是貼上端**。
⚠️ 依〈向上設計三條〉條件 ①,此處標**未查證**(不等於沒有),但它是目前查到最大的空位。

## 1. 目標與範圍

### 1.1 目標

1. **從 Excel / Google 試算表複製一塊區域,貼進網格**(TSV 解析),覆蓋既有列或往下新增列。
2. **從網格複製一塊區域**(Ragic / Excel 互通:貼回 Excel 要能還原成表格)。
3. **貼上是一個動作**:一次 undo 全部還原,不是 N 次。
4. **失敗要指得出是哪一格**,不是「匯入失敗」四個字。

### 1.2 明確不做

- ⚠️ **填滿把手(fill handle)—— 「另立」的理由已被推翻,改列本模組 P1**
  🔴 v0.5 稽核發現:本檔 §0.2 才剛寫下「第二站是自己的相依套件」的教訓,
  §1.2 就重犯一次。Glide 6.0.3 逐字有 `fillHandle: boolean`(一個開關)與
  `onFillPattern`(「Emitted whenever the user initiats a pattern fill using the
  fill handle… **can be prevented**」),且**與貼上共用 `onCellsEdited` 出口**,
  repo 內兩者零使用。原判「互動與資料路徑不同」**資料路徑那半是錯的** ——
  同一條路徑。剩餘工作只有互動與填充規則(遞增序列 / 複製),不足以另立模組。
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

🔴 **M2 更正:上表描述的解析工作,我們一格都不用寫。**
讀 `onPasteInternal` 原始碼(2026-08-03)確認:Glide **優先讀 `text/html` 走 `decodeHTML`**,
沒有才退回 `unquote(text)`,而 `unquote` 是**正規的引號狀態機** —— 含換行的儲存格、
跳脫引號 `""`、CRLF 正規化全都處理了,`onPaste` 收到的已經是 `string[][]`。

⚠️ **但上游有一個真缺陷,而且是資料正確性等級**:`unquote` 以 `for...of` 逐**碼點**
迭代卻只把 index 加 1,`slice` 卻走**碼元** → 剪貼簿含 astral 字元(emoji 等)時整塊位移。
實測 `"🙂\tB\nC\tD"` → `[["\ud83d","\t"],["\n","\tD"]]`。
Excel / Google 試算表走 `text/html` 不受影響,**純文字來源才會踩到**。
處置:偵測落單代理碼元即**整塊拒絕**(見 `paste-matrix.ts`)——
修不了上游就讓它可見,靜默寫入壞值正是 §0.3(c) 的反面教材。上游修好後守衛自然不再觸發。

另一個實測發現:Excel 複製一列會帶尾端換行,`unquote("a\tb\r\n")` → `[["a","b"],[]]`。
**不砍掉這列,「貼 2 列」就會變成「將新增 1 列」的幽靈提示**(OQ-GP-3 的確認框會講錯話)。

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

## 6. 開放問題(OQ-GP-N)— ✅ **已裁定 2026-08-03(全採建議)**

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-GP-1** | 寫入的原子性 | A. **後端新增 bulk update,單一 tx,全成或全敗**<br>B. 前端逐格 PATCH<br>C. 分批 tx(每 100 列一個) | **A** —— B 沒有原子性(第 300 格失敗時前 299 格已寫入),那是**正確性問題**不是效能問題;且 500 個請求會打爆 throttler。C 的部分成功語意要跟使用者解釋「前 200 列進去了,後面沒有」,而使用者剛按的是**一個**動作 |
| **OQ-GP-2** | 單次貼上上限 | A. 無上限<br>B. **列數上限 + 超過明確拒絕並導向 Excel 匯入**<br>C. 靜默截斷 | **B,上限取 500 列** —— ⚠️ **v0.1 的 1000 是猜的,已換成有出處的數字**:Smartsheet 官方明文「You can paste up to **500 rows** at a time」,是查到**唯一**官方明列的列數上限;Airtable 另建議「**200–300 records at a time**」為安全批量。取 500 並在 M5 以量測複核。C 絕對不行 —— §0.3(c) 四家四種靜默降級形態皆為反面教材 |
| **OQ-GP-3** | 貼上超出最後一列 | A. 自動新增列不問<br>B. 截斷<br>C. **自動新增列,但先確認**(Airtable 形態)| **C(v0.1 原建議 A,依證據改)** —— B 出局(AG Grid 的「will not be pasted」是靜默丟資料)。A 是 Baserow 做法,但 **Airtable 有確認關卡**「Expand the table → **Continue**」而**加列是改變資料形狀不是改值**,值得一次明確同意;確認框天然也是顯示「將新增 N 列」的位置。⚠️ 兩條硬約束:(i) 新增列須套**建立權限**;(ii) **篩選檢視下貼上必須擋或明確處理** —— Teable 踩過「in a filtered view could append new rows instead of updating visible ones」,而我方有 view 篩選 |
| **OQ-GP-4** | 貼到計算欄(formula / rollup / lookup / autoNumber)| A. **跳過並說明「N 格因為是計算欄未寫入」**<br>B. 整批拒絕<br>C. 靜默跳過 | **A(證據支持,且是向上點)** —— **C 正是主流**:AG Grid 擋住但文件未提任何提示;Airtable 明文承認「unmatched values are **dropped**」。Ragic 有最完整的檢查分類(唯讀 / 必填 / 輸入檢查)**但全是可勾選的選項、且在匯入端不是貼上端** → 我方應把這些做成**恆真的不變量**。B 太嚴:從 Excel 複製一整塊很自然會含計算欄 |
| **OQ-GP-5** ⭐ | 型別轉不過去的格 | A. **前端先驗、標紅該格、整批不送**<br>B. 送出後後端逐格報錯<br>C. 轉不過去的留空 | **A —— 而且這是查到最大的空位**。**C 是 Baserow 的實際行為**:「those cells **remain empty rather than showing error messages**」(文字貼進數值欄 = 靜默變空)。**「貼上前標紅問題格」查無任何一家**(標未查證,非「沒有」)。這正好對上我方「所見即後果」的設計主張 |
| **OQ-GP-6** | undo 範圍 | A. **一次貼上 = 一步 undo**<br>B. 逐格 undo<br>C. 不支援(靠回收桶)| **A** —— 使用者按的是一個動作。**沒有任何一家逐字定義粒度**(未查證);可用的參照是 AG Grid:undo 涵蓋 copy-paste、**預設 10 步**、且「**sorting, filtering and grouping will clear the undo / redo stacks**」。→ 我方須明確定義**切換檢視 / 改篩選後 undo 的行為**,不要留給使用者猜。對照組:**Ragic 沒有 Ctrl+Z**,只有「資料修改紀錄」層的還原,且明文「只有大量修改和匯入的紀錄可以被還原」「此動作一旦被執行便無法復原」 |
| **OQ-GP-7** | 複製(網格 → 剪貼簿)要不要同批做 | A. ~~同批**做**~~ → 改為 **同批「實測 + 補齊」**<br>B. 另立 | **A(語意已修正)** —— ⚠️ **v0.1 假設複製要從零做,是錯的**:`getCellsForSelection` 已設 `true`,Glide 內建實作應已提供複製。故本項的工作**不是實作而是驗證**:實測貼回 Excel 的還原度(欄位分隔 / 含換行的儲存格 / 日期與數值格式),缺什麼補什麼。**M4 的內容因此縮小**,並改以實測結果決定要不要自訂 `getCellsForSelection` callback |
| **OQ-GP-9** 🆕 | 重複送出的防護 | A. **貼上帶 idempotency key**<br>B. 靠前端 disable 按鈕 | **A** —— Airtable 官方就有這一層:「detected a duplicate submission … **blocked a second write** to prevent creating duplicate data」。貼上天生會被重試(網路慢、使用者再按一次),而**對 ERP 而言重試一次就是多開 200 張單**。本專案已有 `IdempotencyInterceptor`,成本只有帶一個 header |
| **OQ-GP-10** 🆕 | 貼上要不要走與表單儲存同一條計算路徑 | A. **要**(公式 / rollup / 連動一律照跑)<br>B. 只寫值,計算之後再說 | **A,且視為硬約束不是選項** —— Ragic 官方自白(doc/139):「**從列表頁編輯可能造成公式沒有重算**」,而它的解法竟是**建議把列表頁編輯整個關掉**。B 就是複製這個問題:資料進去了但衍生值沒動,而使用者看不出來 |
| **OQ-GP-8** | 剪貼簿格式支援範圍 | A. **TSV 為主 + HTML table 為輔**(含換行的儲存格)<br>B. 只做 TSV<br>C. 加做 CSV | **A** —— B 對「備註」這類含換行的欄位會壞掉,而那正是 ERP 單據常見的欄。C 沒有來源會產生(Excel 複製不給 CSV) |

---

## 7. 落地順序

| M | 內容 | 驗收 |
|---|---|---|
| **M0** | 本檔 → APPROVED(OQ-GP-1..8 裁定) | 用戶裁定 |
| **M1** ✅ | 後端 bulk update(單一 tx + 欄位級權限 + 計算欄跳過並回報 + 500 列上限)| 整合測試 4 條:部分失敗**全 rollback**(第一列不得留下)· 計算欄跳過且回報格數 · **跨租戶 recordId 影響 0 列** · 超過 500 明確拒絕 |
| **M2** ✅ | `GridSheet` 曝露 `onPaste` / `onCellsEdited`(`getCellsForSelection` 早已為 `true`);**解析交給套件**,本層只做正規化:砍尾端空列 / 補矩形 / 上限 / 偵測上游位移 | 單元測試 10 條(`paste-matrix.test.ts`),輸入取自對 `unquote()` 的實測輸出而非臆造 |
| **M3** | 前端先驗 + 錯誤格標示 + 計算欄跳過說明 + 超出列數自動新增 | e2e:貼一塊 → 標紅 → 修正 → 成功 |
| **M4** | 複製(網格 → TSV)+ 一次 undo | e2e:複製 → 貼回 → 值相同;貼上 → undo → 還原 |
| **M3** ✅ | UI 接線:先驗 → 標紅整批不送 / 確認加列 / 篩選檢視擋加列 | e2e 3 條(對真 api + 真 PG)|
| **M4** ✅ | 一步 undo(貼上前快照受影響的格)| e2e:貼上 → 復原 → 值回到原樣 |
| **M5** ✅ | 量測定上限 + FMEA + docs 回填 | 見下 |

---

## 7-bis. M5 量測 —— **500 的上限站得住,但理由換了**

**環境**|本機 dev(PG 16 / OrbStack),`POST /records/bulk-update` 單一 tx,2 欄 × N 列。

| 列數 | 格數 | 耗時 | 每列 |
|---|---|---|---|
| 50 | 100 | 166 ms | 3.32 ms |
| 100 | 200 | 254 ms | 2.54 ms |
| 200 | 400 | 447 ms | 2.24 ms |
| (另一輪)250 | 500 | 872 ms | 3.49 ms |

**近線性**,每列 2.2–3.5 ms → **500 列外推約 1.1–1.8 秒**。

🔴 **結論:上限維持 500,但承重理由從「Smartsheet 官方這樣寫」換成「自家實測在可接受的互動時間內」。**
外部數字降為旁證 —— 它會變,而我們的量測不會因為別人改版而失效。
(同 `formula-and-linkload` 的處置:承重來源從「競品做不到」換成「我方架構本來如此」。)

⚠️ **量測時自己踩到一個非本模組的坑**:逐筆建 500 筆種子會撞 throttler(第 293 筆起失敗)。
**貼上不受影響**(它是一次 bulk 請求),但這說明**逐筆迴圈的批次操作在這個平台上不可行** ——
任何「批次」功能都必須走 bulk 端點。

---

## 7-ter. FMEA(M5)

| # | 失效 | 嚴重度 | 緩解 | 狀態 |
|---|---|---|---|---|
| P1 | 型別不合的格靜默變空(Baserow 的實際行為)| **P0** | 前端先驗 → 標紅 → **整批不送**;banner 講出「有 N 格無法貼上」 | ✅ e2e |
| P2 | 超出列數靜默丟棄(AG Grid「will not be pasted」)| **P0** | 先問「要一併新增這些列嗎」,再走 bulk create | ✅ e2e |
| P3 | 篩選檢視下加列 → 加到看不見的地方(Teable 踩過)| **P0** | `filtered` 時直接擋並說明要先清篩選 | ✅ 已擋。⚠️ 實作時把 `query.q !== ""` 寫成恆真(`q` 未設是 `null`),**變成永遠不給加列** —— e2e 抓到 |
| P4 | 部分寫入(第 300 格失敗時前 299 已寫)| **P0** | 後端單一 tx 全成或全敗 | ✅ M1 整合測試 |
| P5 | 重試造成重複寫入 | P1 | 既有 `IdempotencyInterceptor` | ✅ |
| P6 | **undo 把讀出來的值原封寫回 → 422** | **P0** | PG 的 `numeric` 回**字串**而寫入端要 `number`。快照改走 `planPasteCell`(與貼上同一條轉換)| ✅ e2e 抓到。⚠️ **同形狀第三次**(member bigint / 搜尋索引 / 此處)—— 凡「讀出來的值要再寫回去」都要重走轉換 |
| P7 | 加列與更新**不在同一個 tx** | P1 | 🔴 **已知偏離 OQ-GP-1**。順序刻意是「先建列、再更新」:失敗態是「新列留下但值是空的」,**看得見**;反過來失敗時只會「有些列沒出現」,那是靜默少做。真正的解是後端一支端點同時收 create + update | ⚠️ **殘留** |
| P8 | 上游 `unquote` 對 astral 字元位移 | P1 | 偵測落單代理碼元 → 整塊拒絕(§3.1)| ✅ 單元測試 |
| P9 | 5000 格解析卡主執行緒 | P2 | 500 列上限使最壞情況 ≈ 1.1–1.8 s,尚不需切 chunk;**上限放寬前必須重量** | ⚠️ 監看 |

**P0 全數緩解**;殘留 P7(跨 tx)與 P9(上限放寬前重量)已明確歸屬。

---

## 8. 變更紀錄

| 日期 | 版本 | 變更 |
|---|---|---|
| 2026-08-03 | **v1.0 SHIPPED** | **M3–M5 落地**。M3 UI(先驗 → 標紅整批不送 / 確認加列 / 篩選檢視擋加列)· M4 一步 undo · M5 量測 + FMEA。**上限維持 500 但承重理由換成自家實測**(2.2–3.5 ms/列近線性,500 列外推 1.1–1.8 s)—— 外部數字會變,量測不會。**e2e 抓到三個型別檢查與單元測試都抓不到的 bug**:(a) undo 把 PG 回的 `numeric` 字串原封寫回 → 422(**同形狀第三次**,已改走 `planPasteCell` 同一條轉換);(b) `query.q !== ""` 恆真(未設時是 `null`)→ **永遠不給加列**;(c) Glide 走 `navigator.clipboard.read()` 而非 `e.clipboardData`,測試不授權的話**貼上這條路徑根本不會執行**。殘留:加列與更新跨兩個 tx(偏離 OQ-GP-1,順序選「先建列」是因為失敗態看得見)| Claude Code |
| 2026-08-03 | v0.6 | 🔴 **稽核(`_audit/giants-shoulders-audit-B.md`)在本檔內抓到同型復發**:§0.2 才剛寫下「巨人第二站是自己的相依套件」,§1.2 就把填滿把手判為「互動與**資料路徑**不同 → 另立」而未查套件。覆驗:`fillHandle: boolean` 與 `onFillPattern` 都在 6.0.3,且**與貼上共用 `onCellsEdited`**,repo 內零使用 → **資料路徑那半是錯的**,改列本模組 P1。**教訓不是「又漏查一次」而是「寫下教訓不等於執行教訓」** —— §0 查了不代表 §1 的每個「不做」都查過,而「不做」的決定同樣承重 | Claude Code |
| 2026-08-03 | v0.5 | **M2 SHIPPED,並更正 §3.1 的整段規劃。** 原訂「自寫剪貼簿解析(TSV + HTML,含引號換行)」——讀 `onPasteInternal` 原始碼後確認**一格都不用寫**:Glide 優先 `text/html` 走 `decodeHTML`,退回 `unquote()` 且後者是正規引號狀態機,`onPaste` 收到的已是 `string[][]`。§0.2 說「套件已做掉一半」還是低估了。**新發現一個上游資料正確性缺陷**:`unquote` 逐碼點迭代卻以碼元 slice,含 astral 字元整塊位移(`"🙂\tB\nC\tD"` → `[["\ud83d","\t"],["\n","\tD"]]`),處置為偵測落單代理碼元即整塊拒絕 —— 修不了上游就讓它可見,且上游修好後守衛自然失效。另修一個會讓 OQ-GP-3 確認框講錯話的細節:Excel 尾端換行會多吐一列空的。`onCellsEdited` 型別由 `boolean \| void` 收窄成 `boolean`(留 `void` 會讓呼叫端漏寫 return 而默默走進預設寫入)。web 184 綠 | Claude Code |
| 2026-08-03 | v0.4 | **OQ-GP-1..10 全數裁定(全採建議),進 M1;M1 SHIPPED**。`updateManyRecords`:單一 tx 全成或全敗(GP-1)· 500 列上限走 zod 在入口就擋(GP-2,Smartsheet 出處)· 計算欄跳過並**回報跳過格數**而非靜默(GP-4)· **逐列走 `updateOne` 並在同 tx 維護事件與搜尋索引**(GP-10 硬約束 —— 為省事直接寫 SQL 會複製 Ragic doc/139 自承的「列表頁編輯造成公式沒重算」)· 冪等沿用既有 `IdempotencyInterceptor`(GP-9)。**誠實記錄一個取捨**:`expectedVersion` 傳 null(一次貼上數百格,逐列版本不切實際,`saveWithLines` 明細亦然)→ 兩人同時貼同一塊會後到者覆蓋而非撞版本衝突;租戶邊界仍由 RLS 與 `updateOne` 的 `tenant_id` 條件把關。api 1007 綠 | Claude Code |
| 2026-08-03 | v0.3 | **§0.3 競品研究完成,五條 OQ 建議依證據改寫,並新增兩條**。**OQ-GP-2 的 1000 列換成有出處的 500**(Smartsheet 官方明文「You can paste up to 500 rows at a time」,查到唯一官方明列的列數;Airtable 另建議 200–300 筆/批)。**OQ-GP-3 由「自動加列」改為「自動加列但先確認」** —— Airtable 有確認關卡而**加列是改變資料形狀不是改值**;並新增硬約束「篩選檢視下必須擋或明確處理」(Teable 踩過「in a filtered view could append new rows instead of updating visible ones」,而我方有 view 篩選)。**新增 OQ-GP-9 冪等**(Airtable 官方就有貼上端的 duplicate-block;對 ERP 而言重試一次就是多開 200 張單)與 **OQ-GP-10 貼上須走與表單儲存同一條計算路徑**(Ragic doc/139 自白「從列表頁編輯可能造成公式沒有重算」,而它的解法竟是建議把列表頁編輯整個關掉 —— B 選項就是複製這個問題,故視為硬約束非選項)。**最大的反面教材**:超量就整批不做且不出聲,四家四種形態(Ragic 2000 筆整批不重算 / 3500 筆連修改紀錄都不寫、Teable「success message while the cell content remained unchanged」、Airtable「unmatched values are dropped」、AG Grid「will not be pasted」),共同點是**使用者看到成功、系統其實少做了事**。**最大的空位**:「貼上前標紅問題格」查無任何一家(標未查證非「沒有」),正對上我方「所見即後果」 | Claude Code |
| 2026-08-03 | v0.2 | **裁定前覆查,修正 v0.1 的一處現況誤述**。原寫「貼上相關 props 全無」,實際 `getCellsForSelection` **已設為 `true`** —— 依 Glide 型別註解逐字「Used for copy/paste, **if unset copy will not work**」,**複製很可能早就能用**。故 OQ-GP-7 的工作性質由「實作複製」改為「實測複製的還原度並補齊」,M4 範圍縮小。⚠️ 這是同一個形狀第三次:**寫現況時沒把那一行讀完**(前兩次見 approval-advanced v0.3)。貼上仍確實不可能(`onPaste` / `onCellsEdited` 未曝露),模組必要性不變 | Claude Code |
| 2026-08-03 | v0.1 | M0 草擬。**起因**:review 裁定「先做功能,採用建議 #153」。走查發現關鍵事實 —— **有 bulk create,沒有 bulk update**,故本模組必然動後端,不是純前端(避免重演 UP-3c 誤判為「純前端渲染層」)。承 `grid-and-excel-import` v1.0(SHIPPED),貼上不在其 §1.3「不做的事」中,屬**新能力**故另立 M0 |

---

## 8. v1.1|凍結欄 + 填滿把手(2026-08-06)

`docs/25` B 段的網格那一列(20 人月)是 R1 **絕對缺口最大的單一列**,
而剩的兩項就是這兩個。兩者都在 §1.2 被記為殘留。

### 8.1 站②|自己的相依套件(**本模組上次正是在這裡踩的**)

逐字讀 `@glideapps/glide-data-grid@6.0.3` 已安裝版本的型別,不引官網:

| 能力 | 型別出處 | 我方使用 |
|---|---|---|
| `freezeColumns?: number` | `dist/dts/data-editor/data-editor.d.ts:368` → `internal/data-grid/data-grid.d.ts:17`「`readonly freezeColumns: number`」 | **零** |
| `fillHandle?: boolean` | `internal/data-grid/data-grid.d.ts:77`;未列在 `DataEditor` Props 的 `Omit` 清單中 → 可設 | **零** |
| `onFillPattern?: (e: FillPatternEventArgs) => void` | `data-editor.d.ts:64`;逐字「Emitted whenever the user initiats a pattern fill using the fill handle. This event provides both a **patternSource** region and a **fillDestination** region, and **can be prevented**」 | **零** |
| `FillPatternEventArgs { patternSource: Rectangle; fillDestination: Rectangle }` + `PreventableEvent` | `internal/data-grid/event-args.d.ts:90` | — |

> **兩件事都是「打開一個開關 + 接一個事件」**,不是自己畫。
> v0.5 的稽核已經因為漏查這一站而把結論寫錯過一次,這次先查再寫。

### 8.2 站③|Ragic 官方逐字(`doc/107 設定凍結`,本機鏡像,查證 2026-08-06)

> 「如需讓使用者即便將頁面滑到任何地方都可以看到指定的欄或列,您可以**設定凍結**。
> 在**設計模式**中的**表單工具**內選取**設定凍結**。並且設定您**凍結欄或列的數量**
> (欄是從左邊算起,列是從上方算起)。……
> 您也可以在列表頁以相同的操作方式來設定凍結,但要注意
> **列表頁只能設定凍結欄,無法設定凍結列**。」

**三個可直接用的判讀**:
1. 語意是**數量**(從左邊算起 N 欄),不是「選哪幾欄」—— 與 Glide 的 `freezeColumns: number` **完全同構**。
2. **列表頁只凍結欄** —— 我方的網格就是列表頁,故**不做凍結列**,這是 parity 不是偷懶。
3. 設定入口在**設計模式**,不是使用者臨時拖拉。

⚠️ **填滿把手在 Ragic 文件中未查到**(全庫搜「填滿 / 拖曳填滿 / fill」無對應功能頁)。
依〈向上設計三條〉①,「文件沒寫」≠「沒有」→ 標**未查證**,
**不得**寫成「Ragic 沒有填滿把手」,也不拿它當差異化宣稱。
做它的理由是 **Excel 使用者的肌肉記憶**,不是「競品沒有」。

### 8.3 裁定(OQ-GF-N)— ✅ 已裁定 2026-08-06

| # | 議題 | 選項 | 裁定 |
|---|---|---|---|
| **OQ-GF-1** ⭐⭐ | 凍結欄數存哪裡 | A. 表單層設計屬性<br>B. **`view_def.config.freezeColumns`(逐檢視)**<br>C. 個人偏好 | **B** —— 欄位的**選取與順序**已經是逐檢視的(`config.fields`),那麼「從左邊數 2 欄」在不同檢視就是不同的欄。存在表單層會讓同一個數字在 A 檢視凍對、在 B 檢視凍錯。Ragic 的「設計模式」對應到我方的預設檢視 |
| **OQ-GF-2** ⭐⭐ | 🔴 schema 要不要同步加 | — | **要,而且是這條的重點**。`viewConfigSchema` 是 **non-strict zod**,未知鍵**靜默 strip** —— `groupBy` 就是這樣「前端一直在送、存進去是空的、而且沒有任何錯誤」(§view-specs 逐字)。**只改前端 = 什麼都沒改** |
| **OQ-GF-3** | 凍結列做不做 | A. 做<br>B. **不做** | **B** —— Ragic 逐字「列表頁只能設定凍結欄」。我方網格即列表頁 |
| **OQ-GF-4** ⭐ | 填充規則 | A. 複製來源區塊(循環)<br>B. 數列遞增(Excel 式)<br>C. 兩者依內容猜 | **A** —— C 是**猜**,而猜錯的代價是使用者以為填對了(靜默錯值)。B 的邊界極多(日期 / 月份 / 前綴數字 / 混合)。先給可預期的 A,遞增列 P1 並且要有明確的 UI 表達 |
| **OQ-GF-5** ⭐⭐ | 填充走哪條寫入路徑 | A. 自己寫一條<br>B. **與貼上共用 `planPasteCell` + 批次端點** | **B** —— §0.2 的教訓逐字:兩者**共用 `onCellsEdited` 出口**。自己寫一條就會出現「貼上擋得住的東西,拖曳填得進去」 |
| **OQ-GF-6** | 填充要不要擋計算欄 | — | **擋,且回報跳過幾格** —— 與 OQ-GP-4 同一個處置,不另立語意 |

### 8.4 FMEA

| # | 失效 | 嚴重度 | 緩解 |
|---|---|---|---|
| G1 | 填充把計算欄 / 唯讀欄寫壞 | **P0** | 走 `planPasteCell` 同一條白名單 |
| G2 | 填充範圍超出既有列 → 靜默丟掉 | **P0** | 只填**既有列**;不自動加列(加列是貼上才有的語意,拖曳沒有「我要多少列」的表達) |
| G3 | 凍結數大於欄數 → 版面壞掉 | P1 | 存入時 clamp,讀出時再 clamp 一次(欄可能事後被刪) |
| G4 | 凍結欄把整個畫面佔滿 | P1 | 上限(≤ 半數欄且 ≤ 5) |

### 8.5 落地紀錄(2026-08-06)

| 交付 | 位置 |
|---|---|
| `view_def.config.freezeColumns`(後端 + 前端 schema **兩邊**) | `views/view-specs.ts` · `lib/engine/schemas.ts` |
| `GridSheet` 接 `freezeColumns` / `fillHandle` / `onFillPattern` | `packages/ui/src/components/grid-sheet.tsx` |
| 填滿 = 平鋪後餵給**同一支 `onPaste`** | `use-grid-paste.ts` `onFillPattern` |
| 工具列「凍結」面板 | `list-controls.tsx` |

### 8.6 三件量測推翻直覺的事

1. **`scrollWidth` 不隨 `freezeColumns` 改變**(實測 0 / 2 / 3 都是 924)。
   原本想用「可捲寬度變小」當斷言 —— **沒有這個幾何訊號**。
2. **像素全等比對必紅**:Glide 在凍結邊界會畫一道分隔陰影,而且**只在捲動時出現**。
   那是對的行為,不是要擋的東西。
3. **對照組的門檻不能憑感覺設**:右側取樣區只差 **~2.4%**,因為大多是空白格底,
   文字只佔一小部分像素。第一版設 5% 直接紅在**對照組**上,而功能是好的。
   最後改成**相對**斷言(凍結區的變動 < 右側的 1/3),不必為字型或欄寬調參。

### 8.7 e2e 的兩個 canvas 教訓

- **Glide 不吃合成事件**:`PointerEvent` 選不到格(實測),必須用 Playwright 的
  真實滑鼠(CDP input)。
- **座標要含 Glide 自己的列號欄**(`rowMarkers="both"`,實測 ≈ 35px)。
  第一版漏掉它,填滿把手的座標落在格子中間而不是右下角,**拖了什麼都沒發生**。
  canvas 上沒有 DOM 可問,只能照著畫面量 —— 量到的值記在測試檔裡,不憑印象。

### 8.8 殘留

| 殘留 | 說明 |
|---|---|
| 遞增數列填充 | OQ-GF-4 裁定先做複製。要做遞增必須有**看得見的表達**(填完之後讓人知道它猜了什麼),否則靜默錯值 |
| 凍結列 | 刻意不做 —— Ragic 逐字「列表頁只能設定凍結欄」 |
| 設計器面的凍結 | 目前只在列表檢視;表單頁的凍結(Ragic 有)未起 |
