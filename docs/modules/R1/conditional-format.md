# conditional-format.md — [R1·UP-3b] 條件式格式(form-designer-2d P1 解鎖)設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-28;M1–M4 + FMEA G1–G7)**
> 🔴 **範圍更正:2026-08-03** —— **§0 誤述了本模組所對標的功能是什麼**,連帶使 OQ-CF-8 的裁定依據失效。
> 更正內容見 **§0.0**,重裁選項見 **§10-bis**。**已出貨的程式碼於本輪不動**;本輪只做事實複驗與裁定選項。
>
> **裁定摘要**|1=A 表單級 · 2=A 沿用 12 tone 受控色盤 · 3=A 後者覆蓋(UI 須明示)· 4=A 複用既有 filter 模型 · 5=A 欄位值+標題 · 6=A 純前端求值 · 7=A 記錄頁/列表頁各自獨立 · ~~8=A 條件式行為不納入~~ → **OQ-CF-8 待重裁(§10-bis)**。
> **UI 稿**|`docs/mockups/conditional-format-flow.html`(瀏覽器直開)
>
> **這是 form-designer-2d 的 P1 殘留。** 該模組 SHIPPED 時記錄:
> > ❌ **條件式格式**(顯示/隱藏/唯讀/必填/變色依條件)|docs/27 §1 P1(需規則引擎 UX,隨 actions-approval / ZEN)。
>
> ~~**本模組把該殘留收斂為「純呈現的變色」**;顯示/隱藏/唯讀/必填屬**條件式行為**,性質不同(有安全與驗證含意)→ 見 OQ-CF-8。~~
> **【2026-08-03 更正】** 上游 docs/27 把五項寫成同一項是**對的**,本模組把它拆成兩件事才是誤判 ——
> Ragic 官方文件所稱之「條件式格式」為**一個功能、一個設定入口、一份由上而下求值的規則清單**,「設定顏色」只是其中一個效果類。逐字證據見 §0.2。
>
> 作者:Claude Code(草擬)
> 版本:v1.1(2026-08-03,範圍更正)· v0.1(2026-07-28)
> 上游:docs/27 §1 P1;form-designer-2d §12 殘留;option-colors v1.0(色盤與安全渲染之既有基礎)
> 稽核來源:`docs/modules/_audit/giants-shoulders-audit-B.md` §3.1

---

## 0. 競品證據(clean-room:只讀公開文件與截圖,未接觸任何原始碼)

### 0.0 🔴 更正(2026-08-03):v0.1 問錯了問題

v0.1 的 §0 查的是「**競品的條件式著色長什麼樣**」,沒有查「**競品把這個功能的邊界畫在哪**」。
結果是抄到功能的一部分,卻以為抄到了整個。可稽核的三點:

| # | v0.1 的敘述 | 複驗結果(2026-08-03) |
|---|---|---|
| 1 | 表頭把 Ragic 該功能等同於著色(欄位標題逐字「Ragic(**條件式格式**)」對「Airtable(**record coloring**)」)| ❌ **不等價**。Ragic 該章節含 **10 類效果**,「設定顏色」只是其中之一;Airtable 的 record coloring **確實只有色**。兩者不是同一顆粒度的東西,不該並列於同一欄位比較 |
| 2 | 「作用對象|欄位**值**背景/文字色、**欄位標頭**色、敘述欄位色」 | ⚠️ **就顏色而言正確,但只涵蓋該功能的一格**;顯示/隱藏、唯讀、必填、上鎖分段、上鎖動作按鈕等**同在一份規則清單內**(§0.2) |
| 3 | §1.2 與 OQ-CF-8「條件式行為……**性質不同**」 | ❌ **這不是對 Ragic 的觀察,是本模組自行造出的切分**。Ragic 官方示範的**第一條規則就是「顯示」、第二條才是「變色」**,兩者在同一份清單、同一套由上而下的覆蓋序內 |

**連帶失效**|§0.1 觀察 1 逐字寫著「Ragic-parity-first → **應整套採 Ragic**」,而實際落地採了它的覆蓋序與表單級語意,**切掉了同一功能的其餘九類效果**。前提與結論不一致。

**下表為 v0.1 原文,保留不改**(其對「顏色」一格的描述經複驗仍成立);其涵蓋範圍之更正以 §0.2 為準。

| 面向 | Ragic(條件式格式 —— ⚠️ 僅其「設定顏色」一格)| Airtable(record coloring)|
|---|---|---|
| 設定層級 | **表單級**;且**表單頁與列表頁各自獨立設定**(文件明載「需要分開設定」)| **視圖級**(Grid / Calendar / Kanban / Gallery / Timeline / List / Gantt 各自設定)|
| 條件 | 多條件 AND 或 OR,**一組內不可混用**;**不支援欄位間交叉比較**(需先建輔助公式欄)| 可綁 select 欄選項色,或用 conditions;支援條件分組與 AND/OR 混合 |
| 作用對象 | 欄位**值**背景/文字色、**欄位標頭**色、敘述欄位色。**整列未明載** | **整列**著色 |
| 多規則衝突 | **由上而下,最後一個符合的規則為最終結果**(後者覆蓋)| 規則列表**頂部優先**(前者優先),一筆記錄只有一種顏色 |
| 顏色 | **自由選色**(色彩選擇器)| 受控色盤(與 select 選項色同源)|
| 典型用例 | 逾期(紅/粉底)、庫存不足、待審核 | 逾期(紅)、三日內到期(黃)、已完成(灰)|

> 證據檔:`ragic-doc-zh-TW/.../doc/6/conditional-formatting.html`、`airtable-support/record-coloring-in-airtable.html`。強度:上表皆為明載;「Ragic 整列著色」與「Ragic 視圖層級獨立性」為**未查到**(非證實不存在)。

### 0.1 三個直接影響設計的觀察

1. **兩家的模型是相反的。** Ragic = 表單級 + **欄位級**著色 + 後者覆蓋;Airtable = 視圖級 + **整列**著色 + 前者優先。**不能各取一半**,否則得到一個誰的心智模型都不符的東西。我們是 Ragic-parity-first → 應整套採 Ragic(OQ-CF-1/3/5)。
2. **Ragic 的「表單頁 / 列表頁分開設定」對映到我們是「記錄頁 / 集合視圖」兩組規則** —— 仍屬**表單級**(存 `form_def.layout`),不是我們的 `view_def`。
3. **Ragic 用自由選色,我們剛定了受控色盤。** `docs/14 §0.2`(2026-07-28,option-colors 時所立)明列受控條件第 2 條:「**受控色盤,非自由選色**」。此處必須選邊 → OQ-CF-2。

---

### 0.2 站③|Ragic「條件式格式」的完整範圍(一手逐字,查證日 2026-08-03)

**出處**|`reference-materials/ragic-doc-zh-TW/www.ragic.com/intl/zh-TW/doc/6/conditional-formatting.html`
(線上對應 `https://www.ragic.com/intl/zh-TW/doc/6/conditional-formatting`;本機鏡像抓取日 2026-07-24)。
以下章節標題**逐字照抄自該頁目錄**,順序不變:

> 設定條件式格式 · 顯示或隱藏欄位 · 顯示或隱藏欄位值 · 顯示或隱藏敘述欄位 · 設定顏色 ·
> 顯示、隱藏或上鎖分段 · 顯示訊息 · 顯示、隱藏或上鎖動作按鈕 · 欄位唯讀 · 欄位必填 ·
> 顯示或隱藏開始簽核按鈕 · 指定日期欄位時間或區間 · 指定當前時間 · 指定使用者或群組 ·
> 條件式格式的限制 · 問題排除 · 注意事項

**分類(本模組所做,非官方分類)**|17 個標題拆為三群:

| 群 | 數量 | 標題 |
|---|---|---|
| **效果(條件成立時執行的動作)** | **10 類** | 顯示或隱藏欄位 · 顯示或隱藏欄位值 · 顯示或隱藏敘述欄位 · **設定顏色** · 顯示、隱藏或上鎖分段 · 顯示訊息 · 顯示、隱藏或上鎖動作按鈕 · 欄位唯讀 · 欄位必填 · 顯示或隱藏開始簽核按鈕 |
| **條件側能力** | 3 類 | 指定日期欄位時間或區間 · 指定當前時間 · 指定使用者或群組 |
| 總述 / 限制 / 排錯 / 注意 | 4 | 設定條件式格式 · 條件式格式的限制 · 問題排除 · 注意事項 |

> ⚠️ **與稽核的差異(誠實記錄)**|`giants-shoulders-audit-B.md` §3.1 列 13 個標題並稱「約 12 項」,
> 該處**漏列「指定使用者或群組」**。本節以整頁目錄複驗為準:**17 個標題,其中效果類 10 項**。
> 稽核的方向性結論(「不只是變色」)成立,項數以本節為準。

**功能是一個、清單是一份 —— 逐字依據**:

> 「在 **設計模式** ,點選 **表單工具** 下的 **條件式格式** 。」
> 「點選 **增加規則** ,根據需求來設定條件。像是如果「產品類別」是「巧克力」時,則 **顯示** 「甜度」。」
> 「**也可以設定多個條件式格式**。例如當「產品類別」為「蛋糕」時,**變更欄位值背景為「粉紅色」**。」

即:**同一個入口、同一顆「增加規則」按鈕,第一條規則是「顯示」、第二條是「變色」。**

**四項在 v0.1 完全未被記錄、且直接影響規則模型的語意**:

| # | 逐字原文 | 對模型的含意 |
|---|---|---|
| S1 **雙向邏輯** | 「設定 **條件式格式** 時會自帶 **雙向邏輯** :當條件成立時執行某動作,也同時代表條件不成立時不執行該動作。例如:當設定條件成立時隱藏 A 欄位,也就代表 A 欄位在條件不成立(預設狀態)下是正常顯示的;設定條件符合時 B 欄位必填,也就代表 B 欄位在條件不成立時不會有必填限制。」 | 效果是**三態**(命中 → 套用 / 未命中 → **主動還原為預設**),**不是「命中才寫、未命中不動」**。現行 `evaluateFormats` 對顏色恰好等價(未命中即無色),但對「顯示/隱藏」不等價 —— 這正是官方〈問題排除〉整節在解釋的坑 |
| S2 **覆蓋序是逐欄位、跨效果的** | 「系統在執行條件式格式時會 **由上而下依序套用條件** ,並 **以最後一個套用的條件作為最終顯示結果** 。」官方反例:三條規則裡「實付金額」被兩條涵蓋 → 選「現金」時該欄**反而被隱藏** | 覆蓋序仲裁的單位是「**某欄位的某個效果**」。**兩份分離的清單無法表達跨效果的覆蓋序**(見 §10-bis 選項 A 之代價) |
| S3 **規則層 metadata** | 「設定完條件式格式後,可以為此規則 **設定註解** ,用來記錄規則用途或觸發邏輯。」「你可以點擊右側的 **開關** 來啟用或停用這組條件式格式設定。停用後,該組設定將**變淡並鎖定**,無法進行編輯。」 | 規則需有 `note` 與 `enabled` 兩欄。現行 `formatRuleSchema` 為 `.strict()` 且**兩者皆無** |
| S4 **靜態欄位屬性 × 條件式規則的優先序** | 「(1) 如果已將某個欄位設為 **必填** 或 **隱藏** 時,在條件式格式設定中,便**無法選擇**將該欄位在條件下設為必填或隱藏/顯示欄位及欄位值。」「(3) 欄位設為 **唯讀** 的情況, **條件式格式必會優先於欄位屬性設定** 」。另:「當欄位因條件式格式被 **隱藏** 時,系統會 **略過檢查 必填 及 輸入檢查** 。」 | 效果之間、以及效果與既有 `layout.fields[].hidden/readonly`(§0.5)之間**有明文的仲裁規則**。此為設計必須處理的面,v0.1 未觸及 |

**與 v0.1 一致、複驗成立的三點**(不需更正):

> 「1. 目前若一組條件包含多個判斷時,只能統一使用 **AND** 或是 **OR** 進行關聯,**無法合併兩種關聯方式**」(對應 OQ-CF-4=A)
> 「2. **不支援參照其他欄位的欄位值進行比較**……建議於表單上建立新的自由輸入欄位搭配 **條件公式** 進行檢查」(對應 OQ-CF-4 之公式欄解法)
> 「1. **表單頁及列表頁的條件式格式需要分開設定**。」(對應 OQ-CF-7=A)

**OQ-CF-8 理由 (a) 的一手反證**|官方在同一頁對「隱藏不是安全邊界」的處置是**標注 + 指向欄位級權限,而非因此不做**:

> 「注意:條件式格式的隱藏欄位 **只會作用於排版介面上** ,於修改資料紀錄或通知信中仍會顯示該欄位的資料,因此若希望針對不同使用者權限隱藏該欄位時, **建議使用 欄位層級權限設定** 。」

---

### 0.3 站③|競品把這條線畫在哪(2026-08-03)

**問題**|「顏色與行為混在同一份清單」是慣例還是 Ragic 特例?

| 產品 | 條件式**顏色** | 條件式**行為**(顯示/隱藏/必填/唯讀) | 兩者是否同一份清單 | 授權 / 取材方式 |
|---|---|---|---|---|
| **Ragic** | 「設定顏色」為條件式格式的一格 | 同章 9 類效果 | ✅ **同一入口、同一份規則清單** | 專有;僅讀公開官方文件 |
| **Airtable** | Record coloring:視圖列上的 **Color** 設定 | **不在 Color 裡**;位於表單 / interface 的**每欄「Rules → Visibility」** | ❌ **分離,且載體不同**(顏色=視圖級清單;行為=**欄位級**規則) | 專有;僅讀公開 support 文件 |
| **Teable** | 本機鏡像(659 檔)**查無** row/record coloring 或 conditional format 之說明 → **未查證** | 表單視圖明文為輕量,條件邏輯外包給另一產品面 | **未查證** | `apps/` 為 **AGPL-3.0**、docs 為公開文件 → **只讀 `help.teable.ai` 公開文件,未讀實作** |
| **Baserow** | 本機鏡像僅 65 檔且**全為安裝 / 開發者文件**,無使用者功能說明 → **未查證** | **未查證** | core 為 **MIT**、`enterprise/` 專有 → 本輪**未讀任何原始碼** |

**Airtable 一手逐字**(`airtable-support/record-coloring-in-airtable.html`,查證日 2026-08-03):

> "Record coloring can be applied at the view level in bases, meaning that each different view can have its own unique record coloring configuration."
> "A record can only have one color. In the case of a record that matches multiple conditions, the record will receive the color of **the first condition it matches**, starting from the top of the conditions list."

**Airtable 的條件式行為在另一處**(`airtable-support/building-and-sharing-forms-in-airtable.html`,同日):

> "**Visibility** - Add conditions or conditional groups that will hide the form field from an end user's view unless the submitter's entry causes those conditions to be met."
> "**Setting conditional form field visibility** — In a form field's visibility rules, you can click the cogwheel icon to add condition(s) and/or conditional group(s)."
> "We don't recommend using this for sensitive fields. Although visually hidden, underlying record/field values may still be exposed. **Visibility should not be equated with security in this case.**"

**Teable 一手逐字**(`teable-docs/help.teable.ai/en/basic/view/form.md`,同日):

> "Use App Builder for **conditional logic**, multi-step flows, branded pages, or more complex interactions."
> "Use a Form view when you only need field names, subtitles, required fields, and basic sharing."

**三點結論**:

1. **「混在一起」不是 Ragic 獨有的怪癖,但也不是唯一慣例。** Airtable 是**分離**的 —— 然而它分離的方式是「顏色=清單、行為=**每欄一組規則**」,**不是**「兩份平行的規則清單」。本模組現行的殘留形狀(第二份平行清單)**在兩家都找不到對應**。
2. **「條件式隱藏不是安全邊界」在兩家都是已知的,且兩家都照樣出貨並在文件明文警告。** Airtable 逐字「Visibility should not be equated with security」、Ragic 逐字「建議使用欄位層級權限設定」。該風險的業界處置是**標注 + 指向權限機制**,不是不做。OQ-CF-8 理由 (a) 因此**不足以支撐「另立模組」**。
3. **條件式必填在 Airtable 查無對應**(其 "Required field" 為每欄靜態開關);Teable 明文把條件邏輯移出表單視圖。故「**條件式必填**比其餘效果更重、更晚做」是有旁證的,但那支持的是**效果分層**,不是**整組排除**。

---

### 0.4 站②|自己的相依套件(讀已安裝版本的 `.d.ts`,2026-08-03)

| 套件 | 版本 | 逐字 / 型別事實 | 對本題的用處 |
|---|---|---|---|
| `@gorules/zen-engine` | **0.54.0**(`apps/api` 直接相依,已裝) | `export interface DecisionNode { id: string; name: string; **kind: string**; config: **any** }`;對外函式為 `evaluate(...): **Promise**<ZenEngineResponse>` 與 `evaluateExpressionSync(expression, context): any` | ⚠️ **不能直接當本模組的規則模型**:(a) 為 **NAPI 原生模組**(`@gorules+zen-engine-darwin-arm64`),**無 WASM 版安裝** → 跑不到瀏覽器,而 OQ-CF-6=A 要求**同步前端求值**;(b) `kind: string` + `config: any` **不提供任何型別化的判別式模型**,判別欄仍得自建。**可借的是它的形狀概念**(決策表 = 一份規則列 × 多個輸出欄),不是它的型別。現況僅 `approval.service.ts` 用其 `evaluateExpressionSync` |
| `@glideapps/glide-data-grid` | 6.0.3 | `BaseGridColumn`/`BaseGridCell` 皆有 `readonly themeOverride?: Partial<Theme>`;`TextCell` 等各 cell 型別另有 `readonly **readonly**?: boolean` | **列表頁的「條件式唯讀」不需自建**:套件已於 **cell 層**提供 `readonly`,與現行 M3 已在用的 `themeOverride` 是**同一個回傳物件上的兩個欄位**。即「加一個效果」在集合視圖端的成本是多設一個既有屬性,不是新機制 |
| `react-hook-form` | 7.82.0(宣告於 `packages/ui`) | — | ⚠️ **`packages/ui/src` 與 `apps/web/src` 皆零引用**(grep 無命中)。填單頁未使用表單函式庫 → **不存在可直接接手的條件式必填 / disabled 機制**,不可據此低估必填一項的成本 |

---

### 0.5 站①|自家 repo 現況(對碼複驗,2026-08-03)

| # | 事實 | 出處 |
|---|---|---|
| C1 | `formatRuleSchema` 為 `z.object({ combinator, conditions, targets, tone }).**strict()**`,`tone: z.enum(FORMAT_TONES)` **必填**,**無任何 effect / kind 判別欄**,亦無 `note` / `enabled` | `apps/api/src/form-engine/layout/layout-specs.ts:116-124` |
| C2 | 前端鏡射 schema **未加 `.strict()`** → 遇未知欄位為**靜默剝除**而非報錯。日後補判別欄時,舊版前端讀寫既有規則會**默默丟掉效果欄** | `apps/web/src/lib/engine/schemas.ts:162-167` |
| C3 | 求值器對外簽名為 `evaluateFormats(rules, values, fieldNames): **Map<string, ChipTone>**` —— 回傳型別本身即假設「一個欄位只有一個顏色」,無法承載多效果 | `apps/web/src/lib/engine/conditional-format.ts:91-108` |
| C4 | **無專屬 migration、無專屬資料表**。規則存於 `form_def.layout` JSONB,該欄由 `0010_cute_true_believers.sql` 一行 `ALTER TABLE "form_def" ADD COLUMN "layout" jsonb;` 建立;`layout.conditionalFormats` 為 optional 加法節點 | `apps/api/drizzle/0010_cute_true_believers.sql`;`layout-specs.ts:163` |
| C5 | 全 repo 對 `conditionalFormats` 之引用僅 **4 檔**:兩份 schema、一支整合測試、一支 e2e。**無 seed、無 fixture、無範本、無匯入資料** | `grep -rl conditionalFormats`(排除 `node_modules`)|
| C6 | **靜態版的「隱藏 / 唯讀」早已出貨,且同樣只在前端生效** —— `fieldLayoutSchema` 含 `readonly?: boolean` 與 `hidden?: boolean`,由設計器 `field-settings.tsx` 設定、`header-fields.tsx` 消費;**後端未見任何寫入路徑檢查 layout 的 readonly/hidden** | `layout-specs.ts:44-56`;`field-settings.tsx:167-176`;`header-fields.tsx:52` |
| C7 | **`required` 則相反 —— 是 `field_def` 上的真實屬性,且後端寫入路徑強制** | `form-specs.ts:23`;`record.service.ts:1869`(`if (field.row.required) throw new RequiredFieldError(name)`)|
| C8 | 分段(`sections`)已在 layout 內;動作按鈕為**獨立模組且伺服器端執行**,其 spec **不含任何條件欄位** | `layout-specs.ts:151`;`apps/api/src/actions/`(`button.service.ts` / `action-specs.ts`)|

**C6 + C7 合起來推翻 OQ-CF-8 理由 (b) 的一半。** 原理由逐字為「**條件式必填若只在前端即為裝飾**」——
該敘述對**必填**成立(C7:必填是伺服器強制的真實屬性),對**顯示/隱藏/唯讀**則不成立:
**本專案已經出貨了純前端的靜態 `hidden` / `readonly`**(C6),且未因此被視為裝飾。
以「只在前端就是裝飾」為由排除**整組**效果,與自家已出貨的形狀不一致。

**C4 + C5 是本次裁定的時間窗。** 「改動已出貨 schema」的成本目前是
**兩份 schema 定義 + 一支整合測試 + 一支 e2e**,**無任何真實租戶資料**(R1 尚未對外上線)。
此成本**只會單調上升**,且上升的斜率在首個 pilot 遷移進來的那天最陡。

---

### 0.6 誠實聲明(查了什麼 / 沒查什麼 / 證據強度)

**已查且為一手逐字**|Ragic `doc/6/conditional-formatting` **整頁全文**(本機鏡像,抓取日 2026-07-24;
本次查證日 2026-08-03)· Airtable record coloring 與 forms 兩頁全文 · Teable `basic/view/form.md` ·
本專案 `layout-specs.ts` / `schemas.ts` / `conditional-format.ts` / `record.service.ts` / `form-specs.ts` 對碼 ·
`@gorules/zen-engine@0.54.0` 與 `@glideapps/glide-data-grid@6.0.3` 之已安裝 `.d.ts`。

**查不到 / 未查證(不得寫成「沒有」)**|

- **Ragic 的規則在資料層是一份還是多份** —— 官方文件只證明 **UI 是一個入口、一份清單**;其內部儲存形狀**未查證**。
- **Ragic 的「顯示訊息」「上鎖動作按鈕」「開始簽核按鈕」三項的實際 UI 形狀與參數** —— 僅有文字說明,本機鏡像**未含對應截圖**。
- **Ragic 之效果與條件的上限數量**(規則數 / 條件數)—— 官方未載。
- **Teable 是否具備條件式著色 / 條件式欄位行為** —— 本機 659 檔鏡像查無,**未查證**(非「沒有」);其 App Builder 頁未讀。
- **Baserow 的 row coloring 與表單條件** —— 本機鏡像僅安裝 / 開發者文件,**未查證**。
- **鼎新 / 正航 / 千奧等 ERP 的對應能力** —— **未查證**。
- **本模組現行實作於 200 列 × 20 規則之效能**(FMEA G6 殘留)—— 仍**未壓測**;若效果數增加,該殘留的權重上升。

**證據強度**|§0.2(Ragic 範圍)= **高**(整頁一手逐字,可覆驗)· §0.3(競品切線)= **中**
(Airtable 高、Teable 低、Baserow 無)· §0.4(相依套件)= **高**(讀已安裝版本型別)·
§0.5(自家現況)= **高**(對碼,附行號)。

**clean-room 聲明**|本輪**未閱讀任何競品原始碼**。Teable `apps/` 為 AGPL-3.0、Baserow `enterprise/` 為專有、
NocoDB 與 Directus 已非 OSS —— 一律只讀公開文件。Ragic / Airtable 為專有,僅讀其公開說明文件並以引用標注出處。

### 0.7 來源

Ragic|[條件式格式](https://www.ragic.com/intl/zh-TW/doc/6/conditional-formatting)(本機鏡像 `ragic-doc-zh-TW/www.ragic.com/intl/zh-TW/doc/6/conditional-formatting.html`)
Airtable|[Record coloring](https://support.airtable.com/docs/record-coloring-in-airtable) · [Building and sharing forms](https://support.airtable.com/docs/building-and-sharing-forms-in-airtable)
Teable|[Form view](https://help.teable.ai/en/basic/view/form)(AGPL-3.0 專案之公開文件;未讀實作)
Baserow|本機鏡像僅開發者文件,使用者功能文件未收錄 → 未查證
相依套件|`@gorules/zen-engine@0.54.0` `index.d.ts` · `@glideapps/glide-data-grid@6.0.3` `internal/data-grid/data-grid-types.d.ts`
內部|`docs/modules/_audit/giants-shoulders-audit-B.md` §3.1 · `docs/27` §1 P1 · `docs/modules/R1/form-designer-2d.md` §12

---

## 1. 目標與範圍

### 1.1 目標(P0)
1. **規則模型**|每張表可設多條規則:條件(複用既有 `viewFilterCondition`)→ 對指定欄位套色。
2. **兩個作用面**|**記錄頁**與**集合視圖**各自一組規則(Ragic 範式)。
3. **設定 UI**|於 2D 設計器內設定(承 form-designer-2d 之「表單工具」位置)。
4. **零 migration / 零新端點**|規則存 `form_def.layout`(既有 JSONB),求值於前端(記錄值已在手)。

### 1.2 不做的事
- ~~❌ **條件式行為(顯示/隱藏/唯讀/必填)**|見 OQ-CF-8;性質是邏輯不是格式,且**條件式隱藏不是安全邊界**、條件式必填若只在前端即為裝飾 → 需後端參與,自成模組。~~
  🔴 **【2026-08-03 更正】** 此條之三項依據經複驗有兩項不成立:「性質是邏輯不是格式」是本模組自造的切分(§0.0)、
  「只在前端即為裝飾」與自家已出貨的靜態 `hidden`/`readonly` 不一致(§0.5 C6)。
  僅「**條件式必填**需後端參與」一項成立(§0.5 C7)。**本項之去留改由 §10-bis 重裁。**
- ❌ **整列著色**|Airtable 範式;`option-colors` OQ-OC-3 已裁定為獨立議題。
- ❌ **欄位間交叉比較**(如「交期 < 今天」)|Ragic 亦不支援,其解法是先建公式欄 —— 我們的公式引擎已 SHIPPED,同一解法可用(OQ-CF-4)。
- ❌ **圖示 / 粗體 / 資料條**|Ragic 未見;先只做色。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 條件模型 | ✅ `viewFilterConditionSchema`(field/op/value)+ 單層 AND\|OR(views-list OQ-VL-1)| **直接複用**,零新概念 |
| 色盤 | ✅ 12 tone 受控色盤 + `chipToneClass` 白名單(option-colors v1.0)| 直接複用 |
| 規則存放 | ✅ `form_def.layout` JSONB(form-designer-2d,已含 `fields` / `print` / 靜態元素)| 加 `conditionalFormats` 節點 → 零 migration |
| 求值資料 | ✅ 記錄值已在前端(集合視圖與記錄頁皆持有 records) | 純前端求值,零新端點 |
| 設定入口 | ✅ 2D 設計器已有「版面設計」工具列(文字/圖片/分段/動作/列印) | 加「條件式格式」一項 |
| 安全 | ✅ 色值一律經白名單映射(option-colors FMEA C1) | 沿用同一入口 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 模型 + 求值** | `layout.conditionalFormats` schema(後端邊界驗證)+ 純函式求值器(`evaluateFormats`)+ 單元測(運算子 / AND·OR / 覆蓋序)| 0.04 mo |
| **M2 設定 UI** | 設計器「條件式格式」面板:規則清單(條件 + 目標欄 + 色)+ 記錄頁/列表頁分頁 + 即時預覽 | 0.06 mo |
| **M3 呈現** | 記錄頁欄位值/標題上色 + 集合視圖儲存格上色(Glide `themeOverride`)| 0.04 mo |
| **M4 收尾** | `conditional-format.spec` + FMEA + doc v1.0 + MODULES + 回填 form-designer-2d 殘留 | 0.02 mo |

**合計 ≈ 0.16 mo**(form-designer-2d 既列人月內之 P1 子件,不新增總量)。前後端分開 commit。

---

## 4. 設計要點

### 4.1 規則模型(M1)
```ts
layout.conditionalFormats = {
  record: Rule[],   // 記錄頁(Ragic「表單頁」)
  list:   Rule[],   // 集合視圖(Ragic「列表頁」)
}
Rule = {
  filter: { combinator: "and" | "or", conditions: FilterCondition[] },  // 複用 views 之型
  targets: string[],       // 欄位顯示名;空陣列 = 該規則所涉之全部欄位
  tone: ChipTone,          // 12 受控 tone(非自由 hex)
}
```
- 上限:每面 20 條規則、每條 20 個條件(對齊既有 filter 上限)。
- **覆蓋序**:由上而下逐條套用,**後符合者覆蓋前者**(Ragic 語意)→ UI 需明示「排越後面越優先」(OQ-CF-3)。

### 4.2 求值(M1;純函式)
`evaluateFormats(rules, record) → Map<欄位名, ChipTone>`,無 I/O、可完整單元測。
運算子語意**必須與後端 filter 一致**(同一組 `FILTER_OPERATORS`),否則「篩選看到的」與「上色看到的」會不一致。

### 4.3 呈現(M3)
- 記錄頁:欄位值套 `chipToneClass` 之字/框/底(沿用 option-colors 之白名單入口)。
- 集合視圖:Glide 之 `themeOverride`(每 cell 可覆寫前景/背景)。
- **色永遠不是唯一訊號**:承 option-colors FMEA C2,值本身恆可讀(不以色取代文字)。

---

## 10. 開放問題(OQ-CF-N)— ✅ 已裁定 2026-07-28(全採建議)

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-CF-1** ⭐ | 規則存放層級 | A. **表單級**(`form_def.layout`,記錄頁/列表頁兩組)<br>B. 視圖級(`view_def.config`,每個儲存檢視一組)<br>C. 兩者 | **A** — Ragic 明載為表單級且表單頁/列表頁分開,客戶心智模型如此;B 是 Airtable 範式。C 會產生「兩處都能設、誰蓋誰」的解釋負擔。**代價**:同一張表的不同儲存檢視無法有不同配色 —— 若日後客戶要,再以 B 疊加(向後相容) |
| **OQ-CF-2** ⭐ | 顏色來源 | A. **沿用 12 tone 受控色盤**<br>B. 自由選色(Ragic parity)| **A** — `docs/14 §0.2` 才剛立「受控色盤,非自由選色」(option-colors 時你裁定推翻裝飾配色禁令時所附的受控條件),此處自相矛盾地開放自由色會讓那條規則失去意義。**誠實代價**:遷移時客戶既有的自訂色需映射到最近的 tone(非完全 parity)→ §12 明列。若你認為遷移必須色色相符,B 是有據的翻案 |
| **OQ-CF-3** | 多規則衝突 | A. **後者覆蓋**(Ragic)<br>B. 前者優先(Airtable)| **A** — Ragic parity。**但 UI 必須明示**「排越後面越優先」,否則與多數人對「規則列表」的直覺(上面優先)相反 —— 這是採 A 的必要配套 |
| **OQ-CF-4** | 條件能力 | A. **複用既有 filter 模型**(單層 AND\|OR、不支援欄位間比較)<br>B. 加欄位間比較 | **A** — Ragic 亦不支援欄位間比較,其解法是先建輔助公式欄;我們**公式引擎已 SHIPPED**,同一解法立即可用。複用既有模型 = 零新概念、運算子語意自動與篩選一致 |
| **OQ-CF-5** | 作用對象 | A. **欄位值 + 欄位標題**(Ragic)<br>B. 加整列著色 | **A** — 整列著色是 Airtable 範式,且 option-colors OQ-OC-3 已裁定為獨立議題(記錄層級)。混入會使本模組同時橫跨欄位級與記錄級兩種語意 |
| **OQ-CF-6** | 求值位置 | A. **純前端**(記錄值已在手)<br>B. 後端算好隨記錄回傳 | **A** — 格式屬呈現層;A = 零新端點、零 migration、規則改動即時生效。B 會讓每筆記錄回應變肥,且格式改動需重打 API |
| **OQ-CF-7** | 記錄頁與列表頁是否共用一組規則 | A. **各自獨立**(Ragic)<br>B. 共用一組 | **A** — Ragic 明載分開設定;兩面資訊密度不同(列表要掃視、記錄頁要細看),常需不同強度。代價是設定兩次 → UI 提供「複製到另一面」按鈕緩解 |
| ~~**OQ-CF-8**~~ ⭐ | ~~條件式**行為**(顯示/隱藏/唯讀/必填)是否納入~~ | ~~A. **不納入,另立模組**<br>B. 本模組一起做~~ | 🔴 **2026-08-03 撤銷,重裁見 §10-bis**。原文保留:「**A** — 三個理由:(a) **條件式隱藏不是安全邊界**(同 OQ-VL-2 forcedFilter 之教訓:呈現層過濾 ≠ 授權),誤用會造成以為藏起來就安全;(b) **條件式必填若只在前端即為裝飾**,要有效必須後端驗證 → 需改記錄寫入路徑;(c) 納入會把一個「純呈現、零安全面」的模組變成有安全與驗證面的模組,風險與工期都跳級。docs/27 §1 把兩者寫在一起,但它們性質不同」。**撤銷理由**:(a) 有一手反證(Ragic 與 Airtable 皆出貨且明文警告,§0.2 / §0.3);(b) 僅對必填成立(§0.5 C6/C7);(c) 之「純呈現」前提本身來自 §0 的誤述 |

---

## 10-bis. OQ-CF-8 重裁(2026-08-03)—— ⏳ 待裁定

### 問題重述

本模組已出貨的 `formatRuleSchema` 是 `.strict()`、`tone` **必填**、**無判別欄**(§0.5 C1),
因此規則清單**天生只能是格式規則**。而所對標的功能實際含 **10 類效果**(§0.2),顏色只是其一。
待決的不是「要不要做那九類」,而是「**它們要住在哪一份規則清單裡**」——
這個決定會固化資料形狀,而資料形狀的改動成本隨時間單調上升。

### 判準(依 `AGENTS.md`)

| 判準 | 說明 |
|---|---|
| **一件事一個入口** | 「當狀態=已結案時……」若需在兩處各設一次,即為「同一件事兩個設定入口、兩份真相」,本專案已於 OQ-TPL-10 / OQ-SC-4 反覆否決該形狀 |
| **覆蓋序可表達** | Ragic 的仲裁單位是「某欄位的某個效果」,由上而下、後者覆蓋(§0.2 S2)。分離的清單**在結構上無法**表達跨效果的單一順序 |
| **不用寫 code** | 十類效果對使用者是同一個心智動作(「條件成立時,對這個欄位做某事」)。切成兩個功能是把實作邊界外洩給使用者 |
| **代價的時間性** | 現在無真實租戶資料(§0.5 C4/C5);pilot 遷移之後代價最高 |

### 選項

#### 選項 A|維持現狀:另開第二份「條件式行為」規則清單

- **要動的**|不動已出貨的 schema。新增 `layout.conditionalBehaviors`(或獨立模組之新結構)+ 第二個設定面板 + 第二支求值器。
- **對使用者的可見後果**|**同一句話要設兩次**。「當狀態=已結案時,把總金額變灰**且**設為唯讀」需在兩個面板各建一條條件完全相同的規則;日後改條件要改兩處,漏改一處即靜默不一致。
- **覆蓋序**|**表達不出來**。兩份清單各自由上而下,但「格式清單的第 3 條」與「行為清單的第 1 條」孰先孰後**沒有定義**;而 Ragic 的官方〈問題排除〉整節正是在教使用者處理同一欄位被多條規則涵蓋時的順序 —— 分成兩份後,那套解釋在本產品裡不成立。
- **以後補不補得回來**|**補得回來,但補的方式就是選項 B/C**,且屆時要多做一次**兩份清單的合併遷移**(把使用者已建的行為規則併回格式清單並重排順序)。**代價嚴格大於現在直接做**。
- **唯一實質優點**|本輪零改動、零風險。

#### 選項 B|現在就把規則升為判別式,並一次補齊十類效果

- **要動的**|`formatRuleSchema` 之 `tone` 轉選配 + 加判別欄(或 `effects[]`)· 前端鏡射 schema · 求值器回傳型別由 `Map<string, ChipTone>` 改為多效果結構 · 設定面板 · 記錄頁與集合視圖的消費端 · 加上必填 / 動作按鈕上鎖的**後端強制**。
- **對使用者的可見後果**|與 Ragic 一致的單一入口單一清單。
- **代價**|**把一個純呈現模組一次拉進伺服器強制的範圍**。必填(§0.5 C7)與動作按鈕上鎖(§0.5 C8,伺服器端執行且 spec 無條件欄位)兩項各自需要改寫入路徑 / 動作授權路徑,且必須處理 §0.2 S1 雙向邏輯與 S4 靜態屬性優先序。**原 OQ-CF-8 理由 (c)「風險與工期跳級」對這個選項仍然成立** —— 它只是不成立於「整組排除」。
- **以後補不補得回來**|不適用(即是現在補齊)。

#### 選項 C ⭐|**現在只改形狀,效果分層漸進補** — ✅ **已裁定並落地 C-1(2026-08-03)**

> **C-1 已出貨**|規則升為 `{ combinator, conditions, targets, effects[], note?, enabled }`,
> `effects` 為判別式聯集(目前僅 `{ kind: "color", tone }`);
> **相容讀取器**以 `z.preprocess` 把舊 `{ …, tone }` 升級為 `{ effects: [{ kind:"color", tone }] }`,
> 前後端同構。求值器取「最後一個 `color`」(同規則內後者覆蓋,與跨規則同語意)並吃 `enabled`。
>
> **相容性由既有測試證明**:`layout.integration.test.ts` 與 `conditional-format.spec.ts`
> **仍送舊形狀**且全數通過(含 FMEA G1「tone 非白名單 → 400」)——
> 那不是沒改到,是**刻意留著當相容讀取器的活體驗證**。
>
> **另補一條防禦**:求值器對 `effects` 缺席不再假設型別為真(`Array.isArray` 兜底)。
> 型別不是執行期保證,而渲染前最後一道要能吞掉舊備份 / 手改的 JSONB,
> 不是整頁白畫面。新增 `FMEA G1-bis`。
>
> **C-2 / C-3 未動**:純呈現效果(hide / readonly / section / message)與
> 需伺服器參與的三項(required / 動作按鈕 / 簽核按鈕)各自另排。
> ⚠️ **本步不新增任何伺服器強制面。**
>
> **實走驗證**|設計器新增規則 → 改色 → 存版面 → 讀 API 確認持久化為 `effects[]` 新形狀。
>
> ---
>
> **C-2 已出貨(2026-08-03,同日)|`hide` + `readonly` 兩種純呈現效果**
>
> 範圍收斂理由:這兩種**有既有的靜態對照面**(`fields[].hidden` / `readonly`,
> 皆已出貨且同為前端生效),S4 仲裁才答得出來。`message` 沒有既有對照面、
> `section` 已隨 form-designer-2d R1 移交 `form-designer-wysiwyg`,兩者不在本批。
>
> - **S1 三態 by construction**|求值器每次從零重算 → 未命中天然回到預設。
>   ⚠️ 這一點**對顏色恰好等價、對隱藏不等價** —— 改成增量更新就會「藏了回不來」,
>   而畫面看起來完全正常。e2e 第二段(改值 → 欄位回來)專盯此點。
> - **S4 仲裁**逐條對官方原文落地於 `resolveFieldAttrs()`:
>   唯讀「條件式必優先」→ 規則有講聽規則、沒講回靜態值(**不是一律覆蓋成 false**)·
>   靜態隱藏為終局 · 因規則隱藏 → `skipValidation`。
>   **但靜態隱藏不觸發略過** —— 兩者成因不同:靜態隱藏是設計者一開始就決定不填這欄,
>   條件式隱藏是「此情境下不適用」才需要連帶放掉必填。
> - **設計器同批加效果選擇器**,並把「隱藏不是權限」寫進 UI 而非只留註解。
>   加 schema 的同一批就要加寫入端,否則又是一個「欄位存在、沒人寫得進去」的陷阱
>   (`form-designer-2d` 的 `colWidths` 剛因為同一個理由被移除)。
> - **仍不改任何伺服器強制面。** C-3(`required` / 動作按鈕 / 簽核按鈕)另排。
> - 驗證|web 213 + `conditional-format.spec` 5 + api 1008 綠;
>   MCP 實走「打 HIDE → 欄位消失 → 改回 → 欄位回來」。

#### 原選項說明(保留)

把「規則模型的形狀」與「效果的覆蓋面」**解耦**:形狀現在定死,效果照風險分層出貨。

- **C-1(本輪之後最小改動)**|規則升為 `{ combinator, conditions, targets, **effects: Effect[]**, note?, enabled? }`,
  `Effect` 為**判別式聯集**(`{ kind: "color", tone }` / `{ kind: "hide" }` / `{ kind: "readonly" }` / …),
  並保留**相容讀取器**:既有 `{ …, tone }` 於解析時升級為 `{ effects: [{ kind: "color", tone }] }`。
  求值器回傳改為 `Map<欄位名, EffectState>`。**此步不新增任何伺服器強制面。**
- **C-2(純呈現效果,與已出貨的靜態版同級)**|`color` · `hide`(欄位 / 欄位值 / 敘述欄位)· `readonly` · `section` 顯示隱藏上鎖 · `message`。
  依據:靜態 `hidden`/`readonly` 已出貨且同為前端生效(§0.5 C6),集合視圖側 Glide 已提供 cell 層 `readonly`(§0.4)。
  同批**必須**落地 §0.2 S1 雙向邏輯與 S4 優先序,並沿用 Ragic / Airtable 的明文警告(隱藏不是權限,欄位級保護走權限設定)。
- **C-3(需伺服器參與,單獨排程)**|`required` · 動作按鈕顯示 / 隱藏 / 上鎖 · 開始簽核按鈕。
  這三項各自要改記錄寫入路徑 / 動作授權路徑,**其風險正是原 OQ-CF-8 理由 (c) 所指** —— 保留該顧慮,但作用對象縮小到真正需要它的三項,而非十項。
- **對使用者的可見後果**|**一個入口、一份清單**;未實作的效果在面板上**不出現**(不是出現但無效)。C-3 落地時使用者不需要搬遷任何既有規則。
- **代價**|C-1 需動已出貨的兩份 schema + 求值器 + 面板 + 兩個消費端。以 §0.5 C4/C5 複驗,**受影響的持久化資料為零**,受影響的測試為一支整合測試 + 一支 e2e。
- **以後補不補得回來**|**C-1 是本題唯一「現在不做、以後補會顯著變貴」的部分。** 效果本身隨時可加(判別式聯集是加法的);但**判別欄本身**一旦錯過,就要在有真實資料時做資料轉換,並且期間所有新規則都會以舊形狀寫入。另有一個具體的靜默失效:前端鏡射 schema **未加 `.strict()`**(§0.5 C2),舊版前端讀到帶判別欄的規則會**默默剝除**而非報錯 —— 版本混用期會掉效果。

#### 選項 D|採 Airtable 範式:顏色留清單,行為改掛在**欄位**上

- **形狀**|顏色維持現行 `conditionalFormats`;行為改為 `layout.fields[fieldId].visibilityRules` 之類的**每欄規則**(Airtable 的實際做法,§0.3)。
- **優點**|與既有 `fields[].hidden` / `readonly`(§0.5 C6)同住一處,靜態與條件式的優先序(§0.2 S4)自然落在同一個物件上。
- **代價**|(a) **與 Ragic 心智模型相反**,而本專案為 Ragic-parity-first,且 §0.1 觀察 1 已裁定「不能各取一半」;(b) 「一條規則同時影響多個欄位」在 Ragic 是常態(`targets[]`),改為每欄掛規則後,同一條件要在每個受影響欄位重複一次 —— **比選項 A 更碎**;(c) 分段 / 動作按鈕 / 簽核按鈕**不是欄位**,掛不上去,仍需第三處。
- **列出的理由**|它是**唯一有競品實證**的分離方案。若日後裁定要偏離 Ragic,這是有據的形狀;但作為 R1 parity 的解不成立。

### 對照表

| | A 第二份清單 | B 一次補齊 | **C 先改形狀、效果分層** | D Airtable 範式 |
|---|---|---|---|---|
| 使用者看到幾個入口 | **2** | 1 | **1** | 2(且行為端更碎) |
| 覆蓋序可表達 | ❌ | ✅ | ✅ | 部分(欄內可,跨欄不適用) |
| 本輪之後的改動面 | 無(改動延後) | 大(含伺服器強制) | **中(形狀 + 純呈現效果)** | 中 |
| 受影響的既有資料 | 0 | 0(現在做) | **0(現在做)** | 0 |
| 引入伺服器強制面 | 延後 | **立即** | **延到 C-3** | 延後 |
| 事後補救成本 | **最高**(需合併遷移) | — | 低(效果為加法) | 高 |
| 與 Ragic parity | ❌ | ✅ | ✅ | ❌ |

### 建議

**採選項 C。** 依據四點,依證據強度排序:

1. **代價的非對稱性是可量化的,不是判斷題。** 目前 `conditionalFormats` 的持久化資料為零、引用僅 4 檔(§0.5 C4/C5),
   而 R1 尚未對外上線;此刻改形狀的成本接近改兩份 schema 定義。選項 A 把同一筆成本延後,
   並額外附加一次「兩份清單合併」的遷移 —— **A 的總成本嚴格大於 C,且差額隨時間擴大。**
2. **原裁定的三條理由中,兩條已被一手證據推翻,第三條只對三個效果成立。**
   (a) 有 Ragic 與 Airtable 的明文處置為反證(§0.2 / §0.3);(b) 與自家已出貨的靜態 `hidden`/`readonly` 不一致(§0.5 C6);
   (c) 仍然成立,但作用對象是 `required` / 動作按鈕 / 簽核按鈕三項 —— **C-3 完整保留了這條顧慮**,只是不讓它連坐其餘七項。
3. **選項 A 會讓一段官方文件的核心說明在本產品裡失去意義。** Ragic 用**一整節〈問題排除〉**解釋
   「同一欄位被多條規則涵蓋時,由上而下、後者覆蓋」;分成兩份清單後,跨清單的順序無從定義(§0.2 S2)。
   對遷移進來的既有 Ragic 使用者,這不是少一個功能,而是**同一個設定在新系統會得到不同結果**。
4. **選項 B 的顧慮是真的,但不必現在承擔。** 必填為伺服器強制屬性(§0.5 C7)、動作按鈕在伺服器端執行且其 spec 無條件欄位(§0.5 C8);
   把這三項與純呈現效果綁在同一批出貨,會重演原 OQ-CF-8 理由 (c) 所擔心的跳級。C 的分層讓形狀決定與風險決定**分開下**。

**建議同時處理的三個附帶項**(皆為本次複驗新發現,與判別欄同批做最省):
`note` 與 `enabled` 兩個規則層欄位(§0.2 S3)· **雙向邏輯**之三態語意(§0.2 S1)·
前端鏡射 schema 補 `.strict()` 或明確定義未知效果之降級行為(§0.5 C2)。

**若裁定為 A**,建議至少同批補一項可稽核的防護:於行為清單與格式清單**互相標示**對方存在,
並在兩份清單同時涵蓋同一欄位時於設計器出示警示 —— 這無法解決覆蓋序,但能讓「兩份真相」被看見而非靜默。

---

## 12. 失效場景反思(FMEA)— ✅ M4 收尾確認(2026-07-28)

> **結論**|P0(G1/G2)已緩解;G3–G7 皆有斷言或明確落地。

| # | 場景 | 落地緩解 | Sev | 狀態 |
|---|---|---|---|---|
| G1 | 色值被拼接進 class/style → 樣式注入 | ✅ **三處皆白名單查表**:後端 `FORMAT_TONES` enum 收斂;前端 `chipToneClass` / 新增 `chipToneTextClass`(僅文字色場合);Glide 因需 JS 物件另有 `grid-tone` 查表 —— 使用者輸入永不成為色值本身。測:非白名單 tone 於求值即被略過 | P0 | ✅ |
| G2 | 使用者以為「條件式隱藏」可保護敏感欄 | ✅ 本模組**不提供**條件式隱藏(OQ-CF-8=A);doc §1.2 與 UI mockup 邊界區明載欄位級保護走權限設定 | P0 | ✅ |
| G3 | 上色運算子語意與篩選不一致 → 使用者困惑 | ✅ 後端 schema 直接複用 `FILTER_OPERATORS`(非另立一組);前端求值器逐運算子單元測(含空值不參與有序比較、數值 vs 字典序) | P1 | ✅ |
| G4 | 規則引用已刪除/改名的欄位 → 靜默失效或報錯 | ✅ 條件引用已刪欄 → 略過**該規則**(不誤判為命中);目標欄已刪 → 略過**該欄**,同規則其他目標照套。2 單元測 | P1 | ✅ |
| G5 | 覆蓋序與使用者直覺相反(以為上面優先) | ✅ 規則清單下方**常駐提示**「排越後面越優先」(≥2 條規則時顯示)+ 即時預覽隨排序變動。e2e 斷言提示可見 | P1 | ✅ |
| G6 | 大量記錄 × 多規則求值拖慢列表 | ✅ 純函式無 I/O;集合視圖**每列求值一次並快取**(非每 cell 重算)。**殘留**:未以 200 列 × 20 規則壓測 | P1 | ⚠️ 未壓測 |
| G7 | 只靠顏色傳達「逾期」→ 色盲 / 黑白列印失去資訊 | ✅ 值以帶框章呈現且**文字恆在**(承 option-colors FMEA C2);欄位標題僅換文字色,文字不變。e2e 斷言文字可見 | P1 | ✅ |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-03 | **v1.1** | 🔴 **範圍更正(僅文件,程式碼未動)** —— 承 `_audit/giants-shoulders-audit-B.md` §3.1。**§0.0 更正 v0.1 之誤述**:v0.1 把所對標的功能等同於著色,並據此在 OQ-CF-8 切出「條件式行為」;**複驗證實該切分為本模組自造,非對競品的觀察**。**§0.2 一手逐字複驗**:Ragic `doc/6` 整頁 17 個章節標題,其中**效果類 10 項**(顯示/隱藏欄位 · 欄位值 · 敘述欄位 · **設定顏色** · 分段顯示隱藏上鎖 · 顯示訊息 · 動作按鈕顯示隱藏上鎖 · 欄位唯讀 · 欄位必填 · 開始簽核按鈕),條件側 3 項,同一入口同一份清單;官方示範**第一條規則是「顯示」、第二條才是「變色」**。⚠️ **同時更正稽核**:稽核列 13 標題稱「約 12 項」,**漏列「指定使用者或群組」**。**四項 v0.1 未記錄之語意**:雙向邏輯(未命中須主動還原)· 覆蓋序仲裁單位為「欄位 × 效果」· 規則層 `註解`/`啟用開關` · 靜態欄位屬性與條件式規則之明文優先序。**§0.3 站③ 競品切線**:Airtable 為**分離**(顏色=視圖級清單 / 行為=**每欄** Rules→Visibility),Teable 條件邏輯外包 App Builder,Baserow 與 Teable 之著色**未查證**;**兩家皆明文警告「隱藏≠安全」卻皆照樣出貨** → 推翻原 OQ-CF-8 理由 (a)。**§0.4 站②**:`@gorules/zen-engine@0.54.0` 為 NAPI 原生 + `kind: string`/`config: any`,**不可作前端同步求值之規則模型**;Glide 6.0.3 cell 層已有 `readonly`;`react-hook-form` 宣告但**零引用**。**§0.5 站① 對碼**:`formatRuleSchema` `.strict()` + `tone` 必填 + 無判別欄屬實(`layout-specs.ts:116-124`);前端鏡射**未 `.strict()`** → 未知欄位靜默剝除;**無專屬 migration**(存 `form_def.layout` JSONB,`0010`);全 repo 引用僅 4 檔且**無 seed / fixture / 真實租戶資料**;**靜態 `hidden`/`readonly` 早已出貨且同為前端生效** → 推翻原理由 (b) 之一半(僅 `required` 為伺服器強制)。**§0.6 補誠實聲明**(查了什麼 / 未查證 7 項 / 逐節證據強度 / clean-room 聲明)+ **§0.7 來源**。**§10-bis OQ-CF-8 重裁**:四選項(A 第二份清單 / B 一次補齊 / **C 先改形狀效果分層** / D Airtable 每欄規則),**建議 C** —— 現在只把規則升為判別式 `effects[]` + 相容讀取器(此刻資料為零,成本只會單調上升),純呈現效果先出、`required`/動作按鈕/簽核按鈕三項單獨排程以保留原理由 (c)。**§1.2 與 OQ-CF-8 原文以刪節線保留,未無痕改動** | Claude Code |
| 2026-07-28 | **v1.0** | **SHIPPED** — M1 後端 `layout.conditionalFormats`(複用 FILTER_OPERATORS + tone enum 收斂,零 migration)+ 前端純函式求值器(16 單元測)· M2 設計器面板(兩面獨立 / 覆蓋序常駐提示 / 12 色盤 / 即時預覽 / 複製到另一面)· M3 記錄頁欄位標題與值著色 + 集合視圖 Glide `themeOverride`(每列求值快取)· M4 `conditional-format.spec` 4 測 + FMEA。api 321 + web 61 + e2e 38 全綠(連兩輪)。commit `20aa281`(後端)+ `daa0c63`(前端)。**UI 稿**:`docs/mockups/conditional-format-flow.html`。**殘留**:G6 未壓測 / 條件式行為(OQ-CF-8,另立)/ 整列著色(OQ-CF-3)/ 欄位間比較(以公式欄替代)| Claude Code |
| 2026-07-28 | v0.1 | 初版 DRAFT — form-designer-2d P1 殘留之收斂。**§0 競品證據**:Ragic 為表單級 + 欄位級著色 + 後者覆蓋 + 自由選色、表單頁與列表頁分開;Airtable 為視圖級 + 整列著色 + 前者優先 —— **兩者模型相反,不可各取一半**。P0 = 規則模型(複用既有 filter)+ 純前端求值 + 設計器面板 + 兩面呈現;**條件式行為(顯示/隱藏/唯讀/必填)明確排除**(非格式而是邏輯,且條件式隱藏不是安全邊界)。零 migration、零新端點。OQ-CF-1..8 待裁定 | Claude Code |
