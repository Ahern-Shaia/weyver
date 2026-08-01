# record-workbench-ui.md — [R1·workbench-uplift] 記錄工作台收斂(集合視圖 → Object Page)設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-28;M1–M4 + FMEA E1–E3 / U1–U4)**|A0/A1 由 workspace-ia 與 views-list 交付,A2–A5 由本輪完成
>
> ### ⚠️ v0.5 範圍重整(2026-07-28;對照程式碼查證,非僅讀文件)
> 本檔寫於 2026-07-24;其後 workspace-ia(07-25)與 views-list(07-25)**各自吸收了本檔的 A0 與 A1**。逐項核對結果:
>
> | 原工作項 | 判定 | 承接者 / 證據 |
> |---|---|---|
> | **A0 app-shell 密度**(status bar / 首頁工作面 / 導覽 rail)| ✅ 已交付 | workspace-ia v1.0(`app/app/layout.tsx` footer status bar、`app/app/page.tsx` 分類目錄、左 icon rail)|
> | **A1 集合視圖**(browse 網格 / 雙模式 / inline 編輯 / 批次)| ✅ 已交付 | views-list v1.0(`collection-view.tsx`、`form-workspace.tsx`)|
> | **OQ-RWB-1 nested 路由** `/forms/[id]/[recordId]` | 🔄 **已被取代** | views-list OQ-VL-7 改採同路由 nuqs `?mode=&rid=`(狀態集中於 URL query,免 layout 重載);deep-link 能力等價 |
> | **A2 Object Page 補強**(狀態章 / 金額彙總 / 稽核 user 名 / rail enrich)| ❌ 未做 | 稽核仍顯示 `actor #7` |
> | **A3 關聯 rail(正+反向)** | ❌ 未做 | `relation_def` 已有 `target_form_id`,反向查詢端點未建 |
> | **A4 Object Page inline 編輯** | ❌ 未做 | 現況仍跳設計器(`object-page.tsx` 之 Pencil 連結)|
> | **A5 後端小端點**(users lookup / reverse-relations)| ❌ 未做 | — |
>
> **剩餘 ≈ 0.15 mo**(原 0.26 扣除已交付之 A0 0.04 + A1 0.06,並 -0.01 因 OQ-1 路由已由 views-list 解決)。OQ 裁定**全部沿用不重議**(3=A 首個 singleSelect / 4=B 正+反向 / 5=A inline 編輯 / 7=A users lookup)。
>
> ~~✅ **狀態:APPROVED — OQ-RWB-1..7 已裁定(2026-07-24;全採建議);進入 M1(A0 app-shell 密度先做)**~~
> **裁定摘要**|1=B nested 路由 · 2=A 復用 Glide · 3=A 首個 singleSelect 為狀態 · 4=B 正+反向關聯 · 5=A inline 編輯 · **6=C 單域 rail+status bar** · 7=A users lookup 端點。
>
> 承 form-designer-ui(P0-1 SHIPPED)+ 現有記錄工作台(`/app/forms/[formId]` 已是誠實的 Object Page 雛形)。把整合 mockup(`weyver-integrated-list-to-object.html`)的方向落成可執行收斂:補上**缺的「集合視圖」那一層**(browse/triage 網格),並就地補強 Object Page 的 R1 信號(狀態章 / 金額彙總 / 關聯 rail / 真實使用者名 / inline 編輯)。**只做 R1 後端撐得起的**;mockup 上屬 R2/工作流的(GL 過帳、簽核 stepper、批號追溯)一律不放(不造假)。
>
> 作者:Claude Code（草擬）
> 版本:v0.2（2026-07-24;納入 A0 app-shell 密度、OQ-6 改三選建議翻 C）
> UI 依據:`docs/mockups/weyver-integrated-list-to-object.html`(集合視圖 ① → Object Page ②)

---

## 1. 目標與範圍

### 1.1 目標

1. **app-shell 密度(入口 + 外殼)**|全域 **status bar**(已連線 / 更新到秒 / 租戶 / 版本)+ 首頁 `/app` 由「表單卡牆」改**工作面**(卡片塞 記錄數 / 更新 / 狀態,或首頁即記錄集合)+ 導覽外殼重量(OQ-6)。**直接解「頁面單薄」之第一印象**(2026-07-24 視覺反思)。
2. **集合視圖(缺的那一層)**|進入一張表單預設看到**記錄集合**(密集網格 / triage):狀態章、金額 tabular 右對齊、開啟一筆 → 進 Object Page。補上現況「表單卡片 → 直接 Object Page」中間缺的 browse 層。
3. **Object Page R1 補強**|狀態章進黏頂頭、金額彙總 section(formula)、稽核顯示真實使用者名、記錄清單 rail 加金額/狀態。
4. **關聯 rail(R1 部分)**|Object Page 右欄加「關聯記錄 · Link&Load」(正向主檔 + 反向被引用);**簽核 / GL 不放**。
5. **inline 編輯**|Object Page「編輯」由跳設計器改為就地檢視↔編輯切換(填單 UI 已有)。
6. **誠實對齊**|凡 R2/工作流功能(GL 過帳、簽核、批號追溯)不進 chrome;phase 標記不進產品畫面(對齊 [[feedback_no_dev_phase_in_product_ui]])。

### 1.2 對應訴求

| 子題 | 主要訴求 | 對應點 |
|---|---|---|
| 記錄工作台 | Ragic 範式:主畫面=可瀏覽的記錄集合 + 單筆深挖(非 KPI 儀表板) | docs/24 心智模型([[feedback_design_from_mental_model]])· 整合 mockup ①②;競品錨:Fiori Object Page / Airtable-NocoDB 網格 / Attio-Linear master-detail |

### 1.3 不做的事(scope 邊界)

- ❌ **GL 過帳預覽** → R2 計算層(calc-binding-layer P0-6);mockup 有,現況不放。
- ❌ **簽核 stepper / 核准·退回動作** → 工作流模組(P0-4,未起)。
- ❌ **批號追溯 chip** → R2 批號追蹤(P0-8)。
- ⬆️ **導覽外殼(OQ-RWB-6)本模組處理**|全域 status bar 加;nav rail 三選(維持 topbar / **單域 rail+status bar** / 業務域 rail),建議單域 rail —— 拿外殼重量、不放空的業務域 tab。**不做**空的業務域 tab(計算/生產/ISO R1 未起)。
- ❌ **⌘K 命令列** → nice-to-have,本模組不做(可另立)。
- ❌ **附件上傳儲存** → attachment 型別 registry 有、儲存後端未備;本模組不做附件 section。
- ❌ **不重寫既有 Object Page 骨架**(master-detail / 錨點 scroll-spy / label-value / 子表 rollup / 稽核時間軸皆已 SHIPPED,只補強不重做)。

---

## 2. 上游 / 既有現況走查

| 元件 | 現況 | Gap |
|---|---|---|
| Object Page | `forms/[formId]/_components/object-page.tsx`:黏頂頭 + 錨點 scroll-spy + 基本資料 label/value + 明細 rollup + 稽核時間軸 | ✅ 骨架約 70% 到位;缺 狀態章 / 金額 section / 關聯 rail / user 名 / inline 編輯 |
| 記錄清單 rail | `record-list.tsx`(240px:標題 + #id)| 偏薄 → enrich 金額/狀態 |
| 子表 rollup | `line-items.tsx` + rollup.service P0-3 SHIPPED | ✅ |
| 記錄 list 端點 | `api/forms/:formId/records`(cursor 分頁,回 values/version/createdBy…)| ✅ 集合視圖資料源就緒 |
| 網格 | Glide 網格 `record-grid-panel.tsx`(P0-2 SHIPPED)**綁在 builder 填單情境** | 需抽成獨立 per-form 集合視圖(OQ-RWB-2) |
| 集合視圖路由 | **無** —— `/app`(表單卡片)→ 直接 Object Page | 全新加一層(OQ-RWB-1) |
| 關聯反向查詢 | relation.service 做**正向** Link&Load(讀時載入 link 欄值);**無**「哪些記錄引用本筆」端點 | 反向關聯需**新後端端點**(tenant-scoped + 權限) |
| 使用者名解析 | 記錄有 `createdBy`(actor id);**無** users lookup 端點 | 稽核顯示 `actor #id` → 需**小後端** users 名查詢 |
| 狀態欄概念 | 無「狀態欄」metadata;singleSelect 為一般欄 | 狀態章需判定哪欄是狀態(OQ-RWB-3)|
| 首頁 `/app` | `app/page.tsx`:greeting + Signature + **表單卡牆**(每卡=圖示+名+「表單」,零資料)| 卡片零資訊、45 張雷同、窄置中欄浪費寬度 → 改工作面 / 塞真資料(A0)|
| 全域 chrome | topbar 細條;**無 status bar**、無常駐 nav rail | 缺「系統重量」信任訊號 → 加 status bar + 單域 rail(A0/OQ-6)|
| 導覽 | `app/layout.tsx` topbar 橫向(工作區/我的表單/權限/帳號安全)| 與 mockup rail 不同;OQ-6 三選 |

---

## 3. 剩餘 scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| ~~**A0 app-shell 密度**~~ | ✅ **已由 workspace-ia v1.0 交付**(status bar / 分類目錄首頁 / icon rail)| ~~0.04 mo~~ |
| ~~**A1 集合視圖**~~ | ✅ **已由 views-list v1.0 交付**(Glide browse / 雙模式 / inline 編輯 / 批次 / 匯出)| ~~0.06 mo~~ |
| **A2 Object Page 補強** | 狀態章進黏頂頭(OQ-3)+ 金額彙總 section(formula)+ 稽核 user 名 + rail 加 金額/狀態 | 0.05 mo |
| **A3 關聯 rail + 反向端點** | 後端 reverse-relations 查詢端點(tenant + 權限)+ Object Page 右欄「關聯記錄」;簽核/GL 不放 | 0.04 mo |
| **A4 inline 編輯** | Object Page 檢視↔編輯就地切換(接既有填單 UI + PATCH) | 0.03 mo |
| **A5 後端小端點** | users lookup(id→name,tenant-scoped)+ A3 reverse-relations 端點的 service/repo/測試 | 0.03 mo |
| **M-FMEA** | §12 逐路徑;P0 全清 | 0.01 mo |

**原合計** ≈ 0.26 mo;**v0.5 剩餘** ≈ **0.15 mo**(A2–A5 + FMEA;A0/A1 已交付)。前端與後端(A5 端點)**分開 commit**([[feedback_separate_frontend_backend]])。

### 3-ter. v0.5 落地順序(2026-07-28)

| 里程碑 | 內容 |
|---|---|
| **M1 後端**(A5)| `GET /api/users/lookup?ids=`(限本租戶 `role_members`,只回 `{id,name}`)+ `GET /api/forms/:formId/records/:recordId/relations`(反向被引用,經 EffectivePermissions 過濾)|
| **M2 前端**(A2)| 狀態章(OQ-3=A 首個 singleSelect)+ 金額彙總 section + 稽核顯示真實 user 名 |
| **M3 前端**(A3/A4)| 關聯 rail(正向 link 主檔 + 反向被引用)+ Object Page inline 檢視↔編輯 + 記錄清單 rail enrich(金額/狀態)|
| **M4 收尾** | `record-workbench.spec` + §12 FMEA + doc v1.0 + MODULES ✅ |

---

## 3-bis. A0 app-shell 密度(入口 + 外殼)

> 回應 2026-07-24 視覺反思「頁面單薄」:doc 原只補 Object Page 深度,不含**入口(首頁)與外殼(status bar / nav)**——那正是「薄」的第一印象來源。

- **全域 status bar**|`app/layout.tsx` 底部固定條:`● 已連線 · 更新 hh:mm:ss · 租戶 <slug> · Weyver <版本>`。信任訊號(docs/14),每頁受惠、成本極低、風險最小 → **A0 先做**。
- **首頁 `/app` 工作面**|卡牆 →(a)卡片塞 記錄數 / 最近更新 / 狀態章(低改動,先做),或(b)首頁預設落一張「常用表單」的集合視圖(較大,依 A1)。對齊 docs/24「記錄工作面非啟動器」;順帶修窄置中欄(用滿寬度)。
- **導覽 rail(OQ-6)**|見 §10;建議 **C 單域 rail + status bar**,拿外殼重量不造空業務域 tab。

---

## 4. A1 集合視圖

### 4.1 路由與資料流(見 OQ-RWB-1)
- 建議 B:`/app/forms/[formId]` = **集合視圖**(預設);`/app/forms/[formId]/[recordId]` = **Object Page**(deep-link)。Object Page 仍保留窄清單 rail 供快速換筆。
- 資料源:`useRecords(formId)`(既有,cursor 分頁);欄由 `form.fields` 動態生成;狀態欄依 OQ-3 判定。

### 4.2 渲染(見 OQ-RWB-2)
- 建議 A:復用 Glide 網格(P0-2),加「browse 模式」——列可點開(→ Object Page)、狀態欄以顏色/章呈現、金額欄 tabular 右對齊;鍵盤 ↑↓ 選、↵ 開。
- 若走 B(輕量 HTML table):換得帶框狀態章 / 批號 chip 的精確美學,代價是第二套網格 + 大量記錄需自實作虛擬化。

### 4.3 UI
- topbar:表單名 + 記錄數 + 修改設計 / 新增記錄;列表·單筆(暫留列表);篩選;鍵盤提示。對照 mockup ①,**不含 ⌘K / 批號 chip**(scope 外)。

---

## 5. A2 Object Page 補強 · A3 關聯 rail · A4 inline 編輯

- **狀態章(A2)**|黏頂頭標題旁加狀態欄值之帶框章(色依狀態層級:已了結中性、待辦著色);狀態欄判定見 OQ-3。
- **金額彙總 section(A2)**|若表單有 formula 欄(小計/稅/總計語意),渲染 sumbox;無則不顯示(不造假)。
- **稽核 user 名(A2/A5)**|`actor #id` → 真實姓名,經 users lookup 端點(A5);查無 fallback `#id`。
- **rail enrich(A2)**|`record-list.tsx` 每列加 金額(money 欄)+ 狀態章。
- **關聯 rail(A3)**|右欄「關聯記錄 · Link&Load」:正向(link 欄指向的主檔,已有值)+ 反向(`reverse-relations` 端點:哪些記錄引用本筆)。**簽核 / GL 區塊不放。**
- **inline 編輯(A4)**|header 檢視/編輯切換:編輯模式接既有 field-input 填單 UI + `useUpdateRecord`(PATCH,樂觀鎖 version);設計仍跳 builder。

---

## 7. 資料模型變動

### 7.1 Proto / Schema
- 無 schema 變更(前端 + 唯讀查詢端點為主)。狀態欄若採 OQ-3=B(表單級指定)才需 `form_def.status_field_id`(小欄,屆時再定)。

### 7.2 新端點(A5,皆唯讀、tenant-scoped、權限守)
- `GET /api/forms/:formId/records/:recordId/relations` → 反向關聯(引用本筆之記錄摘要)。
- `GET /api/users/lookup?ids=1,2,3` → actor id → { id, name } (同租戶 users;不回他租戶)。

### 7.3 RLS / Permission
- 反向關聯查詢:結果經 PermissionGuard / EffectivePermissions 過濾(無權表單之關聯不回);tenant scope 綁定。
- users lookup:限本租戶 `role_members`/actor 範圍,不洩他租戶使用者。

---

## 7-bis. 企業級 cross-cutting(擇要)

### 7-bis.1 安全
| 攻擊面 | 緩解 |
|---|---|
| 反向關聯洩漏無權表單記錄 | 端點結果過 EffectivePermissions(canRead)+ tenant scope;敏感表關聯不回 |
| users lookup 跨租戶列舉使用者 | 只回本租戶 users;ids 過濾同租戶;回 { id, name } 不含 email/敏感欄 |
| 集合視圖大量記錄 over-fetch | 沿用 records 端點 cursor 分頁 + 回應 DTO 只回需要欄 |
| inline 編輯繞過欄位級遮罩 | 走既有 record.service 寫白名單(P0-4a M4);hidden/唯讀欄不可寫 |

### 7-bis.6 向後兼容
- 純加法:新路由 + 新唯讀端點;既有 Object Page/records 端點不動。集合視圖為新預設進入點,舊 deep-link 到 Object Page 仍可用(OQ-1 決定)。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit(web)| 狀態欄判定 heuristic / 金額格式化 / 關聯資料整形 | `*.test.ts` |
| Integration(api,真 PG)| reverse-relations 端點(tenant 隔離 + 權限過濾:無權表單關聯不回)· users lookup(不洩他租戶)| `tests/` |
| e2e(Playwright)| 集合視圖 → 開啟一筆 → Object Page → inline 編輯存檔 → 稽核顯示;固化進 CI | `apps/web/e2e/workbench.spec.ts` |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-RWB-1..7,全採建議)| 0.02 mo | ✅ |
| **M1** A0 app-shell 密度 | 全域 status bar + 首頁工作面(卡片塞資料 / 縮寬)+ 導覽 rail(OQ-6);**最便宜、最有感,先做**;**前端 commit** | 0.04 mo | ⏳ |
| **M2** A5 後端端點 | reverse-relations + users lookup(tenant + 權限 + 整合測);**後端 commit** | 0.03 mo | ⏳ |
| **M3** A1 集合視圖 | 路由 + 網格 browse + 狀態章 + 開啟;鍵盤 triage | 0.06 mo | ⏳ |
| **M4** A2 Object Page 補強 | 狀態章 / 金額 section / user 名 / rail enrich | 0.05 mo | ⏳ |
| **M5** A3 關聯 rail + A4 inline 編輯 | 右欄關聯 + 就地編輯;Playwright 實走 + spec 固化;**前端 commit** | 0.04 mo | ⏳ |
| **M6** FMEA + doc | §12;doc → v1.0 + MODULES ✅ | 0.02 mo | ⏳ |

---

## 10. 開放問題（OQ-RWB-N）— ✅ 已裁定 2026-07-24（全採建議）

> **裁定**|全數採「建議」欄:1=B · 2=A · 3=A · 4=B · 5=A · **6=C**(修正建議)· 7=A。進入 M1。

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-RWB-1** | 集合↔Object 路由 | A. 同路由 `?record=`<br>B. **nested `/forms/[id]` 集合 + `/forms/[id]/[recordId]` object**<br>C. 現況不動,集合另開 `/table` | **B** — 乾淨、可 deep-link、SEO/分享友善;集合為預設進入,點列進 Object Page(仍留清單 rail 換筆) |
| **OQ-RWB-2** | 集合視圖渲染 | A. **復用 Glide 網格**(可編輯/虛擬化,已 SHIPPED)<br>B. 輕量唯讀 HTML table(triage 美學) | **A** — 避免維護第二套網格 + 大量記錄需虛擬化;代價:帶框狀態章要以 Glide 自訂 cell 近似。⚠️ 若你更要 mockup ① 的精確 triage 美學,選 B(想聽你定) |
| **OQ-RWB-3** | 狀態欄判定 | A. **慣例:第一個 singleSelect 為狀態**(零設定,可能猜錯)<br>B. 設計器指定狀態欄(`form_def.status_field_id`,小後端)<br>C. 不做狀態章 | **A(R1)** — 零設定先上,多數採購/工單表首個選單即狀態;日後升 B。C 太保守失去信號 |
| **OQ-RWB-4** | 關聯 rail 範圍 | A. 只正向 link 主檔(零後端)<br>B. **正向 + 反向被引用**(小後端端點)<br>C. 不做關聯 rail | **B** — 反向「本採購單被哪些進貨單引用」是價值所在(Link&Load P0-3 已有正向);簽核/GL 仍不放 |
| **OQ-RWB-5** | 編輯模式 | A. **Object Page inline 檢視↔編輯**<br>B. 維持跳設計器(現況) | **A** — 就地編輯才是 Object Page 正解;填單 UI + PATCH 已有,低成本 |
| **OQ-RWB-6** ⭐ | 導覽外殼 | A. 維持 topbar 橫向<br>B. 業務域 icon-rail(表單/計算/生產/ISO;後三 R1 未起=空 tab)<br>C. **單域 rail(只表單)+ 全域 status bar** | **C(修正,原建議 A)** — 「單薄」有一半來自缺外殼重量;C 拿到 rail + status bar 的系統重量,又**不放空的業務域 tab**(不造假)。待 ERP/MES/ISO land 再由 C 擴為 B。B 現在做=為視覺造假 roadmap |
| **OQ-RWB-7** | user 名解析 | A. **users lookup 端點(id→name)**,前端解析<br>B. 記錄 read join 帶回 name | **A** — 獨立可快取端點,不讓每列 record 膨脹;只回 { id, name } 不洩敏感欄 |

---

## 12. 失效場景反思（FMEA）— ✅ M4 收尾確認(2026-07-28)

> **結論**|P0(E1/E2/U1/U2)全數已緩解且有測試斷言;U3 為 OQ-3=A 之已知取捨(下方說明取捨如何收斂);E3/U4 為既有機制覆蓋。

### 12.1 反向關聯 / users lookup 端點
| # | 場景 | 影響 | 預定緩解 | Sev |
|---|---|---|---|---|
| E1 | 反向關聯回無權/敏感表記錄 | 越權 / 敏感外洩 | ✅ 來源表未過 `hasAction(view)` → **整組不回**(不洩漏「有東西引用你」);記錄本身再經 RecordService policy 遮罩。測:跨租戶查詢回空且 payload 不含任何摘要 | P0 |
| E2 | users lookup 列舉他租戶使用者 | 跨租戶洩漏 | ✅ `users` 非 RLS → 以 `role_members` inner join 綁租戶為唯一防線;只回 `{id,name}`,name 空時退回 email 本地部分**不回完整 email**。測:A 查 B 的 actor → 空;混合 id 只回同租戶者 | P0 |
| E3 | 反向關聯 N+1 | 效能 | ⚠️ 每個來源表一次查詢(來源表上限 20、每表 20 筆並標 `truncated`)。單筆記錄之關聯來源實務上為個位數;真需優化時改單一 UNION 查詢 | P1 |

### 12.2 集合視圖 / inline 編輯
| # | 場景 | 影響 | 預定緩解 | Sev |
|---|---|---|---|---|
| U1 | 集合視圖顯示無權表單記錄 | 越權 | ✅ 由 views-list v1.0 交付:沿用 records 端點權限 + 清單三態(P0-4a·uplift) | P0 |
| U2 | inline 編輯繞過欄位遮罩 | 竄改 hidden/唯讀欄 | ✅ PATCH 走 `RecordService.assertWritable` 寫白名單(P0-4a M4);hidden 欄本就不在讀回值中故不會被送出 | P0 |
| U3 | 狀態欄猜錯(非狀態的 singleSelect) | 誤導 | ⚠️ OQ-3=A 之已知取捨。**降險做法**:章體恆為中性框(不臆測語意色),只在欄位 `options.colors` 明確設定時才上語意色 → 猜錯時最壞情況是「多顯示一個中性標籤」,不會誤導成「已核准=綠」。治本仍為 OQ-3=B(設計器指定狀態欄) | P2 |
| U4 | 大量記錄集合視圖卡頓 | 體驗 | ✅ 由 views-list v1.0 交付(Glide 虛擬化 + cursor 分頁) | P1 |

### 12.3 不在本模組 scope
- 簽核 stepper / 核准動作 → 工作流模組。
- GL 過帳預覽 → R2 calc-binding-layer。
- 批號追溯 / ⌘K / 附件儲存 / icon-nav 業務域 → 各自後續。

---

---

## 0-bis. 追溯稽核(2026-07-29)— **借了 SAP Fiori 的名字卻沒對照其規範**

> 本模組把右側詳情稱為「Object Page」—— 那是 **SAP Fiori 的既有語彙**。
> 本次對照 SAP Fiori Design Guidelines 官方文件檢驗是否誤用。

### 🔴 已修:切換記錄不重置編輯狀態(commit 見下)

`form-workspace.tsx` 的 `<ObjectPage>` **未帶 `key={selected.id}`**,`object-page.tsx` 亦無以
`record.id` 為依賴的 reset effect。而 `editing` / `draft` 是元件的 local state。
→ **編輯 A 未儲存 → 點左側 B → 按儲存會把 A 的值寫進 B**,且帶的是 B 的 `expectedVersion`,
**樂觀鎖擋不住**。這是 master-detail 版型特有的失效,Fiori 以 draft handling + 未儲存提示處理。
**已加 `key` + e2e 回歸測**(反向驗證過:拿掉 `key` 該測試即紅)。

### Fiori Object Page 的官方結構(照抄以便逐項比對)

**三個組成**|① dynamic page header(**必須**)② navigation bar(可選)③ content area(必須)。

**header 由上到下**|breadcrumb(標題上方)→ **title(必須)** → subtitle(標題**下方**)→ object marker
→ **header toolbar 放 global actions:Edit / Delete / Copy** → 收合指示器
→ **header content = facets**(form / plain text / image / **key value(狀態、價格等 KPI)** / micro chart / progress / rating)。
預設展開,捲動時 **snap 收合**。

**anchor bar 非必要**|內容簡單只需一段 → 用 dynamic page layout;複雜多段才用 object page layout。
預設 anchor bar,**若各段內容複雜(長表格 / 清單)改 tab bar**。
硬規則:**section 一律直接反映在導覽列**;section 只能裝 subsection、**不能直接裝內容**;
第一個 section 無標題;**窄螢幕時 anchor bar 變下拉選單**。

**🔴 表格量級階梯(同樣適用關聯區,可直接照做)**

| 筆數 | 官方作法 |
|---|---|
| ≤ 20 | 直接顯示全部 |
| ≤ 100 | **lazy load** |
| 50–400 | 改用 **tab** |
| > 400 | **只顯示 10–20 筆預覽 + 右下 `Show All (x)`** 導向 list report |

> 本專案關聯 rail 目前一律截斷 20 筆並標示 —— 對 ≤20 正確,但**中量級(20–400)缺 lazy load 與 tab、
> 大量級缺 Show All 導向**,使用者無法得知「其實還有 300 筆」。

**明確不該用 object page 的情況**|需**同時編輯多筆**、或**不知明細下找項目** → 應用 list report。

### Fiori Object Page 官方規範對照

| 項目 | 判斷 | 官方規範 |
|---|---|---|
| 借用「Object Page」名稱 | ✅ **站得住** | header / anchor / sections / display↔edit 四要件齊備 |
| display 與 edit **同版面不移位** | ✅ **完全合規** | 官方原文「切換模式時內容不得改變位置」—— 這是最像 Fiori 的一點 |
| Save / 取消放 header,**無 footer toolbar** | ⚠️ **應調整** | 官方分工明文:**Edit / Delete / Copy 在 header,Save / Post / Accept / Reject 在 footer**;簽核動作更該在 footer |
| anchor bar **未涵蓋全部區段**(摘要 facet、關聯記錄未列入 `sections`)| 🔴 **違反** | 官方硬規則:**section 一律直接反映在導覽列** |
| 狀態章 + 金額擠在 title 列,**header content 不可收合** | ⚠️ | 官方為 **key value facet** 置於 header content,捲動時 snap 收合 |
| 缺 FCL 的展開 / 全螢幕 / 關閉 + 上下筆 paging | ⚠️ | **flexible column layout** 為官方標配 |

> **一個重要澄清**|**List Report → Object Page 不等於「左清單右詳情」** ——
> 兩者是各自獨立的 floorplan,靠 **flexible column layout(1/2/3 欄可展開全螢幕)** 才並置。
> 亦即本模組的版型對應的是 **FCL**,不是 List Report + Object Page 的原生配對。

### 其餘發現

| 項 | 判斷 |
|---|---|
| **三種版型的取捨** | 參考 | **Airtable = modal**(格線是主體,詳情是暫時性)· **Notion = side peek**(保留脈絡)· **Salesforce = 全頁**(記錄極寬、related lists 多)。→ **選擇取決於「記錄有多寬」與「是否需保留清單脈絡」**;記錄很寬時右欄確實過窄,這正是 Fiori FCL 必須能**全螢幕**的原因 |
| **響應式** | 🔴 `form-workspace.tsx` **全無斷點**(無 `md:` / `lg:`),平板 / 手機必爆版。Material 官方 list-detail 降級:窄螢幕時清單與詳情各佔一畫面。詳情欄亦應隨寬度 4/3/2/1 欄降級(現固定 `sm:grid-cols-2`)|
| **行內編輯** | ✅ **事實澄清** —— 實作**不是**「點欄位即編輯 + 自動儲存」,而是 **global edit + 明確儲存 + `expectedVersion` 樂觀鎖**,正是企業慣例與 Fiori 正解。⚠️ 建議補「依狀態切換」:已核准 → 唯讀(Salesforce 對簽核鎖定記錄**直接禁止 inline edit**)|
| **關聯 rail** | ✅ 已分組、後端截斷 20 筆並標示。⚠️ 缺**筆數計數**與 **Show All (x)** 導向該表已篩選檢視 —— Fiori 對 >400 筆明文此解;Salesforce **Related Lists** 同構 |
| **「審一批不換頁」** | ✅ 訴求成立,但 Fiori 官方明說**「需同時編輯多筆」不該用 object page** → 真要批次審應在列表模式做**多選 + 批次動作**。⚠️ 目前缺批次動作,兩者應並存 |
| 清單列「標題 + 狀態章 + 金額」 | ✅ **不算過載** —— 與 Fiori key value facet 同構,是「不點進去就能決策」的最小集合 |

### 來源

- [Object Page Floorplan — SAP Fiori Design Guidelines(官方存檔 v1.82)](https://2227428884-files.gitbook.io/~/files/v0/b/gitbook-legacy-files/o/assets%2F-M7nTCCM8rifZ18NJbqH%2F-MMOwyS3Jyav-BwaYztJ%2F-MMPA_OvyQwePPa5LNQJ%2FObject%20Page%20Floorplan%20_%20SAP%20Fiori%20Design%20Guidelines.pdf?alt=media&token=e9efe194-7155-4635-bff3-7eddd96e0671)
- [Object page floorplan — SAP Design System(現行 v1-136)](https://www.sap.com/design-system/fiori-design-web/v1-136/page-types/floorplans/object-page/usage)
- [Flexible column layout — SAP Design System](https://www.sap.com/design-system/fiori-design-web/v1-84/page-types/page-layouts/flexible-column-layout/usage)
- [List-Detail Overview — SAP Fiori for Android](https://www.sap.com/design-system/fiori-design-android/v25-8/layouts/list-detail/list-detail-overview)
- [Design an Adaptive Layout with Material Design](https://developer.android.com/codelabs/adaptive-material-guidance)
- [Work with Related Lists on Records — Salesforce](https://help.salesforce.com/s/articleView?id=xcloud.basics_understanding_related_lists_lex.htm)
- [Considerations for Inline Editing in a List View — Salesforce](https://help.salesforce.com/s/articleView?id=xcloud.basics_customviews_lv_lex_considerations.htm)

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-01 | v1.2 | **#110 收尾:未儲存變更防護 + 響應式固化**。Fiori 逐字「If the user has made changes in edit mode, show a data loss message whenever the user **navigates away from the edit page or clicks Cancel**」—— 原本兩條路徑都沒擋,編輯到一半點別筆記錄整筆改動**靜默消失**(父層以 `key` 重掛 ObjectPage,子層自己擋不到 → dirty 上報由父層攔)。三條路徑:取消 / 切換記錄 / 關分頁(`beforeunload`);**改了又改回來不算 dirty**,否則使用者會被無謂的警告訓練成無視它。**已知缺口(不假裝有擋)**:App Router 的 client-side 換頁沒有受支援的導覽守衛。編輯狀態抽成 `use-record-edit`(object-page 535 → 519 行)。另補 v1.1 響應式**完全沒有測試**的破口:窄螢幕 list-detail 降級 + app shell 不得橫向捲 + 動作鈕收圖示後 aria-label 仍在。web e2e record-workbench 5 綠 | Claude Code |
| 2026-07-24 | v0.1 | 初版 DRAFT — 記錄工作台收斂(集合視圖 → Object Page);對照整合 mockup;現況 Object Page ~70% 已誠實建好,補 R1 缺口(集合視圖 / 狀態 / 金額 / 關聯 / user 名 / inline 編輯),R2/工作流不放;OQ-RWB-1..7 待裁定;2 唯讀後端端點 | Claude Code |
| 2026-07-24 | v0.2 | **納入 A0 app-shell 密度**(回應「頁面單薄」視覺反思):原 doc 只補 Object Page 深度,不含**入口(首頁)+ 外殼(status bar/nav)**——正是「薄」的第一印象。A0 加 全域 status bar + 首頁卡牆改工作面(塞真資料/縮寬)+ 導覽 rail。**OQ-RWB-6 由二選改三選、建議翻為 C(單域 rail + status bar,拿重量不造空 tab)**。§1/§2/§3/§3-bis/§9 同步;合計 0.22→0.26 mo;A0 排 M1(最便宜最有感先做)| Claude Code |
| 2026-07-24 | v0.3 | **OQ-RWB-1..7 全裁定(全採建議);DRAFT → APPROVED,進 M1**。1=B nested 路由 · 2=A 復用 Glide · 3=A 首 singleSelect 狀態 · 4=B 正+反向關聯 · 5=A inline 編輯 · **6=C 單域 rail+status bar** · 7=A users lookup。M1=A0 app-shell 密度先做(status bar + 首頁工作面)| Claude Code |
| 2026-07-28 | **v1.0** | **SHIPPED** — M1 後端(`/api/users/lookup` + `/records/:id/relations`;反向來源改由 `field_def.options->>targetFormId` 推導,不依賴 `relation_def` 之註冊時機)· M2 前端(狀態章 / 金額彙總 / 真實使用者名)· M3 前端(關聯 rail 正+反向 / inline 檢視↔編輯 / 清單列 enrich)· M4(`record-workbench.spec` 3 測 + FMEA 確認)。api 311 + web 45 + e2e 28 全綠。commit `03e3175`(後端)+ `fb2104a`(前端)。**殘留**:U3 狀態欄慣例之治本(OQ-3=B 設計器指定)/ E3 反向關聯單一 UNION 查詢 / 選項顏色設定 UI(field-types-parity P1)| Claude Code |
| 2026-07-28 | v0.5 | **範圍重整**(對照程式碼查證):A0 已由 workspace-ia、A1 已由 views-list 交付;OQ-RWB-1 nested 路由被 views-list OQ-VL-7 之 nuqs `mode/rid` 取代。剩餘 A2–A5 重排為 M1–M4,OQ 裁定沿用不重議;剩餘量 0.26 → 0.15 mo | Claude Code |
| 2026-07-24 | v0.4 | **依 docs/27 向上設計規格(OQ-UP 全裁定)調整**:(a) **A0 首頁方案改「分類目錄」**(docs/27 D3;取代「卡片塞資料」— 證據:Ragic 首頁=業務分類密集目錄,復用 form_categories;status bar / 單域 rail 不變);(b) **A1 集合視圖深度升級為 docs/27 §3 P0 全量**(+欄位選擇器 per-view / facet 篩選 rail / 儲存檢視三態 scope×locked×default / 分頁偏好),由 **views-list 模組**(docs/27 §6 順序 2)承接,本模組 A1 縮為其第一增量(Glide browse+開啟);(c) 模組順序併入 docs/27 §6:workspace-ia(=A0 擴版)先行 | Claude Code |
