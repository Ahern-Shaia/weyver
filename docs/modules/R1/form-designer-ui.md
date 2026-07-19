# form-designer-ui.md — [P0-1·UI] 表單設計器 + 填單 接引擎 API 設計文件

> ✅ **狀態:APPROVED — OQ-FDU-1..6 全採建議(2026-07-19 裁定),進 M1**
>
> 收掉 **Gate P0-1 的 UI 路徑**:「使用者可在 UI 上建一張採購單表單(含 header + line items + 欄位型別),自動生成 DB schema,可存資料」。後端路徑已由 `form-engine-core` v1.0 達成(live smoke:API 建表→DDL→存記錄);本模組把 S3 設計器與 S4 填單從 mockup 接上真 API —— **「自己建自己填」在瀏覽器裡真正跑起來**(docs/24 心智模型)。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-19)

---

## 1. 目標與範圍

### 1.1 目標

1. **使用者能在瀏覽器建表**:設計器(S3)組欄位 → 發布 → 引擎生成真實表(`POST /api/forms`),provisionState 可見。
2. **使用者能改既有表單**:加欄 / 白名單改型別 / 下架欄位(對應 M6 API),含子表結構。
3. **使用者能填單**(S4):由 metadata 動態渲染 15 型別輸入 → 送出存記錄 → 重新載入可見(含 autoNumber 回顯)。
4. **子表單據可填**:header + lines 於同一表單頁編輯,送出走 `save-with-lines`(單一交易)。
5. **走通即固化**:上述 golden path 以 Playwright MCP 走通後存成 spec 進 CI(AGENTS 前端測試鐵則)。

### 1.2 對應 Stakeholder 訴求

| 子題 | 主要訴求 | 次要訴求 | 對應點 |
|---|---|---|---|
| A1 API client 層 | ① Gate P0-1 UI 路徑 | — | 錯誤信封(code/correlationId)統一處理,409/422 對用戶可讀 |
| A2 表單清單入口 | ② docs/24 form-first | — | 入口是「我的表單」不是儀表板(反面教材迴避)|
| A3 設計器接 API | ①② | ③ 遷移場景 | 新建 + 改表雙模式;Ragic 用戶「自己建」核心體驗 |
| A4 填單動態渲染 | ②「自己填」 | — | metadata → 欄位元件 map;S4 文件式表單(docs/14 §3.2)|
| A5 子表 header+lines | ① Gate 明文含 line items | ERP 骨架 | SubTable 元件(packages/ui 已有)接 save-with-lines |
| A6 測試固化 | ③ AGENTS 前端鐵則 | — | MCP 探索 → Playwright spec 進 CI |

### 1.3 不做的事

- ❌ **不接 grid 視圖 / 列表視圖 / Excel 匯入**(P0-2 sprint;mockup 保留)
- ❌ **不做公式 / Link&Load / 視圖切換持久化**(P0-3;formula/link 型別在 palette 隱藏或停用)
- ❌ **不做三層權限 UI / 通知**(P0-4)
- ❌ **不做拖拉排序(dnd-kit)**(P1-I 打磨;MVP 以上移 / 下移按鈕,見 OQ-FDU-4)
- ❌ **不做 i18n(next-intl 接線)**(zh-TW 硬編,P1-I;套件已裝不動)
- ❌ **不改視覺設計**(docs/14 v2.1 + `/app` mockup 已定案;本模組是接線不是重設計)
- ❌ **不做 auth**(沿用 DevTenantGuard;F-2 換 JWT 時只改 API client 一處 header)

---

## 2. 上游 / 既有現況走查

| 子題 | 上游現況 | Gap |
|---|---|---|
| 後端 API | ✅ M6 REST 全齊(forms/fields/records/query/save-with-lines + 錯誤信封)| **缺欄位改序 API**(position 僅建表時定;見 OQ-FDU-3)|
| 前端 stack | ✅ TanStack Query / RHF / Zod / zustand / nuqs 皆已裝(v2.1 批次)| tRPC 已裝未用(見 OQ-FDU-1)|
| 視覺 / 元件 | ✅ `/app` 四視圖 mockup + packages/ui v2.1(FormSection/FieldGrid/SubTable/Toolbar/StatusChip…)| mockup 為 static 資料,無 API 接線 |
| 跨源 | — | web(:3000)↔ api(:3001)跨源:**Next rewrites 代理**(`/api/engine/* → :3001/api/*`),同源免 CORS(prod 由 reverse proxy 同源)|
| 型別驗證 | ✅ 後端 registry valueSchema 權威 | 前端需基本 client 驗證(見 OQ-FDU-5)|

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 估算(solo + Claude Code)|
|---|---|---|
| **A1 API client 層** | typed fetch wrapper(錯誤信封 → DomainApiError)+ TanStack Query hooks(useForms/useForm/useRecords/mutations)+ dev tenant 設定(localStorage,預設 1)+ Next rewrites 代理 | ~3 天 |
| **A2 表單清單入口** | `/app` 加表單選擇(清單 + 新建);nuqs 存 formId 於 URL | ~2 天 |
| **A3 設計器接 API** | 新建模式(local draft → 發布)+ 編輯模式(addField / 白名單改型別(前端只列合法目標)/ dropField / 上下移)+ provisionState / 版本顯示 + 15 型別 palette(含 options 編輯:choices / prefix / currency)| ~1 週 |
| **A4 填單動態渲染** | metadata → 欄位元件 map(15 型別)+ RHF 表單 + 送出 createRecord + 已存記錄檢視(getRecord;autoNumber / 系統欄回顯)| ~1 週 |
| **A5 子表** | 設計器建子表結構(child form)+ 填單頁 lines 編輯(SubTable)+ save-with-lines 送出 + 樂觀鎖 409 處理(重載提示)| ~4 天 |
| **A6 測試** | Vitest 快層(client 驗證 / 錯誤映射)+ **Playwright spec 固化 golden path**(建表→加欄→填單→存→重載)| ~3 天 |
| (後端小補)| 欄位改序 API(若 OQ-FDU-3 = B):`PATCH /fields/:id/position`,metadata-only 無 DDL | ~半天 |

**合計** ≈ **3.5–4 週純 focus**(calendar 依 docs/07 月段稀釋)。

---

## 4. 關鍵設計

### 4.1 A1|API client 層

- `apps/web/src/lib/engine-api.ts`:fetch wrapper —— base `/api/engine`(Next rewrites → :3001);header 帶 `x-dev-tenant`(localStorage `weyver.devTenant`,預設 `1`;F-2 後此處換 JWT,單點改)。
- 回應非 2xx → parse 錯誤信封 → `DomainApiError { code, message, correlationId, status }`;UI 依 code 顯示(409 版本衝突 → 「資料已被修改,請重新載入」;422 → 欄位訊息)。
- TanStack Query:`useForms()` / `useForm(id)` / `useRecords(formId, query)` + mutations(createForm / addField / alterFieldType / dropField / createRecord / updateRecord / saveWithLines);mutation 成功 invalidate 對應 query。
- **Zod 解析 API 回應**(FormDto / RecordRow schema)—— 邊界驗證雙向(AGENTS)。

### 4.2 A3|設計器雙模式

- **新建模式**:mockup 現有 local state 保留(palette 點擊加欄 / 屬性面板 / 上下移)→ 「發布」一次送 `CreateFormSpec`;成功後轉編輯模式。發布前零 API 呼叫(草稿不落地,離開即棄 —— 簡單可預期)。
- **編輯模式**(form ready):加欄=`POST fields`;改型別=前端**只列白名單合法目標**(鏡射 `type-conversions` 表,非法選項直接不出現);刪欄=確認後 `DELETE`(soft);上下移=OQ-FDU-3。
- 狀態顯示:provisionState 章(ready/pending/failed)+ 表單 version(信任訊號,docs/14 §3.6)。
- palette 15 型別 = 後端 registry 子集;`formula` / `link` / `attachment` / `member` 標「即將推出」停用(stub 型別不可建,避免填單時 z.never 死路)—— **可建型別 = 11**。

### 4.3 A4|填單動態渲染(S4)

- `field-input.tsx`:cellValueType → 輸入元件 map(text/longText/email/url/phone → Input·Textarea;number/percent → 數字;money → 金額字串輸入(前端禁 float,顯示千分位);date/dateTime → 原生 date/datetime-local(MVP);single/multiSelect → Segmented/多選;checkbox/rating;autoNumber → 唯讀「儲存後產生」)。
- RHF + 前端基本驗證(required + 型別粗驗);**後端 422 為權威**,信封訊息映射回欄位。
- 版面照 docs/14 §3.2 文件式(FormSection + FieldGrid,mockup 樣式沿用);系統資訊區顯示 建立/更新/version(信任訊號)。

### 4.4 A5|子表

- 設計器:「加子表」→ 以 `parentFormId` 建 child form(名稱 + 欄位);填單頁下方 SubTable 區塊編輯 lines(加行 / 改行 / 刪行,前端 state)→ 送出 `save-with-lines`。
- 409(header 版本)→ 提示重載;lines 以 header 為鎖(form-engine-core FMEA R3 已知設計)。

---

## 7-bis. cross-cutting(節錄)

- **安全**:tenant header 僅 dev(F-2 換 JWT);API 回應 Zod 解析防 shape drift;無 secrets 進前端;錯誤只顯示信封 message(無 stack)。
- **失效**:API 掛 → Query error state(docs/14 §3.13 錯誤含復原);409/422 各有 UX 路徑;pending 表單顯示「建置中」不可填。
- **效能**:metadata query staleTime 適度(表單定義變動低頻);記錄列表沿用 cursor 分頁(本模組僅最小檢視)。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Vitest + Testing Library | field-input 15 型別渲染 / client 驗證 / 錯誤信封映射 / 白名單改型別選項 | `apps/web/**/*.test.tsx` |
| **Playwright spec(固化,進 CI)** | golden path:建「採購單」(3+ 欄含 autoNumber/money)→ 發布 ready → 加欄 → 填單存檔 → 重載記錄可見 → 子表 header+lines | `apps/web/e2e/` 對 dev api(真 PG)|
| Playwright MCP(探索,不進 CI)| 開發期驗證迴圈(AGENTS P0:瀏覽器實際用過才算完成)| 開發期 |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 預估 | 狀態 |
|---|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-FDU-1..6)| — | ⏳ |
| **M1** A1 | API client + hooks + 代理 + dev tenant + Vitest | ~3 天 | ✅ 2026-07-19(7 tests + 代理 live smoke)|
| **M2** A2+A3 | 表單清單 + 設計器雙模式(+ 後端 position API 若採 B)| ~1.5 週 | ⏳ |
| **M3** A4 | 填單動態渲染 + 記錄檢視 | ~1 週 | ⏳ |
| **M4** A5 | 子表建立 + lines 填單 | ~4 天 | ⏳ |
| **M5** A6 + 收尾 | Playwright spec 固化 + FMEA + SHIPPED(**= Gate P0-1 全數達成**)| ~3 天 | ⏳ |

---

## 10. 開放問題(OQ-FDU-N)— ✅ 已裁定(2026-07-19,全採建議)

| # | 議題 | 裁定 | 落地影響 |
|---|---|---|---|
| **OQ-FDU-1** | API 傳輸層 | **A REST + TanStack Query** | engine client 直用 M6 REST;tRPC 已裝不接,P0-5 統一評估 |
| **OQ-FDU-2** | 編輯模式範圍 | **A 新建 + 改既有表** | A3 雙模式全做(addField / 白名單改型別 / dropField)|
| **OQ-FDU-3** | 欄位改序 | **B 補後端 position API** | M2 內補 `PATCH /api/forms/:formId/fields/:fieldId/position`(metadata-only)+ 編輯模式上下移 |
| **OQ-FDU-4** | 排序互動 | **A 上移 / 下移按鈕** | dnd-kit 拖拉列 P1-I 打磨 backlog |
| **OQ-FDU-5** | 前端驗證深度 | **A 基本層 + 422 權威映射** | field-input 帶 required / 型別粗驗 / money 禁 float;信封訊息映射回欄位 |
| **OQ-FDU-6** | mockup 視圖 | **A 保留標「示意」** | list/grid 視圖加「示意資料(P0-2 接線)」標記 |

---

## 11. SOP / 12. FMEA

> M5 收尾時填(照 form-engine-core 模式)。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v0.1 | 初版 DRAFT — A1–A6 切分 + OQ-FDU-1..6;上游 = form-engine-core v1.0 API + `/app` mockup + docs/14 v2.1 / docs/24 | Claude Code |
| 2026-07-19 | v0.2 | OQ-FDU-1..6 全採建議裁定;狀態 DRAFT → APPROVED;進 M1 | Claude Code |
