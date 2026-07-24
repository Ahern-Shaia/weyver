# form-designer-2d.md — [R1·UP-3] 2D 表單設計器（form-designer-ui uplift）設計文件

> ✅ **狀態：APPROVED — OQ-FD2-1..7 已裁定（2026-07-25;全採建議 = 全 A）;進入 M1**
> **裁定摘要**｜1=A 單一 form_def.layout JSONB · 2=A layout 草稿+Ctrl+Z / 結構性即時 DDL 不入 undo · 3=A 靜態=layout 元素 · 4=A 分段=列範圍 · 5=A CSS grid + dnd-kit · 6=A 採 §1 P0/P1 分界 · 7=A 2D 畫布取代線性。
>
> docs/27 §6 順序 3（承 views-list SHIPPED）。落地 D1 裁定「2D 格線畫布 = 填單畫面本身」：把既有 builder 的**線性欄位清單**設計模式 uplift 成 **Excel 式 2D 格線畫布**（欄位以 row/col/span 擺位、跨欄合併、拖曳）+ **靜態敘述/圖片元素** + **表單分段** + **欄位設定核心**（預設值 17 變數 / 唯讀 / 隱藏 / placeholder / 說明）+ **設計草稿模型**（批次 apply + Ctrl+Z）。
>
> **核心架構洞見（docs/27 §1）**：**版面能力皆 layout metadata（座標/樣式/分段/設定），與資料層正交** —— form-engine-core 的 DDL/DML 鏈**不需動**；主戰場 = `form_def` 增 `layout` JSONB + 設計器前端改畫布。這使本模組雖大但風險可控（純 metadata，零 schema 遷移風險）。
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-25）
> 證據：docs/27 §0 D1 + §1（P0/P1/P2）、本地競品參照庫（Ragic doc/21·37·38·35·123·121·50·53·143、Baserow undo-redo-guide、Airtable forms）、現有 builder 盤點（edit-form-panel 線性清單 / ddl.service 即時 per-field DDL / field_def 僅 position / 19 型別 3 stub）

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
- ❌ **條件式格式**（顯示/隱藏/唯讀/必填/變色依條件）｜docs/27 §1 P1（需規則引擎 UX，隨 actions-approval / ZEN）。
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
| **M1** | 後端：form_def.layout（0010）+ layout API + createRecord 預設值（api commit）| ⏳ |
| **M2** | 前端：2D CSS 格線畫布 + 拖曳定位 + 合併/列高欄寬 | ⏳ |
| **M3** | 前端：靜態元素 + 分段 + 欄位設定面板 | ⏳ |
| **M4** | 前端：設計草稿 + Ctrl+Z undo（M2–M5 web commit）| ⏳ |
| **M5** | designer.spec 固化 + FMEA + doc v1.0 + MODULES ✅ | ⏳ |

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

## 12. 失效場景反思（FMEA）— M5 收尾必填（R17）；pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| F1 | layout PUT 跨租戶 / 引用他表 fieldId | tenant scope + fieldId ⊆ 該 form field_def 驗證;e2e 斷言 | P0 |
| F2 | 靜態元素 XSS（Markdown/href/imageUrl）| sanitized Markdown（禁 raw script）+ href/imageUrl https 白名單 + SSRF 擋私網 | P0 |
| F3 | layout hidden 被誤當欄位權限 → 洩漏 | D4：hidden 純顯示;maskRead 後端硬底不變;文件明標 + review | P0 |
| F4 | 預設值變數注入 | 變數封閉列舉 switch 解析（非字串插值）;formula-default 走既有白名單引擎 | P0 |
| F5 | 既有表（layout=null）設計模式壞 | 預設投影計算（field.position → 每欄一列）;e2e 對既有表斷言 | P1 |
| F6 | 未存離開遺失草稿 | 未存離開警示（beforeunload / 路由攔截）| P1 |
| F7 | undo 撤銷了已 DDL 的結構操作 → 不一致 | 結構性操作不入 undo stack（OQ-FD2-2 A）;undo 僅 layout;文件明標 | P1 |
| F8 | layout 與 field_def 漂移（欄位已刪但 layout 殘留）| PUT 驗證 + 渲染時 layout.fields ∩ 現存 field_def（殘留鍵忽略，如 views-list displayFields）| P1 |
| F9 | 部署順序：前端先於 0010 migration | migration 必先（R10）;缺欄時 layout 讀 null → 預設投影（優雅降級）| P1 |
| F10 | 大 layout JSONB（超多欄）效能 | layout 為 form 級單列;metadata 快取（P1）;colSpan/statics 數上限驗證 | P2 |

> **檢查點**：M5 收尾時所有 P0（F1–F4）須 ✅ 方可標 SHIPPED。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-25 | v0.1 | 初版 DRAFT — docs/27 §6 順序 3（承 views-list）：2D 格線畫布 + 靜態元素 + 分段 + 欄位設定核心 + 設計草稿/Ctrl+Z；核心洞見 layout 與資料正交（form_def.layout JSONB，DDL 不動）；OQ-FD2-1..7 待裁定 | Claude Code |
| 2026-07-25 | v0.2 | **OQ-FD2-1..7 全裁定（全採建議=全 A）;DRAFT → APPROVED,進 M1**。定調:form_def.layout JSONB 承載整表版面（座標+設定+靜態+分段）;layout 草稿+Ctrl+Z、結構性 DDL 即時不入 undo;靜態=layout 元素;分段=列範圍;CSS grid+dnd-kit;2D 畫布取代線性設計模式 | Claude Code |
