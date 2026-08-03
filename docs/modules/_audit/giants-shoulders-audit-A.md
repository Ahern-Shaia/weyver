# giants-shoulders-audit-A.md — 「站在巨人的肩膀」稽核（第 A 批:連 §0 標題都沒有的 14 份)

| | |
|---|---|
| 稽核日期 | 2026-08-03 |
| 範圍 | `docs/modules/R1/` 之 14 份(見 §2 總表)|
| 判準來源 | `AGENTS.md`〈向上設計三條〉·〈🚫 第一約束〉· `memory/pitfall_giants_shoulders_three_stops` |
| 產出性質 | 只做研究與判斷,**未修改任何 prod code,未修改被稽核的模組文件** |

---

## 1. 方法

三站逐一評分,每站四級:**有一手逐字** / **有引用但無逐字** / **僅推理** / **無**。

| 站 | 查什麼 | 本稽核如何驗 |
|---|---|---|
| ① 自家 repo | 既有 migration / service / schema / 上游 design doc | grep 實際程式碼與 schema,比對文件宣稱 |
| ② 相依套件 | 已安裝版本的 `.d.ts` 與 **doc comment** | 直接讀 `node_modules/.pnpm/**` 型別檔 |
| ③ 競品 | 官方文件**逐字** + 出處 + 查證日期 | 從 `~/Documents/work_work/reference-materials/` 本地鏡像抽取原文比對 |

**⚠️ 兩個方法上的前提**(承 `print-merge` §0-bis 的教訓):

1. **「有無 §0 標題」是近似指標不是判準。** 本批 14 份中,**13 份實際上都有研究**,只是寫在
   §2 上游走查 / §2-bis / §0-bis / §10-bis 或 OQ 的證據欄。逐份讀完後才判定。
2. **「有引用」不等於「引用正確」。** 本稽核對承重引用做了原文抽取複核,並因此抓出一處語意錯置
   (§4.5 form-designer-2d)。

**已實際驗證的項目**(非推測)集中列於 §3,逐項標注驗證方法與結果。

---

## 2. 總表

狀態欄依各檔頭。實害等級:🔴 可能已做錯或做白工 · 🟡 論述站不住 · ⚪ 形式缺漏但實質無礙。

| # | 模組 | 狀態 | ① 自家 repo | ② 相依套件 | ③ 競品 | 實害 |
|---|---|---|---|---|---|---|
| 1 | `form-designer-2d` | SHIPPED v1.0 | ⚠️ 有走查但**漏讀自家 M2 規格與 schema** | ⚠️ 有選型比較,**未讀套件型別** | 有引用但無逐字(**無 URL 無日期**)| 🔴 **已證實 2 處** |
| 2 | `grid-and-excel-import` | SHIPPED v1.1 | 有一手 | 🔴 **無**(§2-bis 逕稱「無向上缺口」)| M0 僅推理 → 0-bis 補一手逐字 | 🔴 **已證實** |
| 3 | `actions-approval` | SHIPPED v1.2 | 有一手 | 🔴 **無**(裁定裝 ZEN,能力未用)| M0 二手 → 0-bis 補一手逐字 | 🔴 **已證實** |
| 4 | `authz` | SHIPPED(後端 M7)| 有一手 | ⚪ 不適用 | 🔴 M0 **僅推理**(0-bis 逐字自承)→ 0-bis 補一手 | 🔴 已自證(3 條旁路已修,2 項裁定待改**無 task**)|
| 5 | `workspace-ia` | SHIPPED v1.0 | 有一手 | ⚪ 不適用 | M0 有引用無逐字 → 0-bis 補一手逐字 + URL | 🔴 已自證(首頁形態,**建議未落地**)|
| 6 | `record-workbench-ui` | SHIPPED v1.2 | **有一手**(v0.5 重新對碼)| ⚪ 不適用 | 🔴 M0 借 Fiori 語彙未對規範 → 0-bis 補齊 | 🔴 已自證並修(跨記錄寫錯資料)|
| 7 | `field-types-parity` | SHIPPED v1.1 | 有一手 | ⚠️ 小漏(未查 `qrcode.react` 已裝)| M0 二手 → 0-bis + **0-ter** 一手逐字 | 🔴 已自證並修(3 項毀資料風險)|
| 8 | `form-designer-ui` | SHIPPED v1.1 | 有一手 | 有一手 | M0 無 → 2-bis 無逐字 → 0-bis 一手逐字 | 🟡 已自證(雙 UI 自創 / layout 並發覆寫)|
| 9 | `formula-and-linkload` | SHIPPED v1.0 | 有一手 | **有一手**(fork 前逐檔驗 MIT)| 有引用但無逐字(**無 URL 無日期**)| 🟡 |
| 10 | `form-engine-core` | SHIPPED v1.0 | 有一手 | 有一手(承 docs/16)+ **自行實測** | 有引用但無逐字(**無 URL**,有日期)| 🟡 |
| 11 | `views-list` | SHIPPED v1.0 | 有一手 | 有一手 | 有引用**近逐字**(已複核屬實;無 URL 無日期)| ⚪ |
| 12 | `form-designer-wysiwyg` | M0 APPROVED | 🔴 首版漏讀 → 同檔內已補正 | ⚪ 不適用 | **有一手逐字 + 路徑 + 生產截圖** | ⚪(錯誤在動工前抓到)|
| 13 | `print-merge` | SHIPPED v1.0 | **有一手** | **有一手** | **有一手逐字 + URL + 查證日期** | ⚪ |
| 14 | `authz-resource-inheritance` | SHIPPED v1.0 | 有一手 | ⚪ 不適用 | **有一手 + 出處 + 日期,且在 M0 前完成** | ⚪ |

**分佈**|🔴 6 份 · 🟡 3 份 · ⚪ 5 份。
**唯一在裁定前(非事後)走完三站的是 #14 `authz-resource-inheritance`。**
**唯一至今三站皆無補做的是 #1 `form-designer-2d`。**

---

## 3. 已驗證的發現(非推測)

以下五項由本稽核直接讀程式碼 / 型別檔 / 競品原文確認,標注驗證方式。

### 3.1 ✅ 已證實|`grid-and-excel-import` §2-bis 的「無向上缺口」是錯的 —— Glide 的貼上能力從未啟用

**文件宣稱**(§2-bis,2026-07-19)逐字:「網格選 Glide…**皆 ✅ 已對齊,無向上缺口**」。

**驗證方式**|讀已安裝之 `@glideapps/glide-data-grid@6.0.3` 型別檔 doc comment,再 grep 全 repo 接線。

套件逐字(`dist/dts/data-editor/data-editor.d.ts`):

> `onPaste` — 「If `onPaste` evaluates to true the grid will attempt to **split the data by tabs and newlines**
> and paste into available cells. The grid **will not attempt to add additional rows** if more data is pasted
> then can fit.」(L376–387)
> `onCellsEdited` — 「Emitted whenever a cell mutation is completed and provides **all edits inbound as a single batch**.」(L31–34)

**實測接線**|`packages/ui/src/components/grid-sheet.tsx:95` **只設了 `getCellsForSelection`**;
全 repo grep `onPaste` / `onCellsEdited` → **零命中**。

**結論**|複製側因 `getCellsForSelection` 而可用,**貼上側僅落在 Glide 的 fallback(單一儲存格)**,
塊狀貼上不可用。「TSV 解析」與「批次寫入」是套件免費提供的,§2-bis 沒讀型別檔就宣告無缺口。
該缺口至 2026-08-01(task #153)才被發現,另立 `grid-paste` 模組。

⚠️ **這比「沒做研究」更貴**:一句「無向上缺口」會關閉後續查核。

### 3.2 ✅ 已證實|`actions-approval` 裝了 ZEN,但只用到一個表達式求值器

**裁定**(OQ-AA-4 = A)逐字:「**裝 GoRules ZEN**(金額/條件路由決策,in-process,per-tenant JDM)…
避免自研條件 DSL」。

**驗證方式**|grep `apps/api/src` 之 ZEN 使用點 + 讀套件 `index.d.ts` 匯出清單 + 讀 `package.json`。

- 全 API 唯一使用點:`apps/api/src/actions/approval.service.ts:1` 匯入 `evaluateExpressionSync`,
  於 L817 呼叫 `evaluateExpressionSync("amount >= threshold", { amount, threshold: step.minAmount })`。
- 套件匯出含 `ZenEngine` / `ZenDecision` / `ZenDecisionContent`(`index.d.ts` L3–25)—— **全未使用**。
- `@gorules/zen-engine@0.54.0` 為原生綁定,`optionalDependencies` 列 **8 個平台二進位**
  (darwin-x64/arm64 · linux-x64/arm64 × gnu/musl · win32 · wasm32-wasi)。

**結論**|付出「原生跨平台二進位相依 + 部署架構面」的成本,換到的是一行常數運算式
`amount >= threshold`;而 OQ-AA-4 宣稱的價值(決策表 no-code、per-tenant JDM、非工程師自改規則)
**一項都未兌現**。0-bis 已記為「價值未兌現」,本稽核確認實際情況比該描述更極端 —— **JDM 引擎根本沒被載入**。

⚠️ 對第①約束(不用寫 code)有直接關聯:金額路由目前仍是**程式結構化組出**,租戶無法自助修改。

### 3.3 ✅ 已證實|`form-designer-2d` 的 `colWidths` / `rowHeights` 至今零 reader

**驗證方式**|grep 全前後端 source。

```
apps/web/src/lib/engine/schemas.ts:313-314          ← 只有 Zod 定義
apps/api/src/form-engine/layout/layout-specs.ts:144-145  ← 只有 Zod 定義(含 min/max 驗證)
```
**其餘命中:0。**

而 `form-designer-2d` §3 M2 逐字列了「+ colSpan/合併 + **列高/欄寬**」、§4.4 逐字「**欄寬/列高 px 可調**」。
= **規格寫了、schema 也建了(連範圍驗證都寫好)、實作走了另一條路,型別檢查與測試都不會抱怨。**

此項已由 `form-designer-wysiwyg` §10-ter 於 2026-08-02 發現並記為教訓;本稽核複驗確認至今仍為零 reader。

### 3.4 ✅ 已證實|`form-designer-2d` OQ-FD2-4 對 Ragic doc/121 的引用**語意錯置**

**裁定**逐字:「分段模型 = **列範圍註記**(`layout.sections`:連續列、一群/表、不可獨立重排)…**證據**:Ragic doc/121」。

**驗證方式**|從本地鏡像抽取原文
`reference-materials/ragic-doc-zh-TW/www.ragic.com/intl/zh-TW/doc/121/sheet-sections.html`。

官方逐字:

> 「表單分段 功能讓你設計表單時可以指定某幾列為一個「分段」,就能夠在同一列上,放多組不同的分段,
> **查看時可以點擊頁籤來切換分段**。」
> 三大優點:「1. **視覺減壓**:切換頁籤、橫向查看不同區塊…3. **提升速度**:單一子表格中超過 100 筆資料,
> 可能會讓資料載入速度變慢…就可以利用分段功能,把某些子表格先「**收**」起來,
> 這樣進入表單時便不會需要一次載入所有子表格的資料。」
> 限制:「每張表單只能夠設置 **一組分段群**」「按照表單中的欄位順序,**由上往下依序分段**…**不能調整各分段順序**」

**對照結果**|裁定**正確捕捉了三條結構限制**(一群/表、連續、不可重排),
但**漏掉了整個功能的目的**:分段的呈現是**頁籤切換**(而非標題列),且存在理由之一是
**收合子表以加快載入**。實作因此做成標題列,拿不到原功能的兩個主要價值。

此錯誤直到 `form-designer-wysiwyg` §10-ter(2026-08-02)才被獨立發現,並以 OQ-FDW-8 = A 裁定改為頁籤。

⚠️ **這是 `print-merge` 0-bis 所警告之「只記編號不記 URL」的第二起實例** ——
第一起是 doc/149 / doc/4 的歸屬互換,這一起更嚴重:**編號指對了,語意讀漏了,而沒有連結就沒有人會回頭看**。

### 3.5 ✅ 已複核屬實|`views-list` 的 Airtable 引用存在且逐字相符(但範圍略寬)

**驗證方式**|抽取 `reference-materials/airtable-support/shared-view-url-filters.html` 原文。

官方逐字:

> 「Users can easily **remove** this condition in the "Filters" menu, so you **shouldn't use this feature
> to hide private data**.」
> 「URL filters **can be removed by anyone you send the link to** so you shouldn't use this feature to hide private data.」

**結論**|引用屬實,OQ-VL-2「forcedFilter 不是安全邊界 → 移出 view 歸 authz 軸」的裁定站得住。

🟡 **一處精確度問題**|該頁講的是**分享連結的 URL 篩選**,模組概括為「view filter 不是安全邊界」。
方向仍成立(Airtable view 本身確非權限邊界),但**引用範圍寬於原文**,且**未附 URL、未附查證日期**。

### 3.6 附帶發現(不在本批範圍,但同型)

`apps/web/src/app/app/forms/[formId]/_components/kanban-view.tsx:147` 仍只註冊 `PointerSensor`,
無 `KeyboardSensor` —— 與 `form-designer-2d` 曾犯、已由 task #109 於 `canvas.tsx` 修正的
WCAG 2.2 SC 2.5.7(拖曳替代)缺口**完全同型**。歸 `views-group-kanban-calendar`(不在本批)。
`@dnd-kit/core@6.3.1` 內建 `KeyboardSensor`(`dist/sensors/keyboard/KeyboardSensor.d.ts`),
`canvas.tsx:184` 已在用 —— 即**同一個 repo 內已有正確做法,另一處仍是錯的**。

---

## 4. 逐模組判斷

### 4.1 `form-designer-2d`(SHIPPED v1.0)— 🔴 本批唯一三站皆未補做

| 站 | 判定 |
|---|---|
| ① | ⚠️ §2 有走查(線性清單 / 即時 per-field DDL / `field_def` 僅 position),但**未讀自家 M2 規格與 schema** → §3.3 |
| ② | ⚠️ OQ-FD2-5 有比較 dnd-kit / react-grid-layout / Glide(選型合理),但**未讀 dnd-kit 型別** → 只註冊 `PointerSensor`,套件內建的 `KeyboardSensor` 未接(後由 #109 修)|
| ③ | 檔頭「證據」列 Ragic doc 編號 21·37·38·35·123·121·50·53·143 + Baserow undo-redo-guide + Airtable forms。**無逐字、無 URL、無查證日期** → §3.4 已證實其中一條讀漏 |

**實害 🔴**|兩處已證實(§3.3 零 reader 的欄寬規格 · §3.4 分段語意錯置)。兩處都不是「少一段研究」,
而是**已出貨的功能形狀是錯的**,且都由後續模組獨立重新發現 —— 代表本模組的 review 迴圈沒有攔截點。

**補查指向**|
- Ragic 分段:`reference-materials/ragic-doc-zh-TW/www.ragic.com/intl/zh-TW/doc/121/sheet-sections.html`
- Ragic 版面/欄寬:同庫 `doc/21/tuning-the-layout-of-your-forms-and-tabs.html`、`doc-kb/306`(105×21 格線)
- 自家:`apps/api/src/form-engine/layout/layout-specs.ts:144-145` · `apps/web/src/lib/engine/schemas.ts:313-314`
- 套件:`node_modules/.pnpm/@dnd-kit+core@6.3.1_*/node_modules/@dnd-kit/core/dist/sensors/keyboard/`

### 4.2 `grid-and-excel-import`(SHIPPED v1.1)— 🔴

①有一手(§2 走查 GridSheet 已封裝、無 bulk API);③M0 僅推理,0-bis(07-29)補到一手逐字 + URL
並抓出兩個真 bug(前導零吃掉、只回第一個錯誤列)。

**②是問題所在,且已證實**(§3.1)。特別值得記的是:§2-bis 是**已經做過 retrospective 的模組**,
卻給出「無向上缺口」的結論 —— 因為它比的是「Glide vs AG Grid vs Handsontable 選哪個」(第③站的問題),
**沒有比「Glide 已經給了什麼」**(第②站)。**兩站問的不是同一件事,做了一站不能宣告另一站無缺口。**

**補查指向**|`@glideapps/glide-data-grid@6.0.3` 之
`dist/dts/data-editor/data-editor.d.ts`(`onPaste` / `onCellsEdited` / `getCellsForSelection` 三段 doc comment)、
`dist/dts/data-editor/copy-paste.d.ts`、`dist/dts/data-editor/use-cells-for-selection.d.ts`。

### 4.3 `actions-approval`(SHIPPED v1.2)— 🔴

①有一手;③M0 僅引 docs/27(二手,Ragic doc 編號無 URL),0-bis(07-28)補一手逐字 + URL,
並自判「階層順序簽 / 並簽排 P1」應改 —— 理由是 **Ragic 官方原生就有動態簽核人 / 會簽擇辦 / 三種加簽**,
「這不是進階,是基準線」。該缺口已由 `approval-advanced` 補上。

**②已證實為空**(§3.2)。

**另一項未列於 0-bis 的觀察**|`approval_def.condition` 目前只由程式組出 `amount >= threshold`,
與 AGENTS〈🚫 第一約束〉之「設定不得外包給顧問 / 核心需求須有 no-code 路徑」相關 ——
金額路由改一個門檻值目前需要什麼路徑,文件未交代。

**補查指向**|`@gorules/zen-engine/index.d.ts`(`ZenEngine` / `ZenDecision` / `ZenDecisionContent`)+
`README.md`(同目錄,14.5KB,含 JDM 載入範例);決定是「用起來」或「移除相依改自研兩行比較」。

### 4.4 `authz`(SHIPPED 後端 M7)— 🔴

0-bis 開頭逐字自承:「**本模組設計時未對照任何競品,純憑推理**」。補做後品質很高
(SharePoint / Jira / Odoo / Salesforce / Confluence / Baserow / NocoDB + 具名 CVE + 全附 URL),
且產出最有價值的一節是「應用層遮罩的旁路清單」—— 三條(WHERE 反推 / ORDER BY 反推 / 快速搜尋掃隱藏欄)
已修(commit `41155c4`)。

**實害 🔴,且有殘留**|0-bis 末行逐字:「角色樹 UI 收斂 / deny-by-default 調整 / 具名預設 UI /
其餘旁路查核 **尚未開 task**」。其中兩項是**已判定「應調整」的既有裁定**(OQ-1 角色樹、OQ-4 deny-by-default),
不是新需求。⚠️ 呼應 `pitfall_rule_without_check_always_drifts`:**寫進 0-bis 不等於處理了**。

**補查指向**|尚未查核的旁路 —— 公式/計算欄引用隱藏欄(CVE-2019-11780)、yes/no oracle(CVE-2024-36259)、
變更歷史洩漏(Ragic 官方明載 hidden 欄資料仍出現在變更歷史)。
Odoo 一手可用本地鏡像 `reference-materials/odoo-docs-18/content/developer/reference/backend/security.rst`。

### 4.5 `workspace-ia`(SHIPPED v1.0)— 🔴

①有一手(抓到 `form_categories` 只有 AdminGuard 端點、forms DTO 缺兩欄);
③M0 引 Ragic 生產實照 + doc 編號(無 URL 無日期),0-bis(07-29)補到很強
(五家首頁對照 + NN/g 兩篇 + Material 3 + D365 官方 + SAP S/4 + 兩篇學術 + NocoDB count issue,全附 URL)。

**實害 🔴**|0-bis 標題逐字:「**我選的首頁形態,正是 SAP 與微軟都已離開的形態**」——
D365 的 AX Role Center 已被 activity-oriented workspaces 取代、S/4HANA 新 My Home 含 To-Dos;
且五家皆有「最近使用 / 我的最愛」,本專案**完全缺席**。0-bis 亦逐字寫「純分類目錄當唯一首頁,**查不到任何主流產品這樣做**」。
icon rail 無文字標籤違反 NN/g 與 Material 3(rail 4+ 目的地至少顯示選中項標籤)。

**殘留**|0-bis 給出「建議的首頁形態」(雙軌:待辦/待簽核/最近使用 + 分類目錄),
但**未見對應 task,亦未落地**;而通知模組 H-1 已 SHIPPED、簽核已 SHIPPED,「無真實事件源」這個原本的擋路理由
(OQ-WIA-3/5)**已不再成立**。

⚠️ 另注意 `form-designer-wysiwyg` OQ-FDW-14 已裁定「分類提到頂部頁籤橫列、左欄改搜尋/篩選面板」,
並自標「範圍溢出 → 需與 workspace-ia 一起修訂」。**兩份文件對 IA 的裁定目前不一致。**

### 4.6 `record-workbench-ui`(SHIPPED v1.2)— 🔴(已修)

①最好的一份:v0.5(2026-07-28)**重新對照程式碼**,逐項確認 A0/A1 已被 `workspace-ia` 與 `views-list` 吸收,
並把 OQ-RWB-1 標為「已被 views-list OQ-VL-7 取代」。這是本批唯一主動做「**重讀自家已交付內容**」的模組。

③0-bis 標題逐字:「**借了 SAP Fiori 的名字卻沒對照其規範**」。補做後對照官方 floorplan 逐項,
抓到一個真缺陷並已修:`<ObjectPage>` 未帶 `key={selected.id}` →
**編輯 A 未存 → 點 B → 儲存把 A 的值寫進 B,且帶 B 的 `expectedVersion`,樂觀鎖擋不住**。
另抓到 anchor bar 未涵蓋全部區段(違反官方硬規則)、關聯區缺表格量級階梯(>400 筆應給 `Show All (x)`)、
`form-workspace.tsx` 全無響應式斷點(v1.2 已補)。

**判斷**|實害為真且已收斂;列 🔴 是因為「借用既有語彙卻不對照其規範」是可重複發生的模式
(專案內另有「Object Page」「Fiori FCL」「List Report」等借詞)。

### 4.7 `field-types-parity`(SHIPPED v1.1)— 🔴(已修)

①有一手(§2 GAP SUMMARY 逐項對碼:RollupService 已完整、link partial、系統欄可投影 audit);
③M0 僅引 docs/27,0-bis(07-28)+ 0-ter(07-29)補到本批最高強度(含本機 PG 實測、逐字引文、
**自我更正一條查無出處的 Ragic 引文**、誠實列出 7 條查不到)。

**實害 🔴**|補研究抓出三項毀資料風險:選項「值即名稱」改名/刪除即毀既有值、
lookup live vs snapshot 未顯式化、型別轉換缺 lossy 層。皆已於 v1.1 落地。

**最值得記的一點**|**0-ter 推翻了 0-bis 自己的三個判斷**(影子欄 30 天 → PG dropped 欄永不回收;
三態 → 四態;選項存 stable id → 反而不能存 id)。
⇒ **一輪補研究不夠。第一輪常給出「聽起來對」的答案。**

②有一處小漏:OQ-FTP-6 寫「barcode 前端以 OSS lib(如 `bwip-js`/`qrcode` MIT)渲染」,
但 `qrcode.react` **當時已因 MFA 而安裝** —— 該事實由後續的 `print-merge` §2 走查發現。成本低,列為佐證而非獨立缺口。

### 4.8 `form-designer-ui`(SHIPPED v1.1)— 🟡

①②皆有一手(後端 API 已齊、缺 position API;TanStack/RHF/Zod 已裝、tRPC 已裝未用皆明列)。

③ 三個階段:M0 無 → §2-bis(07-19,Salesforce Lightning / RJSF / JSON Forms,**無逐字無 URL**)
→ §0-bis(07-29,一手逐字 + 完整 URL)。

**值得記的對比**|§2-bis 的結論是「✅ 已站對…唯一明文化的向上點是 uiSchema 分層」;
§0-bis 的結論卻是「🔴 **新建 / 編輯兩套 UI 是自創**」「🔴 layout 整表 PUT 覆寫 → 兩人同改後寫者覆蓋整張版面」
「🔴 拖曳無鍵盤替代,違反 WCAG 2.2 SC 2.5.7」。
**同一模組,兩輪 retrospective 結論相反** —— 與 §4.2 的 grid 案同型:第一輪 retrospective 傾向自我確認。

**殘留**|0-bis 的優先序清單(重疊策略 / layout 並發覆寫 / 雙模式收斂 / 型別轉換三層化 / palette 搜尋 / 版本史)
中,型別轉換已由 field-types 補、雙模式收斂已由 wysiwyg OQ-FDW-13 裁定;
**layout 並發覆寫(整表 PUT 無樂觀鎖)未見結案記錄**。

### 4.9 `formula-and-linkload`(SHIPPED v1.0)— 🟡

②是本批最佳:fork Teable `packages/formula` 前逐檔驗 MIT 標頭 + `CLEANROOM.md` 登錄 + attribution,
完全符合 AGENTS 鐵則 5。①亦有一手(docs/16 §5 已驗可 fork)。

**🟡 兩點**|
1. §2-bis 的三條「Salesforce 反面教材」(刪子記錄不自動重算 / 不支援 grandchild 多層 / 25 rollup 物件上限)
   是**承重斷言** —— 模組的差異化主張(OQ-FML-9/10、F8「架構免疫」)直接建立其上,
   卻**無一手出處、無 URL、無查證日期**。依〈向上設計三條〉條件 ①,這三條目前不能當硬差異化。
   ⚠️ 特別是「25 rollup/物件上限」是會隨版本改變的具體數字,正是最不該憑印象寫的形態。
2. OQ-FML-4 裁定「Load(快照)與 Lookup(即時)兩者都做」,實際**只落地一半** ——
   `RelationService.load()` 存在但不持久化、無前端帶入、無重整、無稽核。
   **此事由 `field-types-parity` §0-ter 才發現**(其 A-1 逐字:「這不是新決策,是已裁定但只落地一半的設計」)。
   ⇒ SHIPPED 標記與實際交付範圍不符。

**補查指向**|Salesforce Roll-Up Summary 官方 help(線上)· DLRS repo README ·
本地可用 `reference-materials/teable-docs` 與 `baserow-docs` 對照 rollup 語意。

### 4.10 `form-engine-core`(SHIPPED v1.0)— 🟡

①最紮實:上游 docs/15 v2 + docs/16 明確引用且逐項對映;②有一手(docs/16 已拆解三家含授權判定,
Drizzle+Knex 雙軌承 Teable pattern)。

**本批唯一以自行實測取代文獻推測者**|M1 spike(§9-ter)實測 10K 表 catalog(×1.22 近線性)、
並發 DDL advisory lock 開銷、RLS 8 斷言,並產出兩個 production 級發現
(`SET LOCAL` 不可參數綁定 → `set_config`;GUC reset 為 `''` → policy 需 `NULLIF`)。
**這比任何競品文獻都強**,因為承重決策(每表單一張真實表 vs Salesforce flex-column)直接被本機數據背書。

**🟡 一點**|§2-bis 的 Salesforce `MT_Objects` / `MT_Fields` / 單一共享 `MT_Data` 寬表之描述,
是「為何我方選了相反路線」的**承重對照**,卻**無出處連結、僅有「2026-07-19 web 研究」六字**。
Dataverse「標準實體真實表 + 自訂欄部分虛擬化」同樣無出處。
依條件 ①,這兩條應標「待驗證」或補一手。

**判定 🟡 而非 🔴 的理由**|即使該對照有誤,決策仍由 spike 實測獨立支撐,結論不會翻。

### 4.11 `views-list`(SHIPPED v1.0)— ⚪

本批 **M0 期第③站做得最好的一份**:OQ-VL-2 同時引 Airtable + Teable + Ragic 三家,
且結論**推翻上游 `docs/27` §3**(forcedFilter 由 view 屬性軸移出,歸 authz 軸)並回寫上游 ——
這正是〈向上設計三條〉期待的形態:研究改變了裁定,不是替裁定背書。

①②皆有一手(records API 白名單鏈 / `maskRead` 已是後端硬底 → view 選欄天然只能收窄;
Glide 與 `xlsx` 皆已在手)。

**⚪ 形式缺漏**|檔頭證據列的是**本地檔案路徑**而非 URL,且無查證日期。
§3.5 已複核其 Airtable 引用屬實,但**引用範圍寬於原文**(shared-view URL filters → 概括為 view filter)。
結論不受影響,補齊 URL + 日期 + 收窄措辭即可。

### 4.12 `form-designer-wysiwyg`(M0 APPROVED)— ⚪(但含最完整的示範)

本檔同時是**三站全漏的示範**與**補做的最佳範例**:

- **首版三站皆漏**:①漏讀自家 `form-designer-2d` M2 與 `colWidths` schema;
  ③憑「對 Ragic 範式的推論」寫下「直接拖那一格的邊界調欄寬 —— 這正是 Ragic 的作法」而**當時未查證**。
- **三輪查證後**達到本批最高證據等級:§10-bis(doc/37 + 截圖)→ §10-ter(四個本地庫掃描,逐字 + 路徑)
  → §10-quinquies(**兩張真實生產環境截圖**,證據等級高於文件庫)。
- 每一輪都推翻上一輪:版面模型(表單 → 試算表)、示例值(生成 → 真實值)、設計入口(頁籤 → 模式切換)。

**判 ⚪ 的理由**|錯誤全部在**動工前**抓到,M1 之後尚未落地。這是本批唯一「研究趕在成本固化之前」的案例。

**🟡 一個風險**|§10-sexies 自標「範圍溢出警告」:OQ-FDW-13/14/15 分別動路由、動 `workspace-ia`、
動設定中心 IA,而該檔 §1.3 原本宣告「不新增後端端點、零 migration、純前端渲染層」。
**目前 M0 已 APPROVED 的裁定範圍與該檔自己的 scope 邊界不一致**,落地前需先拆模組。

### 4.13 `print-merge`(SHIPPED v1.0)— ⚪ 正面樣板

三站皆有一手:
- ①②合一的漂亮示範:§2 走查抓到 **`qrcode.react` 已因 MFA 安裝** → 直接推導出「P0 僅 QR、零新依賴」,
  並把 Code128 明示為 P1 而非靜默失敗。
- ③檔頭即帶完整 URL,且 0-bis(07-29)**逐篇連線複核標題**,因此抓出自己兩處歸屬錯誤
  (「紙張/邊界/方向委派瀏覽器」原記 doc/149,實際出處 doc/4)。

**核心洞見的形態值得複製**|把 Ragic 的「列印」拆成三件目的與阻塞條件不同的事
(標籤 maker = 完全 in-app / 友善列印 = 委派瀏覽器 / 合併列印 = 需上傳範本),
於是 P0/P1 的切線**是從證據推導出來的,不是先切好再找理由**。

本檔曾被 2026-07-28 稽核以「有無 §0 段」誤判為無證據(偽陽性),其 0-bis 已把該教訓寫回方法論。

### 4.14 `authz-resource-inheritance`(SHIPPED v1.0)— ⚪ 唯一在裁定前走完三站

**本批唯一 research-before-decision 的模組。** §10-bis 為 M0 期 deep-research:
22 來源 → 79 claims → 三票對抗式查證 25 條 → 19 confirmed / 6 killed,
每條建議註明來自哪家廠商文件(Drive `inheritedPermissionsDisabled` / Notion "No more database accidents" /
Purview 容器 label 不繼承 / Salesforce OWD)。

**研究實際翻案**|OQ-ARI-4 由 A(owner 含 design)翻為 B(owner 得資料動作、design 除外),
理由是消費級與企業級**一致**的「用資料 ≠ 改結構」鐵則。並新增了 OQ-ARI-8(Drive 式顯示鎖定 + 申請存取)。

**誠實度亦是本批最高**|明文標注「所有 Ragic claim 在對抗式查證中被駁回或未達票數 → **不以 Ragic 為 baseline**」、
「Airtable / Odoo 本輪無存活 claim → 未查證」。

**唯一缺口(其自身已標注)**|對 parity 對象 Ragic 的一手查證缺席,而本專案定位是 Ragic-parity-first。
`reference-materials/ragic-doc-zh-TW/.../doc/32`(存取權限)與 `doc/11` 本地皆有,可補。

---

## 5. 依實害排序的補查清單

| 序 | 項目 | 為何排這裡 | 具體補查位置 |
|---|---|---|---|
| **1** | **作廢 `grid-and-excel-import` §2-bis「無向上缺口」之結論,並覆查同期同形態的三份 §2-bis** | 已證實錯誤,且該句會關閉後續查核。同期(2026-07-19)以相同形態寫成的 §2-bis 還有 `form-engine-core` / `form-designer-ui` / `formula-and-linkload` **三份**,其中兩份的結論已被後續 0-bis 推翻 | `@glideapps/glide-data-grid@6.0.3` 之 `dist/dts/data-editor/data-editor.d.ts`(L31-34 / L336-362 / L376-387)· `copy-paste.d.ts` · `use-cells-for-selection.d.ts` |
| **2** | **`form-designer-2d` 補 §0(本批唯一零 retrospective),優先兩處已證實項** | 兩處都是已出貨的錯形狀,且都由別的模組重新發現 —— 代表本模組沒有攔截點 | Ragic `doc/121/sheet-sections.html`(分段=頁籤+載入效能)· `doc/21`(欄寬拖曳)· `doc-kb/306`(105×21)· 自家 `layout-specs.ts:144` / `schemas.ts:313` |
| **3** | **`authz` 0-bis 之三項「應調整」開 task** | 已判定應改的**既有裁定**,0-bis 末行明載「尚未開 task」;其中 deny-by-default 直接影響遷移體驗 | 角色樹 UI 收斂 · `new_form_default` 租戶級預設 · 具名預設(檢視者/填單者/…)· 未查核旁路(Odoo 一手見 `odoo-docs-18/content/developer/reference/backend/security.rst`)|
| **4** | **`actions-approval` ZEN 相依決策複查:用起來或移除** | 付原生跨平台二進位相依的成本,只換到 `a >= b`;且第①約束(規則自助化)未兌現 | `@gorules/zen-engine/index.d.ts`(`ZenEngine`/`ZenDecision`)+ 同目錄 `README.md` |
| **5** | **`workspace-ia` 首頁形態:0-bis 的建議未落地,且擋路理由已消失** | 通知與簽核皆已 SHIPPED,OQ-WIA-3/5「無真實事件源」不再成立;且與 `form-designer-wysiwyg` OQ-FDW-14 的 IA 裁定不一致,兩份需一起收斂 | 0-bis 已附完整 URL,不需重查競品;需要的是裁定與 task |
| **6** | **`formula-and-linkload`:三條 Salesforce 反面教材補一手 + Load 落地缺口結案** | 差異化主張建立在三條無出處的斷言上(含「25 rollup 上限」這種會變的數字);OQ-FML-4 只落地一半且由別的模組發現 | Salesforce Roll-Up Summary 官方 help(線上,需附查證日期)· 本地 `teable-docs` / `baserow-docs` 對照 rollup 語意 |
| **7** | **`form-designer-ui`:layout 整表 PUT 並發覆寫(0-bis 🔴 第 2 項)確認是否已結案** | 「兩人同改後寫者覆蓋整張版面」在多人租戶是資料遺失,非體驗問題 | `apps/api/src/form-engine/layout/`(是否有 version / If-Match)|
| **8** | **`form-engine-core` §2-bis · `views-list` 檔頭:補 URL + 查證日期,並收窄 views-list 的概括措辭** | 形式缺漏,結論不受影響,成本低 | Salesforce 多租戶架構白皮書(線上)· `airtable-support/shared-view-url-filters.html`(本地已存)|
| **9** | **`form-designer-wysiwyg`:落地前先拆模組** | OQ-FDW-13/14/15 已 APPROVED 但溢出該檔自己宣告的「純前端、零 migration」邊界 | 該檔 §10-sexies 已自標警告,只需執行 |
| **10** | **`authz-resource-inheritance` 補 Ragic 一手** | 唯一缺口,且我方是 Ragic-parity-first;其 deep-research 明載 Ragic claim 全被駁回 | `ragic-doc-zh-TW/.../doc/32`(存取權限)· `doc/11` |
| — | (範圍外,但同型)`kanban-view.tsx` 補 `KeyboardSensor` | 與 #109 已修的 `canvas.tsx` 完全同型,同 repo 內已有正確做法 | `apps/web/src/app/app/forms/[formId]/_components/kanban-view.tsx:147` |

---

## 6. 共通模式

### 6.1 第②站是全批最弱的一站,而且錯得最貴

第①站 14/14 都做了(品質不一);第③站 13/14 最終都補上了(多數品質很高);
**第②站只有 4 份真正做了**(`print-merge` / `formula-and-linkload` / `form-designer-ui` / `form-engine-core`),
而三個 🔴 中有兩個(§3.1 Glide、§3.2 ZEN)就出在這一站。

**原因可能是**:第②站沒有「研究」的外觀 —— 它不產出對照表、不引用官方文件、
不像做了功課,只是打開 `node_modules` 讀一段 doc comment。**但它是唯一能證偽「這個要自己做」的一站。**

### 6.2 「retrospective 宣告無缺口」比不做研究更危險

`grid-and-excel-import` §2-bis 逐字「皆 ✅ 已對齊,**無向上缺口**」,
`form-designer-ui` §2-bis 逐字「✅ 已站對」—— **兩份的第二輪 retrospective 都得出了相反結論**。

第一輪 retrospective 的提問形態是「**我選對了嗎**」,答案幾乎必然是「選對了」;
真正有殺傷力的提問是「**它已經幫我做了什麼**」與「**它逐字說了什麼**」。

⇒ 建議:**retrospective 不得寫出「無缺口」這種終局結論**,只能寫「本輪查了 X,未查 Y」。

### 6.3 「有引用但只記編號」已造成第二起錯誤

第一起:`print-merge` doc/149 ↔ doc/4 歸屬互換(其 0-bis 自抓)。
第二起:`form-designer-2d` doc/121 分段語意讀漏(§3.4,由別的模組獨立發現)。

第二起更值得警惕:**編號指對了,錯的是讀漏了核心語意**。
`MODULES.md` 現行 P0 規則要求附 URL,理由是「編號無法自我驗證」——
本稽核顯示**附了 URL 也只解一半**,另一半要靠**逐字引用**:
把原文抄進 doc,讀漏的機率就大幅下降(對照 `print-merge` 與 `field-types-parity` §0-ter 的做法)。

### 6.4 一輪補研究不夠

`field-types-parity` §0-ter 推翻了自家 §0-bis 的三個判斷;
`form-designer-wysiwyg` 三輪查證,每輪推翻上一輪;
`form-designer-ui` 兩輪 §2-bis / §0-bis 結論相反。

**第一輪的答案通常是「聽起來對」的那個。** 對承重決策(改動 P0 安全鏈 / 影響資料正確性 / 對外承諾),
單輪研究不應視為完成。

### 6.5 0-bis 產出的「應改」大量沒有 task

`authz` 明載三項「尚未開 task」· `workspace-ia` 的建議首頁形態未落地 ·
`formula-and-linkload` 的 Load 落地缺口由別的模組發現 ·
`form-designer-ui` 的 layout 並發覆寫未見結案。

⇒ 與 `pitfall_rule_without_check_always_drifts` 同源:**寫進文件不等於處理了。**
建議 0-bis 收尾一律要求「每個 🔴 / ⚠️ 對應一個 task 編號或一句明確的『不做及理由』」,
`form-templates` §1.2「明確不做」+ 逐項附理由是可複製的形態。

### 6.6 唯一有效的預防是「裁定前研究」,而本批只有 1/14 做到

`authz-resource-inheritance` 在 M0 期做 deep-research,結果**研究翻掉了自己的建議**(OQ-4 A→B),
且該模組是本批唯一沒有事後補救的 SHIPPED 模組。

其餘 13 份的研究都發生在 SHIPPED 之後 —— 這時發現的問題,成本已經固化成
「已出貨的錯形狀」(§3.3 / §3.4)、「已付出的相依」(§3.2)、「已延後 6 週的核心功能」(§3.1)。

**`form-designer-wysiwyg` 是唯一的例外方向**:它在 M0 就被 review 追問了三次,
三輪查證全部發生在 M1 之後的實作**之前**,因此三個被推翻的模型都沒有變成程式碼。
這一份可以直接當作「被追問到底會發生什麼」的對照組。

---

## 7. 本稽核未做 / 未查證(誠實聲明)

1. 未逐一複核所有 0-bis 引用的線上 URL 是否可達與逐字相符 —— 只抽驗了本地鏡像可對照者
   (Ragic doc/121 · Airtable shared-view-url-filters)。
2. 未查證 `form-engine-core` §2-bis 的 Salesforce `MT_Data` / Dataverse 描述是否屬實 ——
   兩者皆不在本地鏡像內,標為**未查證**。
3. 未查證 `formula-and-linkload` 的三條 Salesforce rollup 反面教材 —— 同上,標為**未查證**。
4. 未評估各模組的**實作品質**,只評估「決策是否站在證據上」。
   一個 🔴 的模組可能程式寫得很好,只是形狀選錯。
5. `Teable`(659 檔)與 `Baserow`(65 檔)兩個本地庫本次僅用於確認路徑存在,**未逐篇比對內容**。
6. 本批之外的 R1 模組(18 份)與 foundation(9 份)不在範圍內;§3.6 的 `kanban-view` 屬順帶發現。
