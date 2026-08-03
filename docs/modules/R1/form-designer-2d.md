# form-designer-2d.md — [R1·UP-3] 2D 表單設計器（form-designer-ui uplift）設計文件

> ✅ **狀態：SHIPPED v1.0（2026-07-25;M1–M5 全綠;api 226 + web 15 e2e 過）**
> **裁定摘要**｜1=A 單一 form_def.layout JSONB · 2=A layout 草稿+Ctrl+Z / 結構性即時 DDL 不入 undo · 3=A 靜態=layout 元素 · 4=A 分段=列範圍 · 5=A CSS grid + dnd-kit · 6=A 採 §1 P0/P1 分界 · 7=A 2D 畫布取代線性。
> **落地**｜M0 `1b329bd` · M1 後端 `e073659`(form_def.layout 0010 + layout API + create-time 預設值)· M2 `cd7dc3a`(2D 畫布 + dnd-kit)· M3 `4a2ee56`(靜態元素 + 分段 + 欄位設定面板)· M4 `2445a5f`(設計草稿 + Ctrl+Z undo)· M5 `a473a6a`(designer.spec)。
>
> docs/27 §6 順序 3（承 views-list SHIPPED）。落地 D1 裁定「2D 格線畫布 = 填單畫面本身」：把既有 builder 的**線性欄位清單**設計模式 uplift 成 **Excel 式 2D 格線畫布**（欄位以 row/col/span 擺位、跨欄合併、拖曳）+ **靜態敘述/圖片元素** + **表單分段** + **欄位設定核心**（預設值 17 變數 / 唯讀 / 隱藏 / placeholder / 說明）+ **設計草稿模型**（批次 apply + Ctrl+Z）。
>
> **核心架構洞見（docs/27 §1）**：**版面能力皆 layout metadata（座標/樣式/分段/設定），與資料層正交** —— form-engine-core 的 DDL/DML 鏈**不需動**；主戰場 = `form_def` 增 `layout` JSONB + 設計器前端改畫布。這使本模組雖大但風險可控（純 metadata，零 schema 遷移風險）。
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-25）
> 證據：docs/27 §0 D1 + §1（P0/P1/P2）、本地競品參照庫（Ragic doc/21·37·38·35·123·121·50·53·143、Baserow undo-redo-guide、Airtable forms）、現有 builder 盤點（edit-form-panel 線性清單 / ddl.service 即時 per-field DDL / field_def 僅 position / 19 型別 3 stub）

---

## 0. 站在巨人的肩膀(2026-08-03 retrospective 補)

> 🔴 **本檔 v0.1–v1.0 全程沒有這一節。** 檔頭「證據」列只有 doc 編號與套件名,
> 無逐字、無 URL、無查證日期。`_audit/giants-shoulders-audit-A.md` §4.1 判定本模組為該批
> **唯一三站皆未做、且事後也未補**者,並已證實兩處**已出貨的錯形狀**
> (§3.3 欄寬列高零 reader · §3.4 分段語意錯置),兩處皆由**別的模組**重新發現。
>
> 本節為事後補研究。判準見 `AGENTS.md`〈向上設計三條〉,格式見 `_template.md` §0。
> **§1–§12 之既有裁定與內容一律不動**;需要改的整理於 §0.5 交決策方。

### 0.1 巨人一:自家 repo

| 查了什麼 | 結果 |
|---|---|
| `docs/27` §0 D1 + §1 P0 逐字 | 🔴 **三處與本模組落地不符**(見 0.1.1)。其中「分段」一條,正確答案逐字寫在上游 |
| `docs/15` §資料模型表 | `view_def` 一列逐字含「**欄寬**」→ 上游把**列表頁**欄寬歸 view_def。本模組把 `colWidths` 放 `form_def.layout.grid`(表單頁語意)。Ragic doc/21 確實分「調整表單頁 / 調整列表頁」兩節,故非矛盾;但複查 `apps/api/src/views/view-specs.ts` **無任何 width 欄** → **列表頁欄寬目前無歸屬**,兩邊都可能去搶 `layout.grid.colWidths`(§0.5 R3) |
| 既有 migration | `0010_form_layout.sql` 為純加法 JSONB;其後 `print`(print-merge)與 `conditionalFormats`(UP-3b)皆疊在同一 JSONB → 承載模式成立,無需重估 |
| `apps/web/src/lib/engine/form-geometry.ts`(UP-3c M1 後補的**唯一幾何來源**) | `FORM_COL_W = 60` / `FORM_ROW_H = 32` 為模組常數 —— **這正是 `colWidths` / `rowHeights` 的接點**;`canvas.tsx:432-433` 與 `header-fields.tsx:44-47` 兩處各自寫死 `repeat(cols, 60px)` 與 `minmax(32px, auto)` |

#### 0.1.1 與 `docs/27` D1 的逐字對照

| `docs/27` §1 逐字 | 本模組落地 | 差異 |
|---|---|---|
| 「**表單分段(section tabs)**｜右鍵指定列成段、可命名/樣式;子表格可入段(**lazy load 加速**)」 | OQ-FD2-4 只取「列範圍註記」;實作為畫布上方一排 chip | 🔴 **「section tabs」與「lazy load 加速」兩個關鍵字就寫在上游那一列**。裁定只承接了限制,沒承接互動模型與存在理由 |
| 「2D 格線畫布｜欄位 row/col/span 擺位、拖曳移動、跨欄合併;**列高/欄寬可調**」 | §3 M2 與 §4.4 皆逐字複述「列高/欄寬」;M1 建了 schema;UI 與渲染端從未接 | 🔴 已證實(稽核 §3.3) |
| 「Excel 式 2D 格線(**新表 105×21**,自動擴充 doc-kb/306)」 | `FORM_COLS = 12`,且**無任何 UI 可寫入 `grid.cols`** | 欄數為 Ragic 預設的 ~57%;超過 12 欄的遷移表單無法表示(§0.5 R4) |

**推論**:第一條**不需要打開任何競品文件就能攔下** —— 一手依據在自家上游 design doc。

#### 0.1.2 「schema 寫了但零 reader」全掃(本模組的已知失敗模式)

驗證方式:對 `layout` schema 每個 leaf key 於 `apps/web/src` + `apps/api/src` 執行 `grep -rn` 並計命中,
扣除 schema 定義檔(`apps/web/src/lib/engine/schemas.ts` · `apps/api/src/form-engine/layout/layout-specs.ts`)。

| key | 設計器可寫 | 填單 / 記錄頁採用 | 證據 |
|---|---|---|---|
| `grid.colWidths` / `grid.rowHeights` | ❌ 無 UI | ❌ **0** | 僅 `schemas.ts:313-314` + `layout-specs.ts:144-145`(含 min/max) |
| `grid.cols` | ❌ **無 writer**(恆 12) | ✅ `canvas.tsx:177` | 反向同型:有 reader 無 writer,schema 的 `min(1).max(50)` 不可達 |
| `fields.sectionId` | ❌ | ❌ **0** | 兩側 schema 各一行,其餘 0 |
| `fields.readonly` | ✅ `field-settings.tsx:167` | ❌ **0** | `header-fields.tsx:52` 只檢查 `hidden` → ⚠️ **唯讀設了不生效**,非純顯示問題 |
| `fields.placeholder` | ✅ | ⚠️ 僅設計畫布顯示(`canvas.tsx:611`) | 真正的輸入元件用寫死值(`field-input.tsx:102` / `:131`) |
| `fields.help` | ✅ 存文字 | ⚠️ 只取布林 | `header-fields.tsx:66` 逐字 `help: fl.help !== undefined && fl.help !== ""` → **說明文字本身零 reader** |
| `statics[]` 全部(`text` / `markdown` / `href` / `imageUrl` / `designOnly` / `style`) | ✅ 設計器完整 | ❌ **0**(僅 `canvas.tsx` 讀) | 🔴 §1.1 目標 2「靜態敘述 / 圖片元素」**只在設計模式成立** |
| `sections[]` | ⚠️ 建立時固定 `fromRow: 0, toRow: maxRow`(`canvas.tsx:276`) | ❌ **0** | 「列範圍」語意從未真正被使用;`object-page.tsx` 的 `sections` 是另一組寫死字串(摘要/動作/基本資料/明細/稽核),與 layout 無關 |
| `statics.style` / `sections.style`(font/size/color/align/bg) | ❌ 無 UI | ❌ **0** | `layout-specs.ts:28` 定義,兩端皆無使用 |

⚠️ **對照組**:同一個 JSONB 裡後補的 `print`(`print-settings.tsx` ↔ `object-page.tsx:114-118`)與
`conditionalFormats`(`evaluateFormats`)**兩組都有完整 reader**。
差別在那兩組是「先有畫面需求、才加欄位」,本模組是「先照規格把 schema 建齊」。

### 0.2 巨人二:自己的相依套件

**已安裝**:`@dnd-kit/core@6.3.1` · `@dnd-kit/utilities@3.2.2`
(`@dnd-kit/sortable@10.0.0` / `@dnd-kit/accessibility@3.1.1` 為他處使用與傳遞相依)。
**無任何 resize 套件**(`re-resizable` / `react-resizable` 皆未安裝)。
以下逐字取自**已安裝版本**之 `dist`。

**(a) `@dnd-kit/core@6.3.1` —— 已接與未接**

已接(`canvas.tsx:178-184`,其中 KeyboardSensor 為 #109 後補):
`PointerSensor` + `activationConstraint: { distance: 4 }` · `KeyboardSensor` + 自訂 `gridCoordinateGetter`。

| 未接的 API | 逐字 / 實據 | 對本模組的意義 |
|---|---|---|
| `modifiers?: Modifiers` | `dist/components/DndContext/DndContext.d.ts` prop 清單;`dist/index.d.ts:5` 逐字 `export { applyModifiers } from './modifiers';` | 拖曳**過程中**的位移不吸附格線,只在 `onDragEnd` 換算成格 → 「看到的」與「落到的」不是同一件事。`Modifier` 與 `applyModifiers` 皆由 core 匯出,**不需新增相依** |
| `accessibility.announcements` / `screenReaderInstructions` | 預設值逐字(`dist/core.esm.js:43-75`):`"Picked up draggable item " + active.id + "."` · `"Draggable item " + active.id + " was dropped."` | 本畫布 draggable id 為 `f:123` / `s:sec1`,且未使用 droppable 故 `over` 恆 `null` → 螢幕閱讀器讀到的是**英文 + 內部識別字 + 沒有座標**。繁中產品且已為此軸修過一次(#109) |
| `useDroppable` / `collisionDetection` | `dist/index.d.ts:3`、`:11`(`closestCenter` / `closestCorners` / `rectIntersection` / `pointerWithin`) | 現行以 transform delta 自行換算格座標、重疊自寫 `patchField` 擋(#109)。可行,但也是上一列 `over` 恆 null 的成因 |
| `DragOverlay` / `onDragMove` | `dist/index.d.ts:1`、DndContext prop | 無拖曳中預覽與對位輔助 |

⚠️ 附記一個決定性預設值:`defaultKeyboardCoordinateGetter` 逐字為
`x: currentCoordinates.x + 25` / `y: currentCoordinates.y + 25`(`dist/core.esm.js:1103-1131`),
而本畫布格為 **60 × 32** —— 未自訂 `coordinateGetter` 時鍵盤永遠對不到格。
#109 已自訂,此處記錄該常數供後續核對。

**(b) 🔴 `@glideapps/glide-data-grid@6.0.3`(已安裝,列表頁在用)已內建欄寬拖曳**

逐字(`dist/dts/internal/data-grid-dnd/data-grid-dnd.d.ts:26-35`,原文含 `you have change` 之筆誤,照錄):

> 「Called when the user is resizing a column. `newSize` is the new size of the column.
> Note that you have change the size of the column in the `GridColumn` and pass it back
> to the grid in the `columns` property.」

另有 `onColumnResizeStart` / `onColumnResizeEnd`(同檔 `:44` / `:53`),
以及 `minColumnWidth`(`@defaultValue 50`)· `maxColumnWidth`(`@defaultValue 500`)·
`rowHeight`(`@defaultValue 34`)(`dist/dts/data-editor/data-editor.d.ts:216` / `:226` / `:232`)。

**`onColumnResize` 於 `apps/web/src` 命中 0** —— `collection-view.tsx` 與 `grid-panel.tsx` 皆使用
`DataEditor` 但未接。意義有二:

1. **列表頁欄寬(Ragic doc/21 的另一半)幾乎是免費的**,只差持久化位置(§0.5 R3)。
2. `layout-specs.ts` 的 `colWidths` 為 min 40 / max 800,與 Glide 預設 50 / 500 **不同** ——
   若兩處共用同一份資料會互相截斷。這是「列表頁欄寬無歸屬」的具體風險,不是理論疑慮。

**(c) 表單頁欄寬列高:確認無套件可借 —— 但也不是新元件**
表單頁為自建 CSS Grid(OQ-FD2-5=A),無現成套件。接點是
`form-geometry.ts:19-20` 兩個常數,以及 `canvas.tsx:432-433` 與 `header-fields.tsx:44-47`
的 `gridTemplateColumns` / `gridAutoRows` **兩個字串**,非新元件。

### 0.3 巨人三:競品(全部取自本機一手鏡像;查證日 **2026-08-03**)

**(a) Ragic 表單分段** — `reference-materials/ragic-doc-zh-TW/www.ragic.com/intl/zh-TW/doc/121/sheet-sections.html`

> 「而 表單分段 功能讓你設計表單時可以指定某幾列為一個「分段」，就能夠在同一列上，放多組不同的分段，**查看時可以點擊頁籤來切換分段**。」
> 「3. 提升速度：單一子表格中超過 100 筆資料，可能會讓資料載入速度變慢…就可以利用分段功能，把某些子表格先「**收**」起來，這樣進入表單時便不會需要一次載入所有子表格的資料，就可以加快表單載入速度。」
> 「1. 每張表單只能夠設置 一組分段群 ，一組分段群中可以設置多個分段。」
> 「2. 單一子表格只能加入一個分段， **不能拆成多個分段** 。但可以把不同子表格放入同一個分段中。」
> 「3. 分段功能是按照表單中的欄位順序， 由上往下依序分段 …因此不能調整各分段順序」
> 設計步驟:「接著在列上點擊右鍵選擇 **新增分段** 。」「要增加分段可以點**頁籤旁的 +** 。」「點擊分段頁籤名稱可以自行命名。」「要取消該分段可以點**名稱旁的 x** 。」

**對照**:限制第 1、3 條本模組取到了;**限制第 2 條(子表不可拆段)未表達於 schema**;
**互動模型(頁籤 / + / x / 右鍵新增)與存在理由(子表 lazy load)完全未取**。

**(b) Ragic 版面調整** — `…/doc/21/tuning-the-layout-of-your-forms-and-tabs.html`

> 表單頁:「調整列高與欄寬的方式**和 Excel 相同**，拖曳欄位右邊的邊線即可調整整欄寬度。」「拖曳欄位底邊的邊線即可調整整列高度。」
> 列表頁:「同樣是拖曳欄位右邊的邊線即可調整整欄寬度。拖曳欄位底邊的邊線即可調整整列高度，**調整一列就會 反應到所有的列高** 。」
> 「對想調整的欄寬或列高**點右鍵**後，選擇 欄寬或列高 就可以直接在跳出的視窗中**以 px 為單位輸入數值**。也能以拖曳的方式**選取多欄或多列一次設定**。」
> 移動:「在 設計模式 可以直接**按住欄位標題並拖曳**來移動欄位。」
> 跨欄:「而敘述欄位的跨欄，只要**拖曳欄位的右下角**即可。」
> 樣式:「從左邊設計面板的 樣式 頁籤，可以改變欄位標頭及欄位值的顏色、字型及大小等。」「另外，也可以 設計欄位框線 。」+ 「複製欄位樣式」/「清除全部欄位的樣式」/「選擇主題」+ 自訂主題(可設區塊逐字含「**表單分段**」)

**對照**:
- **列高語意兩頁不同** —— 表單頁 per-row、列表頁**全域單一值**。本模組 `rowHeights` 為 `{row: px}` map,只對得上表單頁(再次指向 §0.5 R3)。
- **px 數值輸入 + 多欄多列批次設定**支持 `{col: px}` map 形狀,本模組 schema 形狀選對了,只是沒接。
- **拖曳把手位置不同**:Ragic 拖的是**欄位標題本身**;本模組另設一顆 grip 按鈕(`canvas.tsx` StaticCell / FieldCell)。
- **靜態元素跨欄是右下角把手**;本模組用設定面板數字輸入(`field-settings.tsx:331`)。
- **樣式軸遠大於本模組 schema 的 5 個屬性**,且有「主題」與「複製樣式」兩個放大器 —— 與 §0.1.2 之 `style` 零 reader 併看(§0.5 R7)。

**(c) Ragic 畫布尺寸** — `…/doc-kb/306/how-to-increase-rows-and-columns-in-design-mode.html`

> 「目前新建立一張表單時，系統預設提供 **105 列與 21 欄**給使用者使用。不過，實際可使用的列數與欄數會隨著儲存時的欄位位置自動調整：系統會在最下面欄位下方自動增加 **100 列**，在最右側欄位右方自動增加 **4 欄**。」
> 「2. 若在 T1 儲存格新增欄位（**會同時佔用 U1**），表單寬度會自動延伸至 25 欄（顯示至 Y 欄）。」

**對照**:「會同時佔用 U1」是 §4.1 註記「Ragic 雙格語意」的官方明證 ——
**但實作並非如此**:`header-fields.tsx:56` 為單一 grid area 內再切 `112px 1fr` 子格線,
一個欄位只佔 `colSpan` 個畫布欄而非「header 於 col、value 於 col+1」。
兩種座標系在遷移 Ragic 版面時換算基準不同,目前**未定義**(§0.5 R5)。

**(d) Airtable** — `airtable-support/airtable-interface-layout-record-detail.html` · `airtable-grid-view.html`

> 「**Tab navigation** - Enabling tab navigation allows end users to **click tabs to navigate through grouped sections** of details on the record detail page. This is particularly useful in **detail-rich pages containing many fields of data**.」
> 「**Add group** - Hovering over a line break on the canvas will reveal the option to + Add group. Groups allow you to **section out** the various fields that make up the record detail page.」
> 「Click, hold, and **drag the group to another location** on the canvas.」
> 「You can drag and drop fields above or below other fields, into other groups, or **next to other fields (4 maximum**, but can vary depending on field type and space constraints).」
> grid view 列高:「Select the desired row height. There are **four different row height options**」/「Changing the row height **does not affect the height of field headers**, which are not height-adjustable.」/ 表頭:「Click and **drag the header height** to your desired preference.」

**對照**:
- 🔴 **「分組的呈現是頁籤」有了獨立於 Ragic 的第二個一手證據**,且理由同為「欄位很多的頁面」。兩家收斂,本模組的標題列做法是兩家都沒有的第三種。
- **但 Airtable 允許拖曳重排 group**,與 Ragic「不能調整各分段順序」相反 → 本模組承接 Ragic 限制是**一項選擇**,不是唯一解;Ragic-parity-first 下維持 Ragic 側可辯護,惟應標明其為選擇。
- **並排上限 4**,非自由 12 欄 —— 與本模組(與 Ragic)的自由格線是不同路線。
- **列高為四段預設值而非 px**,且**表頭高度不可調** —— 與 Ragic 的 px 輸入相反。兩種都可辯護,本模組 schema 已選 px。

**(e) Teable** — `teable-docs/help.teable.ai/en/basic/view/form.md`(公開說明文件;
`apps/` 為 AGPL,依 `AGENTS.md` 鐵則 5 **未讀實作**)

> 「Reorder fields｜**Drag fields to change their order** on the form」
> 「Form appearance supports a **cover image, logo, and submit button text**.」

**對照**:Teable 的 form view 是**一維順序**,無 2D 座標、無分段、無欄寬。
D1「2D 畫布派」相對於 Teable 的差異仍成立 —— 惟此為 **Ragic-parity**,不是向上設計。

**(f) Baserow** — **未查證**。本機鏡像 `baserow-docs/baserow.io/docs/` 僅含開發者文件
(API / development / installation),無使用者端版面說明。未取得一手依據前,
不對 Baserow 的表單版面能力作任何斷言。

**(g) NocoDB / Directus** — 本次**未查**。依 `AGENTS.md` 鐵則 5,兩者已非 OSS,
僅得讀公開文件、不看實作;本次未取得。

### 0.4 🔴 本應在 M0 就攔截到的東西(本次補寫的重點)

| 已出貨的錯形狀 | 哪一站會攔下 | 具體怎麼攔 |
|---|---|---|
| ① **分段做成標題列**(OQ-FD2-4) | **站①,不必碰競品** | `docs/27` §1 P0 那一列逐字寫著「表單分段(**section tabs**)…子表格可入段(**lazy load 加速**)」。§0 若要求「把上游規格該列**整句抄進 §0.1 再逐詞對**」,`tabs` 與 `lazy load` 兩個詞會直接落在裁定桌上。站③(讀 doc/121 **全文**而非只記編號)為第二道防線 |
| ② **`colWidths` / `rowHeights` 零 reader** | **站①的零 reader 掃描** | 這兩個 key 是本模組自己於 M1 建的。M5 收尾時對 layout schema **每個 leaf key** 跑一次 `grep -rn` 命中計數,「命中僅出現在 schema 定義檔」即判未接。耗時分鐘級,可自動化為 CI 檢查 |
| ③ **(本次新查出)`statics` / `sections` / `readonly` / `placeholder` / `help` 文字 於填單端零 reader** | 同上 —— **同一次掃描全撈** | 同上。另補一條驗收原則:**§1.1 每一條目標都要有一個「非設計模式」的斷言**。`designer.spec` 全程在設計模式內,於是 §1.1 目標 2/3 測試通過、卻沒有出現在使用者的表單上 |
| ④ **dnd-kit `KeyboardSensor` 未接**(#109 才修) | **站②** | `dist/index.d.ts:7` 逐字就與 `PointerSensor` **並列匯出**。範本 §0.2 的查法(讀已安裝版本的 `.d.ts`)命中成本近乎零 |
| ⑤ **Glide `onColumnResize` 未接** | **站②** | 逐字在已安裝套件的 `.d.ts` 裡,且該套件**已經在用**。欄寬這件事有一半是現成的 |

**共同型態**:①③是「上游規格的字沒逐句對」· ②③是「schema 建了沒有驗收」· ④⑤是「套件沒讀」。
三者都不需要新知識,只需要三個固定動作:**逐句對上游 / leaf key 命中掃描 / 讀 `.d.ts`**。

⚠️ **一條反向教訓(本次才看出來)**:§12 FMEA **F2 殘留欄逐字**寫著
「填單頁 Markdown sanitize 待後續(設計器只存不渲染 raw HTML)」——
**該句其實已經記載了「靜態元素在填單頁沒有被渲染」這個事實**,
但它被歸類成安全殘留,沒有人把它讀成 §1.1 目標 2 的功能缺口。
→ 建議入通則:**FMEA 殘留欄若描述的是「某條路徑不存在」,必須回頭對 §1.1 目標核對一次**。

### 0.5 建議重裁 / 新增(交決策方;本次不動既有裁定)

| # | 對象 | 現況 | 建議 |
|---|---|---|---|
| **R1** | **重裁 OQ-FD2-4 分段模型** | 已由 `form-designer-wysiwyg` OQ-FDW-8=A 裁定改頁籤 | 本模組 §4.1 / §4.5 之 `sections` 語意應標 SUPERSEDED,並補兩件該裁定仍未涵蓋者:**(a) 分段收合 → 子表 lazy load**(doc/121 三大優點之一,目前無任何對應,且它是**載入效能**不是視覺偏好)**(b) schema 缺「單一子表格不可拆段」約束** |
| **R2** | **欄寬 / 列高** | schema 兩端俱全(含 min/max),reader 0,writer 0 | 二選一:**(a)** 補實作 —— 接點是 `form-geometry.ts` 兩個常數 + 兩處 template 字串,非新元件;**(b)** 移除 schema 兩個 key,誠實記為不做。**維持現狀是最差選項** —— 它會讓下一個人以為做過了(已發生一次) |
| **R3** | **列表頁欄寬歸屬** | `docs/15` 列於 `view_def`;`view-specs.ts` 實無此欄;`layout.grid.colWidths` 為表單頁語意;Ragic 兩頁列高語意還不同(per-row vs 全域) | 明確歸 `view_def`,沿用 Glide `onColumnResize`(§0.2b),**不與 `layout.grid.colWidths` 共用**;並對齊 min/max 與 Glide 預設值差異 |
| **R4** | **`grid.cols` 恆為 12** | 無 writer;Ragic 預設 21 欄且自動擴充 | 裁定 12 欄是否足以承接遷移表單;若否,補 cols 設定或自動擴充規則 |
| **R5** | **座標語意未定義** | §4.1 註「header 於 col、value 於 col+1」;實作為單格內 `112px 1fr` 子格線 | 裁定遷移 Ragic 座標時的換算基準(1 欄位 = 1 格 或 2 格)。目前兩份文件與實作三方不一致 |
| **R6** | **`statics` / `sections` / `readonly` / `placeholder` / `help` 文字 於填單端** | 零 reader | 同 R2 之二選一。⚠️ **`readonly` 另有正確性意涵** —— 設計者設了唯讀但填單端不生效,使用者會以為欄位已鎖 |
| **R7** | **樣式軸** | `styleSchema` 5 屬性、零 reader、無 UI;Ragic 有框線 / 複製樣式 / 主題三層 | 建議獨立模組評估,不在本模組續攤 |

> ⚠️ 本節不宣稱本模組已無向上缺口 —— 以上僅為 2026-08-03 一次掃描之結果,
> 且第 ③ 類發現正是在「稽核已經看過一輪之後」才出現的。

---

## 1. 目標與範圍

### 1.1 目標

1. **2D 格線畫布**｜設計模式由線性清單改 Excel 式 2D 格線：欄位以 `row/col/colSpan` 擺位、拖曳移動、跨欄合併；存 `form_def.layout` metadata，**不動 PG schema**。既有表無 layout → 計算預設投影（每欄一列，header+value 兩格；lazy default）。
2. **靜態敘述 / 圖片元素**｜無資料欄之顯示元素（字型/顏色/Markdown/超連結/「僅設計模式可見」）+ 插入圖片（logo）；存 layout，非 field_def（Ragic 敘述欄位=獨立元素）。
3. **表單分段**｜連續列範圍 → 命名分段（Ragic 語意：由上而下、每表一分段群、不可獨立重排）；子表可入段。
4. **欄位設定核心**｜預設值（Ragic 17 變數 `$DATE/$USERNAME/$SEQ…` + 公式 default）、唯讀、隱藏（排版層隱藏≠權限 D4）、placeholder、欄位使用說明（? 圖示）。
5. **設計草稿模型**｜layout/設定變更累積為 session 變更集、批次 Save 生效 + **Ctrl+Z 復原**；資料異動操作（欄位增刪/型別轉換觸 DDL）依 Ragic 排除清單不入 undo（OQ-FD2-2）。

### 1.2 對應訴求

| 子題 | 訴求 | 對應 |
|---|---|---|
| 2D 設計器 | Ragic 客戶生產表單就是 2D 格線+多色敘述+分段（design_chang.png）；線性清單=遷移時版面資訊丟失、感知降級 | docs/27 D1 + §1 P0；docs/25 B「表單設計器」6 人月 |

### 1.3 不做的事

- ❌ **改 DDL/DML 鏈**｜版面與資料正交；本模組僅加 `form_def.layout` + 前端畫布，form-engine-core 的建表/建欄/記錄鏈不動。
- ✅ **【2026-07-28】條件式格式之「變色」已由 [R1·UP-3b conditional-format](conditional-format.md) v1.0 交付**;**條件式行為(顯示/隱藏/唯讀/必填)刻意不納入**(條件式隱藏不是安全邊界、條件式必填只在前端即為裝飾)→ 另立模組。
- ❌ **格式 mask + 民國年 + regex 驗證**｜§1 P1（欄位格式，隨 field-types-parity）。
- ❌ **Ctrl+K 欄位搜尋、設計版本紀錄+還原、欄位樣式/框線細調**｜§1 P1。
- ❌ **多版本表單**（→ R1 以「檢視+欄位權限」對映，views-list 已落）、列印頁首頁尾/換頁、凍結、複製表單架構｜§1 P2。
- ❌ **持久化 / 跨分頁 undo**（Baserow Action-table 式）｜P0 只做 in-session Ctrl+Z；持久 undo 為 P1（若需要）。
- ❌ **小圖表 widget**（Ragic 122）｜靜態元素只做文字+圖片，圖表 P2。

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| 設計模式 UI | 線性欄位清單（`edit-form-panel.tsx`：palette + 欄位列 + 上下移/刪/改型別）| 全新 2D 畫布渲染 + 拖曳定位 |
| 版面 metadata | ❌ 無（`form_def` 無 layout；`field_def` 僅 `position` int 排序）| 新 `form_def.layout` JSONB（migration） |
| 加欄 → DDL | `useAddField` → `ddl.service.addField` **即時 per-field ALTER**（advisory lock + audit）| 結構性操作維持即時（OQ-FD2-2 A）；layout 變更走草稿 |
| 建表流程 | ✅ 已批次（`createFormDraft` 單 tx 建 form+全欄 → 單次 provision）| 草稿模型可借鏡此批次 pattern（P1 全延遲結構性時） |
| 欄位設定 | required / unique(spec 未上 UI) / 型別 options（choices/prefix…）| **缺** default value / readonly / hidden / placeholder / help |
| 靜態元素 | ❌ 無 | 全新 layout 元素（非 field_def） |
| 分段 | ❌ 無 | 全新 layout.sections（列範圍） |
| 預設值解析 | ❌ 無（createRecord 不套預設）| createRecord 讀 layout 套 create-time 變數（後端小增量） |
| 欄位型別 | 19 型 3 stub；`field-input.tsx` 依型別渲染 | 靜態元素不入 field-type registry（layout 層渲染） |
| 測試 | `builder.spec`（建表→加欄→填單→子表 golden path）；ddl/metadata integration | uplift 不得破既有；新增 2D 定位/草稿/undo 測 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端** | `form_def.layout` JSONB（migration）+ layout GET/PUT API（TenantGuard，Zod 驗證）+ createRecord 套 create-time 預設值變數（$DATE/$USERNAME…）+ integration 測 | 0.10 mo |
| **M2 前端（畫布）** | 設計模式改 2D CSS 格線畫布（layout metadata 渲染 + 既有表預設投影）+ 欄位拖曳定位（dnd-kit）+ colSpan/合併 + 列高/欄寬 | 0.14 mo |
| **M3 前端（元素 + 分段 + 設定）** | 靜態文字/圖片元素（layout.statics）+ 分段（列範圍）+ 欄位設定面板（預設值/唯讀/隱藏/placeholder/help） | 0.12 mo |
| **M4 前端（草稿 + undo）** | 設計草稿模型（layout 變更集暫存 + 批次 Save）+ in-session Ctrl+Z/Ctrl+Shift+Z（結構性 DDL 操作依排除清單不入 stack）+ 未存離開警示 | 0.08 mo |
| **M5 固化 + FMEA** | Playwright spec（畫布定位→分段→靜態→設定→草稿存→undo）+ §12；doc v1.0 + MODULES ✅ | 0.03 mo |

**合計 ≈ 0.47 mo**（對應 docs/25 B「表單設計器」6 人月之 P0 首期落地；四模組中最大）。M1 後端 / M2–M5 前端**分開 commit**。

---

## 4. 設計要點

### 4.1 `form_def.layout` 資料模型（M1；OQ-FD2-1=A）

單一 `form_def.layout` JSONB 承載整表版面（whole-form；layout 與資料正交）：

```
layout = {
  grid: { cols: number, rowHeights?: {row: px}, colWidths?: {col: px} },
  fields: { [fieldId]: {
    row, col, colSpan,                 // 2D 座標（header 於 col、value 於 col+1..，Ragic 雙格語意）
    sectionId?: string,
    placeholder?, help?, readonly?, hidden?,   // 欄位設定（顯示層；hidden≠權限 D4）
    defaultValue?: { kind: 'literal'|'variable'|'formula', value: string }
  }},
  statics: [ { id, kind: 'text'|'image', row, col, colSpan,
               text?, style?: {font,size,color,align,bg}, markdown?, href?,
               designOnly?: boolean, imageUrl? } ],
  sections: [ { id, name, fromRow, toRow, style? } ]   // 列範圍註記（連續、不重疊、一群/表）
}
```

- **零 DDL**；layout 變更 = `form_def` 一列 UPDATE（+ bumpVersion）。既有表 `layout=null` → 前端計算預設投影（field.position 序 → 每欄一列）。
- 靜態元素、分段皆在此（非 field_def）→ field_def / DDL 鏈完全不動。

### 4.2 layout API（M1）
- `GET /forms/:id/layout`（回 layout 或 null）、`PUT /forms/:id/layout`（整表 layout 覆寫，Zod 驗證 + tenant scope + bumpVersion）。草稿的「批次 Save」= 一次 PUT。

### 4.3 預設值變數（M1；OQ-FD2-6 範圍）
- createRecord 於欄位未給值時，依 layout 之 `defaultValue` 套用。**P0 = create-time 集**：`$DATE/$TIME/$DATETIME/$YEAR/$MONTH/$WEEKDAY/$USERNAME/$USERID` + literal + formula-default（複用 formula 引擎）。`#`修改時集 + `$SEQ`（與 autoNumber 重疊）→ P1。

### 4.4 2D 畫布（M2；OQ-FD2-5=A 自建 CSS grid + dnd-kit）
- CSS Grid 渲染 layout.fields（每欄 = header 格 + value 格，colSpan 合併）；拖曳用 **dnd-kit**（OSS MIT、a11y）移動欄位座標；欄寬/列高 px 可調。既有表無 layout → 預設投影。palette 保留（新增欄位 → 落畫布預設位）。

### 4.5 靜態 + 分段 + 設定（M3）
- 靜態文字/圖片：右鍵空格 → 插入；style/Markdown/超連結/designOnly；存 layout.statics。
- 分段：選連續列 → 新增分段（命名/樣式）；Ragic 語意（由上而下、一群/表、不可獨立重排、子表可入段）。
- 欄位設定面板：placeholder / help(?) / readonly / hidden / defaultValue（變數選單 + literal + 公式）。

### 4.6 草稿 + undo（M4；OQ-FD2-2=A）
- **layout 變更集**：設計 session 內 layout 編輯累積於前端 state（未存）；「儲存設計」= 一次 PUT layout。未存離開 → 警示。
- **Ctrl+Z / Ctrl+Shift+Z**：對 layout 變更集做 in-session undo/redo（前端 history stack）。**結構性欄位操作（加欄/刪欄/改型別=即時 DDL）不入 undo stack**（對齊 Ragic「資料異動操作不可復原」排除清單：公式重算/序號自動填入等）—— 加的欄位即時出現於畫布，撤銷需明確刪欄。

---

## 7. 資料模型變動

### 7.2 SQL Migration
- **`0010_form_layout.sql`**：`form_def` ADD COLUMN `layout jsonb`（nullable，純加法；null=預設投影）。無 field_def / 動態表變更。down = DROP COLUMN。

### 7.3 RLS / Permission
- `form_def` 已有 RLS（0001）；layout 隨 form_def 同租戶隔離。layout PUT 走 form 級授權（`@RequiresFormAction("design")`，承 P0-4a）。
- **hidden（排版層）≠ 欄位權限**（D4）：layout.fields.hidden 只是顯示層,`maskRead` 欄位級權限仍為後端硬底,不得以 layout hidden 替代權限。

---

## 7-bis. 安全（擇要；完整見 [[rule_security_standards]] + docs/22）

| 面 | 緩解 |
|---|---|
| layout 引用不存在/他表 fieldId | PUT 時驗 layout.fields 之 key ⊆ 該 form 現存 field_def id；statics/sections id 格式驗證 |
| 靜態元素 XSS（Markdown/超連結/imageUrl）| Markdown sanitized 渲染（禁 raw HTML script）；href/imageUrl 白名單 scheme（https）+ 擋私網段（SSRF，承 docs/22）；設計者輸入仍不可信 |
| hidden 誤當權限 → 洩漏 | D4：layout hidden 純顯示；欄位級 maskRead 後端強制不變；文件明標 |
| 預設值變數注入（$USERNAME 等）| 變數為封閉列舉（非任意字串插值）→ 後端 switch 解析；formula-default 走既有公式白名單引擎 |
| layout PUT 越權 | `@RequiresFormAction("design")`（設計權）+ tenant scope；e2e 斷言跨租戶 PUT 拒 |

Input validation：layout 整體 Zod schema（grid/fields/statics/sections 形狀、字串長度、座標 int 範圍、colSpan 上限）；`z.infer` 推型別。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Integration（api）| layout GET/PUT 跨租戶隔離 + fieldId ⊆ form 驗證 + bumpVersion；createRecord 套 create-time 預設值變數（$DATE/$USERNAME）；既有表 layout=null 不破 | `apps/api/test/*.test.ts`（Testcontainers）|
| e2e（Playwright）| 設計模式 2D 畫布渲染（既有表預設投影）→ 拖曳定位 → 加分段 → 插靜態文字 → 設欄位 placeholder/預設值 → 儲存設計(PUT) → Ctrl+Z 復原；固化進 CI | `apps/web/e2e/designer.spec.ts` |
| Unit | 預設投影計算 / 變數解析 / undo history stack / 分段列範圍驗證 | `*.test.ts` |
| 回歸 | `builder.spec` golden path 不破（加欄/填單/子表仍過）| 既有 |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** | 本檔 → APPROVED（OQ-FD2-1..7 裁定,全採建議）| ✅ |
| **M1** | 後端：form_def.layout（0010）+ layout API + createRecord 預設值（`e073659`）| ✅ |
| **M2** | 前端：2D CSS 格線畫布 + dnd-kit 拖曳定位（`cd7dc3a`）| ✅ |
| **M3** | 前端：靜態元素 + 分段 + 欄位設定面板（`4a2ee56`）| ✅ |
| **M4** | 前端：設計草稿 + Ctrl+Z undo（`2445a5f`）| ✅ |
| **M5** | designer.spec 固化 + FMEA + doc v1.0 + MODULES ✅（`a473a6a`）| ✅ |

---

## 10. 開放問題（OQ-FD2-N）— ✅ 已裁定 2026-07-25（全採建議 = 全 A）

> 全數採「建議」欄。進入 M1。

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-FD2-1** | layout metadata 儲存 | A. **單一 `form_def.layout` JSONB**（整表：fields 座標+設定 / statics / sections / grid）<br>B. field_def 加 row/col/span 欄 + 另建 static/section 表<br>C. 塞 field_def.options | **A** — 版面是 whole-form concern、與資料正交（docs/27 §1）；一個 JSONB、零 DDL、易版本化/undo/預設投影。B 汙染資料表 + 多表；C 破 options strict schema。**證據**：Ragic layout 為 form 級 metadata |
| **OQ-FD2-2** | 設計草稿 / undo 模型 | A. **layout/設定走草稿**（批次 Save + in-session Ctrl+Z）；**結構性加/刪/改型別維持即時 DDL、不入 undo**（Ragic 排除清單一致）<br>B. 全延遲變更集（結構性亦 pending → 批次 DDL on Save）<br>C. 無草稿（live per-action，Baserow 式） | **A** — 交付 2D 畫布 + layout 草稿（uplift 主體）而**不重寫 DDL provision 鏈**（低風險）；結構性即時對齊 Ragic「資料異動操作不可復原」排除清單。**證據**：Ragic 延遲變更集+Ctrl+Z 且明列 undo 排除（公式重算/序號填入）；Baserow live 為另一極。全延遲結構性 = P1 |
| **OQ-FD2-3** | 靜態敘述 / 圖片元素落點 | A. **layout 元素**（`layout.statics`，無 field_def、無資料欄）<br>B. 新 systemManaged 型別（staticText/staticImage，no-op buildColumn） | **A** — 靜態=顯示層 layout 註記；避免汙染 field_def + 免 no-op 欄 hack。**證據**：Ragic 敘述欄位為獨立元素、值不存 DB（doc/35） |
| **OQ-FD2-4** | 分段模型 | A. **列範圍註記**（`layout.sections`：連續列、一群/表、不可獨立重排）<br>B. 分段實體 + 明確欄位歸屬 | **A** — 直配 Ragic 語意（由上而下、一群/表、順欄序）。**證據**：Ragic doc/121 |
| **OQ-FD2-5** | 畫布渲染 — 自建 vs 套件 | A. **自建輕量 2D 格線**（CSS Grid + dnd-kit 拖曳）<br>B. react-grid-layout<br>C. Glide（資料網格，非設計畫布）| **A** — 表單設計畫布=CSS grid 格子 + dnd-kit（OSS MIT、a11y）；react-grid-layout 為儀表板 free-form resize、偏重。**證據**：Ragic 欄位=格線雙格；OSS-only（[[feedback_oss_only]]） |
| **OQ-FD2-6** | P0 範圍 + 預設值變數 | A. **採 docs/27 §1 P0/P1 分界**：P0 = 畫布定位/span + 靜態文字圖片 + 分段 + 欄位設定核心（**create-time 預設值集** + readonly/hidden/placeholder/help）+ 草稿+Ctrl+Z；P1 = 條件式格式 / 格式 mask·民國年 / Ctrl+K / 版本史<br>B. 加大 P0（含 # 修改時變數 / $SEQ / 條件式格式）| **A** — create-time 集（8 建立變數 + literal + 公式 default）涵蓋常用；# 修改時集 + $SEQ（重疊 autoNumber）+ 條件式格式 = P1。維持四模組時程 band |
| **OQ-FD2-7** | 既有線性設計模式 — 取代 vs 並存 | A. **2D 畫布取代線性設計模式**（既有表 → 預設投影：每欄一列 header+value）；palette + 設定面板保留<br>B. 2D 畫布為新模式、與線性並存 | **A** — D1 裁定畫布=填單畫面本身即設計主體；既有表 lazy 預設投影（對齊 workspace-ia/views-list lazy）。並存=雙維護、心智分裂。**證據**：docs/27 D1 canvas-first |

---

## 12. 失效場景反思（FMEA）— M5 收尾（R17）；✅=已驗證緩解

| # | 場景 | 緩解 | Sev | 狀態 |
|---|---|---|---|---|
| F1 | layout PUT 跨租戶 / 引用他表 fieldId | tenant scope（MetadataService）+ LayoutService 驗 fields key ⊆ 該 form field_def id;PUT design 權 | P0 | ✅ layout.integration:B PUT A→404、不存 fieldId→422 |
| F2 | 靜態元素 XSS（href/imageUrl/Markdown）| `safeUrl` refine（僅 https/相對,擋 javascript:/data:）於後端 layoutSchema | P0 | ✅ href `javascript:`→400。⚠️ 殘留:填單頁 Markdown sanitize 待後續(設計器只存不渲染 raw HTML) |
| F3 | layout hidden 被誤當欄位權限 → 洩漏 | D4:hidden 純顯示層;maskRead 欄位級權限後端硬底不變;UI 標「排版層,非權限」 | P0 | ✅ by design(hidden 不改 records API 回傳) |
| F4 | 預設值變數注入 | 變數封閉列舉(`DEFAULT_VARIABLES`)switch 解析(非字串插值);formula-default 回 undefined(P1)| P0 | ✅ default-value.ts;layout.integration 驗 $DATE/$USERID |
| F5 | 既有表（layout=null）設計模式壞 | `effectiveLayout` 預設投影(field.position→每欄一列);resolveForm layout safeParse 兜底 | P1 | ✅ designer.spec 對 form 1 渲染 |
| F6 | 未存離開遺失草稿 | `beforeunload` 警示(dirty 時)| P1 | ✅ |
| F7 | undo 撤銷已 DDL 的結構操作 → 不一致 | 結構性(加/刪欄=即時 DDL)不入 undo 軸(OQ-FD2-2 A);undo 僅 layout 時間軸;UI「下架=即時不可復原」 | P1 | ✅ hist 僅收 layout edit |
| F8 | layout 與 field_def 漂移（欄位已刪但 layout 殘留）| 渲染以 form.fields 為源(殘留 layout 鍵忽略);PUT 驗 key ⊆ form | P1 | ✅ |
| F9 | 部署順序：前端先於 0010 migration | migration 必先(R10;dev 已 migrate);缺欄時 layout 讀 null → 預設投影(優雅降級)| P1 | ✅ |
| F10 | 大 layout JSONB 效能 / colSpan 越界 | layout 為 form 級單列;Zod 上限(statics≤200/sections≤50/colSpan≤50);metadata 快取 P1 | P2 | ✅ schema 上限 |

> **檢查點**:P0（F1–F4）全 ✅ → SHIPPED。殘留:F2 填單頁 Markdown sanitize、格式 mask/民國年/條件式格式(§1 P1,隨 field-types-parity)、分段列範圍細調 / Ctrl+K 搜尋 / 版本史(§1 P1)、全延遲結構性變更集(OQ-FD2-2 B,P1)。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-25 | v0.1 | 初版 DRAFT — docs/27 §6 順序 3（承 views-list）：2D 格線畫布 + 靜態元素 + 分段 + 欄位設定核心 + 設計草稿/Ctrl+Z；核心洞見 layout 與資料正交（form_def.layout JSONB，DDL 不動）；OQ-FD2-1..7 待裁定 | Claude Code |
| 2026-07-25 | v0.2 | **OQ-FD2-1..7 全裁定（全採建議=全 A）;DRAFT → APPROVED,進 M1**。定調:form_def.layout JSONB 承載整表版面（座標+設定+靜態+分段）;layout 草稿+Ctrl+Z、結構性 DDL 即時不入 undo;靜態=layout 元素;分段=列範圍;CSS grid+dnd-kit;2D 畫布取代線性設計模式 | Claude Code |
| 2026-07-25 | v1.0 | **M1–M5 SHIPPED**。M1 form_def.layout(0010)+ LayoutService GET/PUT(fields key⊆form 驗證、href/imageUrl https 白名單)+ createRecord create-time 預設值變數。M2 設計模式改 2D CSS 格線畫布(dnd-kit 拖曳、預設投影)。M3 欄位設定面板(placeholder/help/readonly/hidden/預設值)+ 靜態文字/圖片元素 + 分段。M4 設計草稿時間軸(hist+idx)+ Ctrl+Z/redo + beforeunload。M5 designer.spec 固化(拖曳用分步 mouse 驅動 dnd-kit)。FMEA F1–F4 P0 全 ✅;殘留明列(填單頁 Markdown sanitize / §1 P1)。api 226 + web 15 e2e 綠。 | Claude Code |
| 2026-08-03 | v1.1 | **補 §0 站在巨人的肩膀(retrospective)** —— 承 `_audit/giants-shoulders-audit-A.md` §4.1「本批唯一三站皆未做且未補」。**§1–§12 未改**,需重裁者列 §0.5。<br>**站①**:與 `docs/27` §1 P0 逐字比對出**三處不符** —— 上游原文即為「表單分段(**section tabs**)…子表格可入段(**lazy load 加速**)」(分段錯形狀**不必碰競品就能攔下**)、「列高/欄寬可調」、「新表 105×21」vs 實作 12 欄且 `grid.cols` 無 writer。零 reader 全掃**再查出四項**(稽核只證實一項):`statics[]` 全部、`sections[]`、`fields.readonly`(⚠️ 唯讀設了不生效)、`help` 文字、`sectionId`、`style` 於**填單/記錄頁皆為 0** → §1.1 目標 2/3 只在設計模式成立。<br>**站②**:`@dnd-kit/core@6.3.1` 未接 `modifiers`(拖曳中不吸附格線;`applyModifiers` 由 core 匯出,不需新相依)與 `accessibility.announcements`(預設播報逐字為英文 + 內部 id `f:123`、`over` 恆 null 故無座標);預設鍵盤位移 25px vs 本畫布 60×32。🔴 **`@glideapps/glide-data-grid@6.0.3` 內建 `onColumnResize`(逐字附)但全 repo 命中 0** —— 列表頁欄寬有一半是現成的,且其預設 min/max(50/500)與 `layout-specs` 的 40/800 不同,共用資料會互相截斷。<br>**站③**:Ragic doc/121 · doc/21 · doc-kb/306 + Airtable + Teable **逐字 + 路徑 + 查證日 2026-08-03**;Airtable「Tab navigation…click tabs to navigate through grouped sections」為**獨立於 Ragic 的第二個一手證據**(兩家收斂於頁籤),但其 group 可拖曳重排,與 Ragic 相反 → 本模組承接 Ragic 限制係一項選擇。Baserow 標**未查證**(本機鏡像僅開發者文件)。<br>**§0.4** 逐項給出「當初怎麼攔」;另發現 FMEA **F2 殘留欄早已記載「設計器只存不渲染」**,卻被歸為安全殘留而未回頭對 §1.1 目標。 | Claude Code |
