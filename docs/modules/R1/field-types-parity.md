# field-types-parity.md — [R1·UP-4] 欄位型別 parity（form-engine-core 增量）設計文件

> 🟡 **狀態：v1.1（2026-08-04 更正）** —— M1–M5 出貨,但 §1.1 列為 P0 的兩項**只有 schema**:
> **格式遮罩 `displayMask` 已於 2026-08-04 補上渲染 + 設計器入口**;
> ✅ **連動選項已於 2026-08-04 三面補齊**:設計器「連動於」+ 逐選項父值 · 填單依父欄收窄 ·
> **伺服器硬驗**(判斷抽進 `@weyver/rules` 與前端共用)。
> 🔴 落地時抓到 v1 正規化的一個錯:`optionParents` 轉 `parents` 時用的是**子欄自己的**
> 名稱→id 對照表去查父選項名,查不到就原樣留下 —— 舊資料存的是父選項**名稱**不是 id,
> 而 registry 的註解說它會轉成 id。判斷改成兩者都吃。
> **裁定摘要**｜1=A 讀時 systemManaged pseudo-field · 2=A 系統欄投影 audit · 3=A options 加法擴充 · 4=A link 補完(含 link&load,級聯 P1) · 5=A counter table 統一 · 6=A image/signature 依 file-storage 排除 P0 · 7=A 採 §1.1 八項為 P0。
> **落地**｜M0 `2b28960` · M1 後端 `0972cf7`(系統欄/lookup/rollup 讀時型別)· M2 後端 `d98ffa4`(autoNumber pattern/選項顏色連動/link displayFields)· M3 `7d212f0`+`e469aa1`(barcode/mask + 前端 enum/渲染)· M4 `ad8c9e7`(設計器進階型別設定)· M5 `58e6f1d`(field-types.spec)。
>
> docs/27 §6 順序 4（承 form-designer-2d SHIPPED）。落地 §2「欄位型別全譜」之 **P0 共識型 + Ragic 遷移必備**：**系統欄 4 型 / lookup / rollup / link 補完 / autoNumber pattern / 選項顏色 + 連動選項 / 條碼生成 / 格式遮罩**。form-engine-core 的 field-type registry 是「新型別 = 加一 registry entry」的擴充式設計（OQ-FEC-3），且多數 P0 型別可**複用既有基礎設施**（見 §2 現況）。
>
> **核心洞見（現況盤點）**：**RollupService 已完整**（SUM/COUNT/AVG/MIN/MAX、`rollupBatch` N+1 safe、讀時算）—— 只差「接成 field type」；**link 部分建好**（`RelationService.load/registerRelation` + `relation_def`）—— 差啟用/驗證/顯示；**formula 讀時注入（`withFormulas`）是 lookup/rollup/系統欄的現成範本**；**系統 audit 欄已在每張動態表**（created/updated by/at）—— 系統欄 = pseudo-field 投影,零新儲存。故本模組雖為 8 人月軸,P0 可控。
>
> 作者：Claude Code（草擬）
> 版本：v0.1（2026-07-25）
> 證據：docs/27 §2（P0/P1/P2 分級 + 四路研究引用 doc/20·25·27·51、AT、TB）、現況盤點（field-type-registry 擴充式 / RollupService 完整 / RelationService partial / formula withFormulas 讀時注入 / audit 欄投影 / choicesSchema strict / autoNumber 全域 per-field sequence）

---

## 1. 目標與範圍

### 1.1 目標（P0）

1. **系統欄 4 型**（`createdAt/createdBy/updatedAt/updatedBy`）｜pseudo-field 投影既有 audit 欄（no-op buildColumn、`systemManaged` 唯讀）;讀時將 RecordRow 信封之 audit 值注入 `values`。零新儲存（§2 P0）。
2. **rollup 欄型別**｜複用既建 `RollupService`（SUM/COUNT/AVG/MIN/MAX + 條件 + `rollupBatch` N+1 safe）接讀時注入（formula 模式）;metadata `{childFormId?, fn, targetFieldId, condition?}`。
3. **lookup 欄型別**｜複用 `RelationService.lookup`(即時拉關聯記錄單一欄現值)接讀時注入;metadata `{linkFieldId, targetFieldId}`。
4. **link 補完**（現 stub → 啟用）｜移出 STUB、targetFormId 驗屬本租戶且 ready、**顯示標籤**(選 target 欄呈現)、**link&load**(選取時複製指定欄快照,`RelationService.load` 已具)、被引用反查(reverse)。
5. **autoNumber pattern**｜token 文法 `{prefix}{date:fmt}{seq:width}` + **reset scope**(無/日/月/年/群組欄)via **counter table**(取代/補全全域 sequence)。
6. **選項顏色 + 連動選項**｜options **加法擴充**(colors map + parent 連動),向後相容(valueSchema 仍 enum choices)。
7. **條碼生成欄 + 格式遮罩**｜barcode = 顯示型別(值→QR/Code128,前端 OSS lib 渲染,零 DB);編號/文字格式遮罩 = text + `displayMask`(前端顯示格式化,儲存原值)。

### 1.2 對應訴求

| 子題 | 訴求 | 對應 |
|---|---|---|
| 欄位型別 parity | Ragic 客戶遷移「統計欄/連結/系統欄/連動選項/編號格式」既有依賴 | docs/27 §2 P0;docs/25 B「欄位型別系統」8 人月 |

### 1.3 不做的事

- ✅ **【2026-07-28 全數完成】**|attachment 由 [F-5 file-storage](../foundation/file-storage.md) v1.0 解鎖;**image / signature 兩欄型由 [R1·UP-4b image-signature-fields](image-signature-fields.md) v1.0 交付**(獨立欄型 + 影像 MIME 收斂 + 縮圖 + canvas 簽名板)。OQ-FTP-6 之阻塞與後續皆已結案。
(上傳端點 + 物件儲存抽象,OSS MinIO/local + 病毒掃描 + 大小/數量限制)—— 列為 **file-storage 依賴**(OQ-FTP-6:自成 P1 子件,本模組 P0 不含)。barcode(渲染)/mask(顯示)不需儲存 → 入 P0。
- ❌ **member 補完**(需 user 解析 UI + users grant)｜P1。
- ❌ **rich text / Markdown 欄、address(Google Maps+GPS)、循環日期、匯率(外部 API + circuit breaker)、民國年等日期格式、文字遮罩前後 N 碼**｜§2 P1。
- ❌ **Duration / Button / AI 欄 / 行動掃碼輸入 / 傳閱·選擇群組·打卡 / 付款(綠界)**｜§2 P2 / R2。
- ❌ **條件式格式**｜隨 form-designer-2d P1 / actions-approval。
- ❌ **動作條碼**(掃碼觸發動作)｜隨 actions-approval。

---

## 2. 上游 / 既有現況走查（GAP SUMMARY）

| P0 目標 | 現況 | Gap |
|---|---|---|
| **系統欄 4 型** | audit 欄 created/updated by/at 已在每張動態表 + RecordRow 信封(top-level,非 values) | **NET-NEW**:註冊 4 pseudo-type(no-op buildColumn、systemManaged);`toRecord` 將 audit 值填入 `values[fieldName]` |
| **rollup** | ✅ `RollupService` 完整(5 fn + 條件 + `rollupBatch` N+1 + 讀時,已測) | **PARTIAL**:接成 field type + metadata + 讀時注入(如 withFormulas);child 關係走既有 subtable parent_id / relation |
| **lookup** | `RelationService.lookup()`(拉關聯單欄現值)存在,formula 引擎已用 | **PARTIAL→NET-NEW**:field-type 包裝 + 讀時注入 |
| **link 補完** | `relation_def` 表 + `RelationService.load/registerRelation`;registry link entry(bigint + targetFormId);仍在 STUB_TYPES | **PARTIAL**:啟用建立 + targetFormId 驗證 + 顯示標籤 + link&load 帶欄 + reverse-query |
| **autoNumber pattern** | 全域 per-field PG sequence(`s{fieldId}`);options `{prefix,width}` | **PARTIAL**:token 文法 parser + date 元件 + reset(counter table 依 reset_key) |
| **選項顏色** | `choicesSchema = {choices: string[]}` `.strict()`;valueSchema `z.enum(choices)` | **NET-NEW**:options 加 `colors`(加法,不破 valueSchema) |
| **連動選項** | 無 | **NET-NEW**:options 加 `parentField` + `optionParents`;連動過濾(UI + 後端可選硬驗) |
| **條碼 / 遮罩** | 無 | **NET-NEW**:barcode 顯示型別(前端 OSS lib,零 DB);mask = text + displayMask(前端顯示) |

**registry 擴充式確認**：新型別 = 7 屬性 registry entry(cellValueType/dbFieldType/optionsSchema/buildColumn/valueSchema/filterOperators/systemManaged);no-op buildColumn 可行(系統欄/lookup/rollup 走 formula 讀時算範本);不需動 DDL/DML 服務主體(OQ-FEC-3)。

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端(讀時計算型別)** | 系統欄 4 型(投影 audit)+ rollup 欄型別(接 RollupService)+ lookup 欄型別(接 RelationService)+ 讀時注入 orchestrator(承 withFormulas;順序 系統→lookup→rollup→formula)+ metadata(field_def.options 存 def)+ integration 測(N+1 / 讀時正確 / 跨租戶)| 0.12 mo |
| **M2 後端(結構型別 + 編號 + 選項)** | link 補完(啟用/驗證/顯示標籤/link&load/reverse)+ autoNumber pattern(counter table migration + token parser + reset)+ 選項 colors/連動 options 加法擴充 + 測 | 0.12 mo |
| **M3 前端(渲染)** | palette 開放新型別 + field-input 渲染(系統欄/rollup/lookup 唯讀、link 選取器 + 顯示標籤、選項顏色 chip、連動過濾、barcode 渲染、mask 顯示)| 0.10 mo |
| **M4 前端(設計器設定)** | 設計器 field 設定接新型別 options(rollup fn/target、lookup target、link target + 顯示欄、選項顏色、連動 parent、autoNumber pattern + reset)| 0.08 mo |
| **M5 固化 + FMEA** | Playwright + integration 固化;§12;doc v1.0 + MODULES ✅ | 0.03 mo |

**合計 ≈ 0.45 mo**（對應 docs/25 B 欄位型別 8 人月之 P0 首期;image/signature/member/rich-text 等 P1 另計）。M1/M2 後端 / M3–M5 前端**分開 commit**。

---

## 4. 設計要點

### 4.1 讀時計算型別(系統欄 / lookup / rollup)— M1(OQ-FTP-1=A、OQ-FTP-2=A)
- **範本 = formula `withFormulas`**：RecordService 讀取路徑(get/list)已有讀時注入 hook;新增 `withComputed`(或分 withSystemFields/withLookups/withRollups)在 `withFormulas` 之前/後注入 `values`。
- **系統欄**：4 pseudo-type,no-op buildColumn,`systemManaged`;`toRecord` 已有 audit 值於信封 → 讀時填 `values[fieldName]`(createdAt→ISO 日期時間字串 等)。
- **rollup**：metadata（field_def.options）`{ fn, childFormId?, targetFieldName, condition? }`;呼 `RollupService.rollupBatch`（N+1 safe;child 以 subtable parent_id 分組）注入。
- **lookup**：metadata `{ linkFieldName, targetFieldName }`;呼 `RelationService.load`（依 link 欄值拉 target 記錄之欄）注入。
- **計算順序**：系統欄 → lookup → rollup → formula（formula 可引用 lookup/rollup 結果 → 納入 formula resolve 或先算後傳）。全 `systemManaged`（值不儲存、拒寫）。

### 4.2 link 補完 — M2(OQ-FTP-4=A)
- 移出前端 STUB_TYPES;建立時驗 `targetFormId` 屬本租戶且 `provisionState=ready`;`registerRelation`（已有）。
- **顯示標籤**：options `{ targetFormId, displayFields: [targetFieldName] }`；記錄頁/清單以 target 之 displayFields 呈現（`RelationService.load`）。
- **link&load**：選取 target 時複製指定欄快照入本表對應欄（Ragic 語意;`load` 已具）。
- **reverse-query**：查 `relation_def` + target 記錄之反向引用（「被誰連結」）;P0 顯示計數/清單，深層 P1。

### 4.3 autoNumber pattern — M2(OQ-FTP-5=A)
- **counter table** `autonumber_counter(field_id, reset_key, value, PK(field_id,reset_key))`;`reset_key` 依 reset scope 計算（無=`''`;日/月/年=格式化日期;群組=群組欄值）。
- **token 文法** `{prefix}{date:yyyyMM}{seq:5}`：parser → 組字串;seq 取自 counter（tx 內 `INSERT ... ON CONFLICT DO UPDATE SET value=value+1 RETURNING value`，row lock 保序）。
- 無 reset 之既有 autoNumber 相容（reset_key=`''`，等價全域）;移轉既有 PG sequence 之現值入 counter（或保留 sequence 給無-reset、counter 給有-reset — OQ-FTP-5）。

### 4.4 選項顏色 + 連動選項 — M2(OQ-FTP-3=A 加法)
- options 加法：`{ choices: string[], colors?: Record<choice, colorToken>, parentField?: string, optionParents?: Record<choice, string[]> }`。
- **valueSchema 不變**（仍 `z.enum(choices)`）→ 既有表零遷移。
- **連動**：前端依 `parentField` 當前值 + `optionParents` 過濾可選項;後端寫入仍驗 enum（連動為 UI 導引;硬驗 parent-child 一致列 P1）。
- 顏色為語意 token（非 raw hex，對齊 docs/14）。

### 4.5 條碼 + 遮罩 — M3(OQ-FTP-6=A P0 之零儲存件)
- **barcode**：cellValueType `barcode`,dbFieldType text,存原值;前端以 OSS lib(如 `bwip-js`/`qrcode` MIT)渲染 QR/Code128;filterOperators TEXTUAL。
- **mask**：text 之 options `{ displayMask }`（如 `###-##-####`）;前端顯示格式化、儲存原值;valueSchema 仍 text（regex 驗證列 P1）。

---

## 7. 資料模型變動

### 7.2 SQL Migration
- **`0011_field_types.sql`**：`autonumber_counter` 表（field_id/reset_key/value）;RLS FORCE + tenant scope（或 field_id 綁租戶）。lookup/rollup/link/選項擴充 def **存 `field_def.options` JSONB（加法,免新表）**;系統欄/barcode/mask **無 schema 變更**（投影 / text 復用）。
- **down**：`DROP TABLE autonumber_counter`;options 加法欄位讀時忽略未知鍵（向後相容）。

### 7.3 RLS / Permission
- 讀時計算型別不改權限：`maskRead` 欄位級遮罩仍為硬底（rollup/lookup/系統欄之注入值同受欄位權限）;lookup 拉 target 欄 → **需驗操作者對 target 表/欄有讀權**（BOLA,§7-bis）。
- autoNumber_counter 走 app 車道 + tenant scope。

---

## 7-bis. 安全（擇要；完整見 [[rule_security_standards]] + docs/22）

| 面 | 緩解 |
|---|---|
| lookup 越權讀 target 表/欄（BOLA）| lookup 注入前驗操作者對 target form/field 讀權（`maskRead`/permission）;無權 → 不注入（或注入遮罩）|
| rollup 洩他租戶子表 | rollupBatch 走 tenant-scoped（承 RecordService inTenantTx）;child 綁 parent_id + tenant |
| barcode/mask 值注入 | barcode 前端渲染 OSS lib（值當資料非程式碼）;mask 為顯示格式（非執行）;值仍走 text valueSchema |
| autoNumber counter 競態 / 重號 | `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`（row lock,tx 內）保序;idempotency 承 records（[[rule_coding_standards]]）|
| 連動選項繞過 | 後端寫入仍驗 `z.enum(choices)`（連動 UI 導引非唯一防線）;硬驗 parent-child P1 |
| 選項顏色/options 膨脹 | colors/optionParents Zod 上限;choices ≤200(既有)|

Input validation：新 options（colors/parent/lookup/rollup/link/autoNumber pattern）全 Zod + `z.infer`;pattern token 白名單 parser（非任意 eval）。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Integration（api）| 系統欄注入 values;rollup 欄讀時算(承 rollup.integration)+ N+1;lookup 讀時算 + 越權不注入;link 建立驗證 + link&load + reverse;autoNumber pattern(date + reset + 群組 + 並發不重號);選項顏色/連動 options round-trip | `apps/api/test/*.test.ts`（Testcontainers）|
| e2e（Playwright）| 建 rollup/lookup/link/barcode 欄 → 填單 → 檢視(唯讀計算值/link 顯示標籤/barcode 渲染/選項顏色 chip/連動過濾)；autoNumber pattern 設定 | `apps/web/e2e/field-types.spec.ts` |
| Unit | autoNumber token parser / reset_key 計算 / 計算順序拓樸 | `*.test.ts` |
| 回歸 | builder/formula/rollup/relation 既有測不破 | 既有 |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** | 本檔 → APPROVED（OQ-FTP-1..7 裁定,全採建議）| ✅ |
| **M1** | 後端：系統欄 + rollup + lookup 讀時型別（`0972cf7`）| ✅ |
| **M2** | 後端：link displayFields + autoNumber pattern + 選項顏色/連動（`d98ffa4`）| ✅ |
| **M3** | barcode/mask 後端 + 前端 enum 同步/渲染（`7d212f0`+`e469aa1`）| ✅ |
| **M4** | 前端：設計器進階型別 options 設定（`ad8c9e7`）| ✅ |
| **M5** | field-types.spec 固化 + FMEA + doc v1.0 + MODULES ✅（`58e6f1d`）| ✅ |

---

## 10. 開放問題（OQ-FTP-N）— ✅ 已裁定 2026-07-25（全採建議 = 全 A）

> 全數採「建議」欄。進入 M1。

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-FTP-1** | lookup/rollup/系統欄實作模式 | A. **讀時計算 systemManaged pseudo-field**（承 formula `withFormulas` 注入）<br>B. 寫入時物化欄（materialize on write）| **A** — formula 為既有範本;RollupService 本即讀時、無物化 staleness;child 刪即反映（rollup.integration 已測）。**證據**：formula withFormulas + RollupService 讀時設計 |
| **OQ-FTP-2** | 系統欄 4 型儲存 | A. **pseudo-field 投影既有 audit 欄**（no-op buildColumn,讀時填 values）<br>B. 新增實體欄 | **A** — audit 欄已在每表 + RecordRow 信封;零新儲存（§2 P0「引擎既有 audit 欄投影」）|
| **OQ-FTP-3** | 選項顏色 + 連動 options 形狀 | A. **加法擴充**（choices 仍 string[] + 平行 colors/parentField/optionParents,valueSchema 不變）<br>B. choices 改 `[{value,color,parentOptionId}]`（破 valueSchema + 既有表遷移）| **A** — 向後相容、零既有表遷移、不動 valueSchema enum;連動為 UI 導引 + 後端可選硬驗。**證據**：choicesSchema strict + valueSchema z.enum(choices) 之現況約束 |
| **OQ-FTP-4** | link 補完範圍 | A. **P0 = 啟用 + targetFormId 驗證 + 顯示標籤 + link&load 帶欄 + reverse 計數/清單**;深層反查/級聯刪除策略 P1<br>B. 全含級聯 | **A** — 覆蓋 Ragic 遷移核心（連結 + link&load）;級聯刪除策略需資料生命週期裁定 → P1。**證據**：RelationService.load 已具 link&load |
| **OQ-FTP-5** | autoNumber pattern reset 機制 | A. **counter table**（field_id×reset_key）統一（無 reset = reset_key `''`;有 reset 依日期/群組）<br>B. 保留 PG sequence 給無-reset、counter 給有-reset（雙軌）| **A** — 單一模型（易理解 + 支援 reset/群組）;`INSERT..ON CONFLICT..RETURNING` 保序;既有 sequence 現值移轉入 counter。**證據**：Ragic 依參照欄各自跳號 + 序號重設（doc/25）|
| **OQ-FTP-6** | image/signature + 檔案儲存 | A. **P0 排除**（image/signature/attachment 上傳依賴 file-storage 基礎設施 → 自成 P1 子件;OSS MinIO/local + 上傳端點 + 掃描）;P0 只含**零儲存**之 barcode(渲染)+ mask(顯示)<br>B. 本模組建最小 file-storage | **A** — 檔案儲存為獨立基礎設施（影響 attachment/image/signature 共同）;強塞入本模組膨脹且分心。barcode/mask 零 infra → 留 P0。**證據**：attachment 現亦缺儲存服務（gap 盤點）|
| **OQ-FTP-7** | P0 範圍確認 | A. **採本檔 §1.1 八項為 P0**（系統欄/rollup/lookup/link 補完/autoNumber pattern/選項顏色+連動/barcode/mask）;image·signature·member·rich text·address·循環日期·匯率·民國年 → P1;Duration·Button·AI·掃碼·付款 → P2/R2<br>B. 縮小 P0（如 autoNumber pattern 或 連動 延後）| **A** — 對齊 docs/27 §2 P0 之可無 file-storage 落地子集;維持四模組時程 band。若時程吃緊,連動選項 / reverse-query 為首選延後件 |

---

## 12. 失效場景反思（FMEA）— M5 收尾（R17）；✅=已驗證緩解

| # | 場景 | 緩解 | Sev | 狀態 |
|---|---|---|---|---|
| T1 | lookup 越權讀 target 表/欄（BOLA）| lookup 拉 raw target 值走 `getRecordsByIds`(tenant-scoped);記錄頁 maskRead 欄位級遮罩仍為硬底 | P0 | ⚠️ 已知殘留:lookup 注入未再套 target 表**欄位級**權限(僅 tenant scope)→ 若 target 欄對操作者 hidden 仍可能經 lookup 見值。治本 = 注入前查 target FieldAccessPolicy(P1);現 pilot 單租戶低風險 |
| T2 | rollup / lookup 洩他租戶資料 | `getRecordsByIds`/`listByParents` 走 inTenantTx(set_config tenant + RLS);child 綁 parent_id + tenant | P0 | ✅ computed-fields 測(同租戶);承 records tenant 隔離 |
| T3 | autoNumber 並發重號 | counter `INSERT..ON CONFLICT DO UPDATE..RETURNING`(row lock,record tx 內)保序 | P0 | ✅ field-types-m2 測(月/群組序列遞增);ON CONFLICT 原子性 |
| T4 | 系統欄/計算欄被寫入 | virtual + systemManaged + valueSchema z.never() 拒寫 | P0 | ✅ computed-fields「systemManaged 拒寫」測 |
| T5 | 讀時計算 N+1 | rollup `listByParents`(單查詢分組);lookup 批次 whereIn(`getRecordsByIds` 去重 id);metadata 快取 P1 | P1 | ✅ 批次已實作 |
| T6 | 計算順序循環（formula↔rollup↔lookup）| withComputed(系統→lookup→rollup)在 withFormulas 前;lookup 取 raw target(不巢狀計算)避遞迴 | P1 | ✅ 順序固定 + raw target;跨型別環偵測留 P1 |
| T7 | 選項顏色/連動 / mask options 破既有表 | 加法擴充、valueSchema 不變(仍 enum choices / text)、讀時忽略未知鍵 | P1 | ✅ field-types-m2 round-trip + records/metadata/api.e2e 35 測不破 |
| T8 | link targetFormId 指向已刪/他租戶表 | targetFormId 由 metadata.getForm(tenant) tenant-scoped 解析 → 他租戶/不存在回 null(graceful) | P1 | ✅ tenant-scoped resolve;建立時 ready 驗證留 P1 |
| T9 | barcode/mask 值當程式碼執行 | barcode 前端 OSS lib 渲染(值為資料);mask 顯示格式(非執行);值走 text valueSchema | P1 | ✅ by design(barcode QR 渲染 UI 待補,現存 text 值) |
| T10 | 部署順序:前端先於 0011 migration | migration 必先(R10;dev 已 migrate);缺 counter → autoNumber 降級無 reset | P1 | ✅ |

> **檢查點**:P0(T1–T4)緩解到位。⚠️ T1 已知殘留(lookup 未套 target 欄位級權限)+ 前端 barcode QR 渲染/選項顏色 chip 顯示/連動過濾/link 選取器顯示標籤/lookup·rollup·系統欄的記錄頁友善顯示 為 M3 之顯示層 P1 增補;image·signature·member·rich text·address·民國年·reverse-query·級聯刪除 為 §2 P1;連動硬驗 P1。

---

---

## 0-bis. 追溯稽核(2026-07-28)— **本模組原無證據段,事後補**

> 當初實作 28 種型別時只確認「有沒有這個型別」,**未對照任何競品的行為細節**。
> 以下依**毀資料風險**排序。已立 [task #105]。
> **可逐條對照的機器級文件**:**Airtable Web API「Field model」**(34 型別 × cell value
> 讀寫格式 / null 表示 / webhook 差異)—— 業界唯一可當 checklist 的行為規格。
> Ragic 只有設計手冊 + KB 問答,行為散落需反推;**兩家皆無正式行為規格文件**。

### 🔴 三項毀資料風險

**1|select 選項「值即名稱」+ 刪除即清空**
Airtable multiSelect 存 **array of strings**(值即字串非 id)→ **改名 = 既有值全變**;
刪除選項則**直接清空既有記錄該格**(社群一致,官方文件未載),官方 FAQ 只給「先複製到另一欄」的 workaround。
本專案 `choicesSchema = {choices: string[]}` 是同一形狀。
→ **這裡應該贏 Airtable**:選項存 **stable option id**(顯示名另存)使改名零風險;
刪除改 **soft-retire**(標 archived、新記錄不可選、既有值保留為灰底孤兒值),刪除對話框顯示「N 筆記錄使用中」。
**是遷移期就該修的結構債。**

**2|lookup 的 live vs snapshot 未顯式化 —— ERP 的經典分歧**
- **Ragic 官方說得最透**:**連結與載入 = 快照**(預設不同步)。[官方中文文件](https://www.ragic.com/intl/zh-TW/doc/14/3)逐字:
  「如果 A 表單上有欄位的值是從 B 表單連結載入的資料,B 表單上資料做修改**並不會反映在 A 表單先前存的資料中**。」
  舉例逐字:「假設王先生後來搬家了…**但先前既有的訂單上確實還是要顯示當初的地址**而非後來搬家的新地址。」
  ⚠️ **更正**(2026-07-29 二輪查證)|本節原引「不必讓本月商品的變動內容影響去年的舊訂單」並標為「理由原文」——
  中英文官方文件四路搜尋**皆查無此句**,官方用的是上述「客戶搬家」例。語意等價但非原文,已替換為可驗證的逐字引用。
- **Airtable 官方**:lookup = **即時**(「always be up-to-date in all tables」)
- ⚠️ Ragic 另有官方文件專門教「不小心觸發同步/重算導致手動值遺失,**如何從備份找回**」—— 業界已知事故

→ **兩者都要,升為欄位層顯式設定**:`lookup(live)` 供主檔參照(客戶電話),
`snapshot`(link&load)供單據凍結(訂單上的地址 / 單價),**ERP 單據預設 snapshot**。
重算時機維持「讀時算」(N+1 已由 rollupBatch 處理),但 **snapshot 欄必須寫時定值**。

**3|型別轉換缺 lossy 層**
- **Airtable 官方**:「works to convert…some conversions may not be possible—like text→attachment **clears the text values**」——**盡力轉、轉不動直接清空,無預覽無警告**
- **Salesforce 官方(企業級對照)**:「**To avoid losing data, only convert custom fields that have no data**」;明列 →Number 一律 lossy;**picklist→multi-picklist 保留值但不在定義內的值會被刪**
- **無公認相容矩陣**(查無),各家自訂

本專案 `type-conversions.ts` 只允許 5 條「物理不變 + 語意放寬」,其餘拒絕 ——
**方向正確**(比 Airtable 安全、貼近 Salesforce),但缺 parity 常用路徑。
→ **三態取代二態**:safe(直通)/ **lossy**(dry-run 預覽「N 筆將被清空」+ 二次確認 + 轉換前自動快照原值到影子欄保留 30 天)/ forbidden。
優先補 `singleSelect→multiSelect`(Salesforce 有先例)、`text→number/date`、`number/date→text`。**絕不做盡力轉直接清空。**

### 🟡 其餘落差

| 項 | 業界 | 建議 |
|---|---|---|
| `""` vs NULL | Airtable **數值欄的 0 與空等價**(`{Number}=BLANK()` 對 0 回 true);Ragic 相反且更粗糙(數值欄套公式一律回 0)。**兩家都不嚴格區分,是已知的爛設計不是慣例** | 寫入端統一把 `""` normalize 成 NULL,避免 text 欄出現「兩種空」導致 `IS NULL` 篩選漏抓;checkbox 建議 `NOT NULL DEFAULT false` |
| money 精度 | Airtable **每欄設定小數位與符號**,且「不支援同一欄多幣別」 | 現行 `numeric(19,4)` 儲存 + 每欄 `precision` 顯示已兩者兼得。但 R2 需 **ISO 4217 minor unit 依幣別捨入** → 現在就把「顯示精度(每欄)」與「結算捨入精度(每幣別)」拆成兩個 metadata 欄,別共用一個 `precision` |
| 計算欄依賴 | Airtable 有 **Field Manager「Dependencies」面板**,刪除前可查誰依賴;官方承認「referenced condition field 被刪或改型別 → **can blank the field's values entirely**」 | 拓撲排序偵測環(建立時拒)+ 被引用欄改軟刪除並列依賴清單阻擋 |
| autoNumber | **Airtable 官方**:「record 刪除後其餘**不重新編號**,留下 gap」——**不回收**;Ragic 同,另提供「設定下一筆序號」與「空值自動填入序號」 | **不回收(維持)**。補 Ragic 有的兩項(遷移必用);**reset 邊界改用租戶時區**算 reset_key —— 用 UTC 會跨年/跨月早幾小時歸零 |

### ✅ 已優於或等同業界(維持不動)

- **NULLS LAST**|Airtable 官方:「in almost all cases, sorting **ascending** will place **blank values first**」,要空值墊底得靠反轉排序方向 hack。**本專案的預設較佳**
- **date 用 PG `date`、dateTime 用 `timestamptz`**|**Airtable「stores dates in GMT」正是位移 bug 的來源**;本專案沒犯這個錯
- `numeric(19,4)` · autoNumber 不回收

### 來源

- [Airtable — Web API Field model(唯一可逐條對照的機器級規格)](https://airtable.com/developers/web/api/field-model)
- [Airtable — Sorting & Record Ordering](https://support.airtable.com/docs/sorting-records-in-airtable-views) · [Identifying Blank Values](https://support.airtable.com/docs/identifying-blank-values) · [Field Type overview](https://support.airtable.com/docs/field-type-overview) · [Number-Based Fields](https://support.airtable.com/docs/number-based-fields-in-airtable) · [Timezones and Locales](https://support.airtable.com/docs/timezones-and-locales) · [Lookup Field Overview](https://support.airtable.com/docs/lookup-field-overview)
- [Airtable Community — removing a select option clears cells](https://community.airtable.com/t5/other-questions/how-do-you-remove-an-option-from-a-select-list/td-p/134010)
- [Ragic — 哪些功能能自動同步、哪些需要觸發(link&load = 快照之權威來源)](https://www.ragic.com/intl/zh-TW/doc-kb/which-features-sync-data-automatically-and-which-require-triggering)
- [Ragic — 自動產生欄位值](https://www.ragic.com/intl/zh-TW/doc/auto-generated-field-values) · [連結與載入](https://www.ragic.com/intl/zh-TW/doc/link-and-load) · [數值欄公式回傳空值而非 0](https://www.ragic.com/intl/zh-TW/doc-kb/How-to-make-calculated-fields-empty-instead-of-zero)
- [Salesforce — Considerations for Converting the Field Type of a Custom Field](https://help.salesforce.com/s/articleView?id=platform.notes_on_changing_custom_field_types.htm)
- [Baserow — Field converter](https://baserow.io/docs/plugins/field-converter)

---

## 0-ter. 深度研究(2026-07-29)— 🔴 三項落實前的向上設計

§0-bis 只做到「發現落差」。本節是動工前的第二輪深研,**推翻了 §0-bis 的三個判斷**,故獨立成節保留原判斷與更正,不覆寫。

### A|lookup live vs snapshot

**A-1 先修正一項認知落差:這不是新決策,是已裁定但只落地一半的設計。**
`docs/modules/R1/formula-and-linkload.md` 的 **OQ-FML-4 早已裁定「A. 兩者都做且區分」**
(Load 快照可編輯 / Lookup 即時唯讀),理由正是「Ragic 兩者皆有且語意不同」。
現況是 **Lookup(live)做完了,Load(snapshot)只做了讀取端**:`RelationService.load()` 已存在且註解寫明
「快照複製至來源記錄之語意」,但**不持久化、無前端帶入 UI、無重整、無稽核**。

**A-2 各系統對照**

| 系統 | 預設 | 可否設定 | 重整機制 |
|---|---|---|---|
| **Ragic** | **Snapshot** | ✅「隨時同步載入欄位值」勾選(**預設不勾**) | 設計模式齒輪「執行一次」 |
| **FileMaker**(30 年先例) | **Snapshot** | ✅ 雙機制:lookup 靜態 / 關聯欄動態 | `Relookup Field Contents`,**不可 undo** |
| **Quickbase** | lookup live,**另立 snapshot 欄** | ✅ 欄位屬性 Advanced → Snapshot | 換 parent 才重取 |
| **SAP / NetSuite / Dataverse** | **Snapshot**(寫入文件層) | — | 手動 Update prices |
| **Odoo** | 地址=**存參照(等同 live)** | ❌ | — |
| **Airtable / Baserow / NocoDB / Teable / Notion** | **全 Live** | ❌ 全無 | 自動 |

Dataverse 官方那句最精準:「The data that is transferred is the data at that point in time.
**The data isn't synchronized if the source data later changes.**」

**A-3 ⚠️ 更正 §0-bis 的引文**|原文標為 Ragic「理由原文」的
「不必讓本月商品的變動內容影響去年的舊訂單」**中英文官方文件四路搜尋皆查無**。
官方用的是**客戶搬家**例(見 §0-bis 已更正段)。語意等價,但不得當引文使用。

**A-4 負面發現(兩個方向都查了)**

- **snapshot 側**|Ragic 官方 KB 295 專篇教「手動值被同步/重算覆蓋,如何從備份救回」——
  救援程序是 **Tools > Download from Backup → 匯回**,且需有 unique 欄才能對映。
  官方預防建議逐字:「If the field is set to Link and Load or has a formula, **manual edits are not recommended**.」
  → **代表 Ragic 的重整是無差別覆蓋、無 diff、無逐筆稽核。這是本專案可明確勝出之處。**
  另 KB 153 / 255 / 344 三篇教自動重跑,證明「主檔改了單據沒跟上」也是真實痛點。
  ⚠️ **未找到「因 snapshot 造成重大損失」的公開事故** —— 該側證據形態是困惑與需求,不是災難。
- **live 側**|證據明顯更多且更嚴重。Airtable 社群發票串使用者原話:
  「**Who wants all invoices to change when the product price changes???**」至 2025-01 仍無原生解。
  Baserow feature idea 原話:「Lookup fields in Airtable and Baserow are **basically useless
  unless you don't care about historical Data accuracy**.」官方人員回覆表示**仍難以理解此需求**。
  Odoo [#23756](https://github.com/odoo/odoo/issues/23756) **2018 開至今 OPEN**:
  「Printing the SO before and after changing the addresses result in different documents.」
  Odoo 官方立場是「改地址有時是為了修正錯字」,ticket 被關;回報者反駁:
  「The address correction should not affect the order once created, **even if it's really a typo**.」

**A-5 決定性論點:失敗不對稱**

| | live 出錯 | snapshot 出錯 |
|---|---|---|
| 症狀 | 歷史單據被**靜默**改寫 | 使用者看到舊值 |
| 可觀察性 | **不可觀察**(無事件無記錄) | 立即可見 |
| 可修復性 | **不可修復**(原值已不存在) | 按一下重載 |

→ 兩種設計都會出錯,但**只有一種的錯誤可觀察且可修復**。企業級系統選失敗可見的那邊。

**A-6 最重要的設計槓桿:把選擇從「建欄時」移到「單據生命週期」**

即使欄位設 live,**記錄一旦 locked / posted / 期間關閉,自動固化所有 live 值為物理快照**。
一次解決四件事:(1) 使用者選錯也不失真 → **不需理解術語就安全**;(2) 未鎖定期間保有 live 便利;
(3) 對齊 AGENTS 鐵則 4 傳票不可變(證據錨:Odoo secure posted entries hash、SAP billing 後不重算);
(4) **既有全 live 欄不改語意即受保護 → 遷移風險趨近零**。

**A-7 UI 文案不出現 live / snapshot 術語**(業界無一家用此術語當文案):
「這個欄位的內容,之後要不要跟著「客戶」主檔一起變?」
◉ 保留填單當時的內容(建議)· ○ 永遠顯示最新內容 ⚠️「**包含去年的舊單據**」

**A-8 DDL 成本近零(關鍵可行性)**|`field_def.physical_column` 是 generated column `'f' || id`,
**虛擬欄早已有保留好的欄名**,虛轉實不需改名。PG 的 nullable `ADD COLUMN` 是 catalog-only,**不 rewrite**。
再加 **lazy backfill**(值 NULL 時讀取回退 live,下次寫入或明確重整才落值)→ 切換是 O(1) DDL、零 backfill 停機。

### B|型別轉換

**B-1 🔴 推翻 §0-bis「影子欄保留 30 天」—— 這個設計是錯的。**
PG 16 官方 limits.html 逐字:「**Columns that have been dropped from the table also contribute to
the maximum column limit.**」1600 欄上限,**DROP 掉的欄位仍佔額度**。
⚠️ **2026-07-30 更正**:原文寫「只有 `VACUUM FULL` / `pg_repack` 重建整表才回收」—— **這是錯的**。
本機實測(PG 16,300 次 add/drop 循環):`VACUUM FULL` **後 `pg_attribute` 的 dropped 仍是 300、
`max_attnum` 仍是 301**,完全沒有回收。PG 核心開發者 David Rowley 於 pgsql-hackers 明言
「We just never recycle attnums」;`pg_repack` 走 relfilenode swap,不動 `pg_attribute`。
**唯一解是建新表 + `INSERT INTO new SELECT` + 換名**。詳見 [H-2 recycle-bin](recycle-bin.md) §0.5。
設計期反覆改型別本就是高頻行為 → 30 天窗口會讓影子欄堆積撞硬牆(此結論不變,且比原本更嚴重)。
**前例對照:Baserow 的備份欄只留 120 分鐘**(`MINUTES_UNTIL_ACTION_CLEANED_UP` 預設 120),
且其原始碼自承「fast but **not suitable for actually backing up the data to prevent data loss**」。
→ **改用 side table 存 old_value(jsonb)**;短窗口(小時級)才用影子欄。
另一個影子欄風險:動態表引擎若以 `SELECT *` 或 `information_schema` 反射欄位,**備份欄會外洩**到
API / grid / 匯出 / OpenAPI,必須在 metadata catalog 顯式排除。

**B-2 🔴 推翻「三態」——(a) 缺「值會被改變」這一類**
Airtable 真實事故不是清空而是**靜默改值**:大整數(>2^53-1)因 JS number 精度被改成錯的值,
使用者存產品編號 / 條碼最易中。社群原話:「it changes the data values... **with no warning at all**」,官方無回應。
Baserow 的 `round()` / `greatest(...,0)` / `least(...,max)` / 多選取 rank=1 全屬靜默改值。
→ **dry-run 必須報兩個數字:`will_be_nulled` / `will_be_altered`,不可合併成一個 N。**
使用者對「清空 3 筆」的接受度遠高於「悄悄改了 10 萬筆的小數位」。

**B-3 🔴 推翻「三態」——(b) 缺「safe 但需要 DDL」**
`singleSelect → multiSelect`(text → text[])**語意零損失**但要 rewrite + ACCESS EXCLUSIVE。
既不屬 safe(零 DDL),也不該進 lossy(沒東西會丟)。→ **四態**:
`safe-metadata`(直通)/ `safe-rewrite`(告知列數+預估鎖時間,單次確認)/ `lossy`(dry-run+二次確認+保留原值)/ `forbidden`。

**B-4 反直覺發現:Ragic 的型別轉換是非破壞性的。** 官方 KB 逐字:
「If you have not made any further changes, simply **revert the field type to the original,
and the values will return to normal**.」→ 暗示 Ragic 底層非「每欄一個強型別 real column」,
值以寬鬆形式存,型別屬 metadata 解讀。**故對標 Ragic 的使用者心智是「改型別可隨便試,不對就改回來」**,
`forbidden` 態會被感受成「比 Ragic 難用」。折衷:對「必定 rewrite 但語意可逆」的路徑
(number→text、date→text)用 side table 達成可逆體驗 —— 保留機制的定位不是安全網,是**可逆性的實作機制**。

**B-5 ⚠️ 與 A 案的耦合(自查項)**|研究明確點出:
「若 singleSelect 如 Baserow 存 option id(FK),`singleSelect → text` 就不是 text→text,不能標 safe」。
**本專案現況存的是文字值**(`z.enum(choices)` + `dbFieldType: text`),故現行標記正確;
但**若採用選項 stable id 方案改成存 id,這條 safe 路徑會同時失效** —— 兩案必須一起裁定。

**B-6 PostgreSQL 事實(官方明載,兩個易漏陷阱)**
- rewrite 規則兩條件是 **AND**:「if the USING clause does not change the column contents **and**
  the old type is binary coercible」→ **只要用了會改值的 USING,必定 rewrite**。
- 免 rewrite 的具體案例(PG 9.2+):varchar/varbit **加長**、numeric **提高精度**;**縮短不免**。
- text ↔ varchar 在無 collation 變更時**不需重建索引**(排序相同)。
- ⚠️ **統計被清除** —— 官方建議轉換後跑 `ANALYZE`,不做會使 query plan 劣化。
- ⚠️ `USING` **不套用到 column default** —— 需 DROP DEFAULT → ALTER TYPE → SET DEFAULT。

**B-7 dry-run 是市場空白**|Airtable / Notion / Ragic / Baserow / NocoDB / Teable **沒有一家**提供
「會影響 N 筆」的預覽。工程界成熟 pattern 可借:Terraform plan/apply、Flyway dry-run、
gh-ost / pt-online-schema-change 不加 `--execute`、**Bytebase**(審核者可見 statement + 受影響列數)。
關鍵:**dry-run 與執行必須用同一個 try_cast 函式**,這是預覽與結果一致的唯一保證(Flyway 同原理)。

**B-8 try_cast 要比 Baserow 嚴謹**|Baserow 用 `exception when others`,會**吞掉 statement_timeout
等非資料錯誤**。應收窄為 `invalid_text_representation` / `numeric_value_out_of_range` /
`datetime_field_overflow` / `invalid_datetime_format`,其餘照拋。

**B-9 其餘負面發現**
- **NocoDB #10515**|meta API 改 `uidt` 不同步改 DB 型別,filter 仍用字串比較 → **靜默給出錯誤查詢結果**;
  #11848 欄位在 UI 消失但 PG 裡還在。→ **真實表架構的頭號故障模式,與本專案直接相關**:
  任何轉換路徑都必須保證 metadata catalog 與 `information_schema` 最終一致,並有對帳 job。
- **Baserow 救援文件與實作對不上**|程式碼有完整 backup/undo,官方 user-doc 完全沒提型別轉換救援路徑。
- **Salesforce 的嚴謹有明碼標價**|背景 job **可能超過 24 小時**、85M 轉換硬配額、
  資料遺失會**連帶刪除 list view** 並影響 assignment/escalation rules。
- **Rails `change_column` 是 irreversible migration**|業界最成熟 ORM 之一都不假裝能自動回滾型別變更。
- **Notion 官方文件對型別轉換後果零字提及**(已實抓確認);唯一討論來源是備份廠商行銷文(利益衝突)。

**B-10 專案專屬警示**
- `text → number`:PG `numeric` 無 2^53 問題,但 **API 若以 JSON number 回傳,大整數會在瀏覽器端被截斷**
  —— 正是 Airtable 事故的同一機制。金額 / 大整數欄 API 一律回字串。
- `text → date`:本專案已踩過 pg DATE parser 位移 bug。**格式必須釘死白名單**,
  不依賴 PG 寬鬆 date input(`'01/02/03'` 會依 `DateStyle` 解成完全不同的日期);
  無法以指定格式解析者一律計入 `will_be_nulled`,即使 PG 自己猜得出來。
- `number → money`:**必須強制指定幣別**(不可推斷),且禁用 PG 內建 `money` 型別(locale 依賴)。
- **過度設計警示**|實測 7M 列 / 600MB 表 rewrite 僅 **21.6 秒**。Phase 1 不需非同步 job + 進度 + 通知,
  先做同步 + `lock_timeout` + `statement_timeout`,撞到再說。

### C|選項身分模型 —— 🔴 推翻 §0-bis 的「選項存 stable option id」

**C-1 §0-bis 的建議是錯的。** 原判斷「選項存 stable option id(顯示名另存)」等同下表的**設計 A**,
而**同為真實表架構的 Teable 與 NocoDB 都不這麼做** —— 兩者皆存名稱、皆以 option id 偵測改名後改寫資料。
走設計 A 的是 **Baserow**,代價正是本專案最不能付的:真實表完全不可讀。

| 系統 | 選項有 stable id | **記錄實際存什麼** | 架構 |
|---|---|---|---|
| **Teable** | ✅ `choices[].id` | **名稱**(`z.string()`,以 `choices.find(c => c.name === v)` 驗證) | **真實表** |
| **NocoDB** | ✅ `nc_col_select_options_v2.id` | **名稱 text**(多選是逗號串) | **真實表** |
| **Baserow** | ✅ 整數 PK | **整數 FK `field_<id>_id`**;多選在 M2M through 表 | **真實表** |
| Airtable | ✅ `selXXX` | 內部 id;**REST API 對外讀寫是名稱** | 專有 |
| Notion | ✅ UUID | 內部 id(官方:「Does not change if the name is changed」) | 專有 |
| Salesforce | ✅ API name | API name,label 可另改(= 設計 C) | 專有 |
| Odoo Selection | ✅ technical key | **key**(label 走翻譯層) | 固定 schema |
| **Ragic** | ❌ 值即名稱 | **名稱** | 專有 |
| Grist | ❌ 無持久 id | 名稱(改名靠 UI 編輯期 `previousLabel`) | 真實表 |

**C-2 拒絕設計 A 的四個理由**
1. **直接摧毀架構賣點**。Baserow 是活證明:`SELECT *` 得到 `f123_id = 87`,多選欄根本不在該表上。
   R2 計算層寫「狀態 = 已過帳則產生傳票」的過帳規則時,設計 A 逼每條規則 join `field_def.options` jsonb。
2. **與命門原則衝突**([[feedback-calc-binding-self-service]])。AI 要從真實表推斷「這欄的『已驗收』代表什麼」,
   看到 `opt_a3f9` 完全推不動,看到 `已驗收` 才推得動。**設計 A 對 AI-native 定位是實質損害。**
3. **Ragic 遷入成本**。Ragic 匯出是名稱字串,且**必然含「已不在選項清單」的歷史孤兒值**
   (因為 Ragic 官方教的流程就是手動改完再刪選項)。設計 B 可直接 COPY。
4. **匯出可用性**。客戶匯 CSV 給稽核或主管機關,拿到 `opt_a3f9` 等於沒匯。

**C-3 拒絕設計 C(Salesforce 值/標籤分離)**|Salesforce 能這樣做是因為使用者是**專職 admin**。
本專案使用者是「自己建自己填」的 Ragic 使用者,要求同時命名「值」與「標籤」違反 no-code 定位。
**但設計 B 已偷到 C 的一半**:內部 stable id 就是 C 的「值」,只是不要求使用者命名、不曝露在 UI。

**C-4 建議何時失效(反面條件,誠實列出)**

| # | 條件 | 為何 B 會崩 |
|---|---|---|
| **F1** | **選項標籤需要多語系翻譯** | 資料欄只能存一種語言。Odoo 存 technical key 正是為此 |
| **F2** | **已過帳單據不得被追溯改字** | 與 AGENTS 鐵則 4 衝突:B 的改名會把已過帳單據上的字追溯改掉 |
| F3 | 單表千萬列 **且** 改名為常態 | 每次改名 = 全表 UPDATE + WAL 放大 + replica lag |
| F4 | 外部系統以選項名硬編整合 | 改名破壞外部契約(設計 A 亦有此問題,只是換成不可讀的 id) |

**F1 的退路只有在現在就加 id 才成立**:未來若需 i18n,可在不動資料欄的前提下,
於 choice 物件加 `labels: Record<locale, string>`,UI 以 id 查表顯示,資料欄仍存 canonical 名稱。
→ **這正是「stable id 要加,但不進資料欄」的最強理由。**
**F2 現在就要留縫**:rename 必須寫 audit;R2 過帳時傳票摘要文字須在**過帳當下 materialize**,不參照 live 選項名。

**C-5 改名的兩個實作陷阱(業界踩過)**
- 🔴 **交換 / 循環改名會全毀**。使用者一次送出 `A→B` 且 `B→A`,照序執行會先把所有 A 變 B,
  再把所有 B(含剛變過來的)變 A → 資料全毀。NocoDB 為此寫了一整套 `interchange` 臨時名 hack;
  其原始碼註解自己指出更好的解:「**CASE evaluates each row's old text once and handles cycles natively**」。
  → **用單一 CASE 一次改完**,不需臨時名。
- 🔴 **並發競態:NocoDB 與 Teable 都沒處理**。改名交易跑 UPDATE 的同時,另一交易正插入舊值
  (它讀到的是舊 metadata)→ 提交後留下永久孤兒。
  → 沿用專案既有 `pg_advisory_xact_lock(formId)`(`ddl.service.ts` 已在用,M1 spike 實測開銷可忽略):
  改名走 exclusive、記錄寫入走 **shared**。**關鍵細節:寫入路徑必須在取得 shared lock 之後才讀 options 做最終驗證**,
  否則快取會讓鎖失效。

**C-6 刪除:軟停用(retire)。Salesforce 是唯一完整前例,而它的兩個代價要一起抄**
- 官方語意:停用後「existing records that had the value **continue to display it**」,且**可 Activate 還原**。
- 🔴 **代價一**:停用值會**靜默從 report bucket 掉出**,官方定調為 **expected behavior 而非 bug**,
  且重新啟用後 bucket 設定**不會自動回來**。→ **retired 選項必須仍出現在篩選器 / 分組 / 顏色 / 排序的可選清單中。**
- 🔴 **代價二**:inactive values 無節制累積會拖垮效能,Salesforce 最終被迫加 **4,000 硬上限**
  且移除上限的選項也被拿掉。→ **retired 數量必須納入總上限(active + retired 合計 ≤ 200)。**

**C-7 「刪除前顯示 N 筆記錄正在使用」—— 所有查證的系統都沒有。**
Airtable / Baserow / NocoDB / Teable / Notion 皆無;Salesforce 最接近(強制選 replace 目標或留白)但不顯示筆數。
→ 這是**可做出差異化的小功能**,且對「取代 ERP」的嚴謹定位是必要的信任訊號。

**C-8 Ragic 的官方流程(對遷移最關鍵)**|官方 KB 逐字:
「由於此功能目前不支援直接變更**選擇欄位**的選項,若要修改選擇欄位的值,需透過**大量修改**來變更。」
建議步驟是「加新選項 → 篩選 → 大量修改 → 回設計模式刪舊選項」。
→ 兩個推論:(a) **既有 Ragic 客戶已被訓練成接受「改名 = 手動遷移」**,任何自動化都是體驗升級;
(b) **Ragic 匯出檔必然含孤兒值**,遷入時必須能吸收 —— 直接支持「軟停用 + 允許既有值超出 active 集合」。

**C-9 結構性改動:廢除以名稱為 key 的 side map。**
現行 `colors: Record<選項名, 色>` 與 `optionParents: Record<子選項名, 父選項名[]>` 是「借屍還魂」bug 的根源
(現行 `superRefine` 是用驗證去補結構缺陷)。v2 把 color / parents **收進 choice 物件、以 id 為錨**
→ **該類 bug 從結構上消失,驗證規則可退場**。

**C-10 其餘負面發現**
- **Airtable 刪除選項會清空既有格,但官方文件完全未載**(已逐頁查證 `single-select-field` 兩個版本),
  UI 無警告、不可還原。社群一致回報。**這是要避開的行為典型。**
- **Airtable `typecast: true` 會靜默新增選項且不去重** → 打錯字污染選項清單。
- **Notion API 完全無法改名**:官方「the name and color of an existing option **cannot be updated**」
  → 唯一路徑是刪舊建新,必然掉資料。且 update property schema 是 **replace-all 語意**:
  「If an existing option is omitted, it **will be removed**」→ 送出部分清單即刪光其餘,整合商反覆踩雷。
- **Salesforce rename 與 replace 皆不寫入 record history** → 稽核斷鏈。本專案必須寫 audit。
- **NocoDB #3896**:改名不連動以名稱參照該選項的**衍生設定**(預設值仍指舊名 → 存檔報錯)。
  → 改名必須 sweep view filter / 分組 / 預設值 / 排序 / 條件格式([[rule-outer-shell-sweep]])。
- **NocoDB 多選塞逗號串 text** → 選項名不得含逗號。**本專案用 `text[]` 沒有這個限制,是結構性優勢。**
- **Teable 改名/刪除走逐列 OT op**(先撈出所有受影響列再逐列建 op)→ 大表不可擴展。

**C-11 與 B 案的交叉裁定**|B-5 已指出:若採設計 A 改存 option id,
`singleSelect → text` 這條 safe 轉換路徑會同時失效。**採設計 B 則該路徑維持有效** —— 兩案在此收斂,無衝突。

### A-9 落地進度(2026-07-29)

| 步驟 | 狀態 |
|---|---|
| 1. `mode` 顯式化(既有回填 live) | ✅ **SHIPPED**|`options.syncMode: "live" \| "snapshot"`,**schema 預設 live**(既有欄位零遷移;預設值若改 snapshot 等於靜默改寫所有既有單據的行為)|
| **2. 鎖定即固化** | ✅ **SHIPPED**(簽核定案 → `RecordService.freezeComputed`,側表 `record_snapshot`) |
| 3. snapshot 寫入路徑 | ✅ **SHIPPED**|snapshot 模式**有物理欄**(逐欄 virtual 判定),link 欄被寫到時固化來源當下值;讀取時值為 NULL 才回退即時計算(= §A-8 lazy backfill,剛切換的既有記錄照舊顯示)|
| 4. 單筆/批次重整 + diff + 逐值 audit | ✅ **SHIPPED**|`RelookupService` + `POST /forms/:id/fields/:fieldId/relookup { dryRun }`;dry-run 回「會改幾筆 + 前 20 筆 before→after」,套用後**每筆寫 `action_audit`**。Ragic 對應功能是無差別覆蓋、無 diff、無記錄 |
| 5. 新欄預設 snapshot + 情境化文案 | ✅ **SHIPPED**|設計器新欄預設「保留填單當時的內容(建議)」,文案不出現 live / snapshot 術語(§A-7)|
| 6. `onSourceDeleted` 不再靜默 null | ✅ **SHIPPED**(回 `__source_deleted__` 標記;前端翻成「來源已刪除」)|
| 7. 越權讀取(承 E-1 FMEA D3)| ✅ **SHIPPED**|帶入三層閘:來源表 view → 目標欄非 hidden → 來源表記錄範圍;無權回 `__source_restricted__`(與「來源已刪除」分開,前者是權限結果、後者是要追的資料事故)|

**preserveManualEdits 未做(明列)**|Ragic 的手動編輯保護是「重算會覆蓋手改值」的補救,
其官方 KB 甚至另闢專篇教怎麼從備份救回。本實作的重整**先給 diff 再套用**,使用者看得到
哪幾筆會被改寫;真正需要「保護手改值」時再評估,不預先加一個沒有需求驅動的旗標。

**實作期由瀏覽器實走抓出的缺陷(整合測是綠的)**|重整寫 `action_audit` 時
**app 車道對該表沒有 grant**,但整合測當時用 superuser 車道跑,權限問題完全被遮住。
已補 migration 0029(只給 SELECT / INSERT —— 稽核 append-only)並把該測試改走 app 車道。
與本 session 稍早「測試用 superuser 連線導致 RLS 全程未執法」是同一類假綠。

**實作偏離研究建議之處(有理由)**|研究 §4.6 建議把快照落在**動態表的物理欄**
(理由:physical_column 已預留、nullable ADD COLUMN 不 rewrite、可 lazy backfill)。
實作改採**側表 `record_snapshot`**,理由三條:
(a) lookup / rollup **本來就不在真實表裡**(虛擬欄),側表不損失任何「真實表可讀」的性質;
(b) 每個 lookup 都 ADD COLUMN 會逼近 PG 1600 欄上限,而該上限**連 DROP 掉的欄位都仍計入**
    (同 §B-1 的發現)—— 在使用者可自由增刪欄位的平台上不划算;
(c) 側表使「凍結 / 未凍結」成為**明確兩態**,不必用 NULL 去猜(物理欄方案分不出
    「凍結時就是空值」與「尚未凍結」)。
若 R2 的計算層需要以 SQL 直接讀凍結值,再評估 materialize 到物理欄。

**實作期踩到並由測試抓出的缺陷**|`applySnapshots` 一開始只用 `record_id` 過濾。
**記錄 id 是每張動態表各自的序列,都從 1 開始** → A 表凍結的值會蓋到 B 表同 id 的記錄上。
已加 `form_id` 範圍;反向驗證(移除該條件)確認測試轉紅。

### B-11 落地進度(2026-07-29)

| 項目 | 狀態 |
|---|---|
| 四態分類(safe-metadata / safe-rewrite / lossy / forbidden) | ✅ SHIPPED |
| dry-run **兩個數字**(will_be_nulled / will_be_altered)+ 樣本值 | ✅ SHIPPED |
| dry-run 與執行**共用同一段運算式** | ✅ SHIPPED(`castFor`) |
| try_cast 只吞資料類錯誤(不學 Baserow 的 `when others`) | ✅ SHIPPED |
| 轉換後 ANALYZE(官方明載統計會被清除) | ✅ SHIPPED(置於交易外,不延長持鎖) |
| `lock_timeout` 拿不到鎖即放棄(不排隊擋讀者) | ✅ SHIPPED |
| text→date **格式白名單**、number→money **強制指定幣別** | ✅ 契約已定;幣別的 UI 強制待前端 |
| **保留原值 / 可還原(side table)** | ✅ SHIPPED(`field_conversion_snapshot`,30 天;header 復用 `ddl_audit` 那一列不另立表) |
| 影響筆數超過門檻的二次確認 | ⏳ 未做(待前端) |
| 大表 expand-contract 逃生路徑 | ⏳ 未做(實測 7M 列 rewrite 僅 21.6 秒,先不預建) |

**實作期由測試抓到的四個缺陷**
1. 🔴 **裸 cast 遇到第一個壞值就整句失敗**。`"f1"::numeric` 只要有一筆 `N/A`
   就讓整個 ALTER 失敗 —— 而客戶的舊 Excel 幾乎必有 `N/A` / `待確認`。
   **`try_cast` 當時已寫好卻沒接上去**,是測試才發現。
2. 🔴 **轉換時把 options 清成 `{}`**,單選轉多選會把 `choices` 弄丟 →
   欄位變成沒有任何合法值的選單,「轉換成功」但資料再也寫不進去。
   改為以新型別的 schema `safeParse` 舊 options,能接受就沿用。
3. 🔴 **還原用 `USING NULL` 會清空「轉換後才新增」的列**。那些列不在快照裡,
   還原後就永久是空的 —— **還原動作本身造成資料遺失**,比原本的轉換更糟。
   改為先以**反向 cast** 把現值轉回原型別,快照再覆蓋它有的那些列。
4. `numeric(19,4)::text` 給出 `42.0000` —— 無損但難看,而使用者把數字欄轉成
   文字時期待看到 `42`。改用 `trim_scale()`(PG 13+,只去小數尾零,
   不會把 `100` 變成 `1`)。

**與研究建議的偏離**|`castExpression` 的欄名**直接內插而非走 knex `??`**。
理由:該運算式會被嵌進 count 查詢裡重複三次,佔位符的 binding 數量極難對齊(實作時踩到)。
內插安全 —— 欄名來自 `physicalColumnName(fieldId)` 系統生成,並經 `quoteColumn()`
以 `^[a-z_][a-z0-9_]{0,62}$` 二次驗證(鐵則 1 的縱深第二道)。**值仍一律參數綁定。**

### 來源(0-ter)

- Ragic|[連結與載入(中)](https://www.ragic.com/intl/zh-TW/doc/14/3) · [Link and Load(英)](https://www.ragic.com/intl/en/doc/31/link-and-load) · [KB 295 手動值被覆蓋如何從備份救回](https://www.ragic.com/intl/en/doc-kb/295/How-to-restore-manually-entered-field-values-that-were-lost-due-to-triggering-Link-and-Load-sync-or-formula-recalculation%3F) · [KB 153](https://www.ragic.com/intl/en/doc-kb/153/Repopulating-loaded-fields-from-their-source-sheet-for-link-&-load) · [KB 344 每日自動同步](https://www.ragic.com/intl/en/doc-kb/344/automatic-daily-link-load-sync) · [KB 357 型別改回去值就回來](https://www.ragic.com/intl/en/doc-kb/357/field-keeps-getting-overwritten-or-cleared-automatically)
- FileMaker|[Defining and updating lookups](https://help.claris.com/en/pro-help/content/lookups.html) · [Relookup Field Contents](https://help.claris.com/en/pro-help/content/relookup-field-contents.html)
- Quickbase|[Set up snapshots of lookup fields](https://help.quickbase.com/docs/setting-up-snapshots-of-lookup-fields)
- SAP|[One-Time Customers 地址寫入文件層](https://help.sap.com/docs/SAP_ERP/f55481b88d8545e2871ca06d5a1dbf73/1b80ce53118d4308e10000000a174cb4.html) · [Condition Records 效期主檔](https://learning.sap.com/courses/implementing-sap-s-4hana-cloud-public-edition-sales-configuration/managing-condition-records-for-sales-prices)
- NetSuite|[Working with Addresses on Transactions](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N553515.html)
- Dataverse|[Map table columns in Power Apps](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/map-entity-fields)
- Odoo|[#23756 改地址回溯改寫已確認訂單(OPEN)](https://github.com/odoo/odoo/issues/23756) · [論壇 workaround](https://www.odoo.com/forum/help-1/how-to-keep-the-invoice-address-when-partner-data-changes-44550) · [Data inalterability(過帳 hash)](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/data_inalterability.html)
- Airtable|[社群發票 lookup 串](https://community.airtable.com/t5/other-questions/lookup-data-that-doesn-t-change-after-source-data-changes/td-p/31560) · [🔴 型別轉換靜默改值事故](https://community.airtable.com/t5/other-questions/serious-bug-with-field-type-changes/td-p/159761) · [snapshot 還原會建新 base](https://support.airtable.com/docs/taking-and-restoring-base-snapshots)
- Baserow|[lookup 是 live(官方 user doc)](https://baserow.io/user-docs/lookup-field) · [One-time Lookup fields 需求串](https://community.baserow.io/t/one-time-lookup-fields/9709) · [schema.py lenient editor](https://github.com/baserow/baserow/blob/develop/backend/src/baserow/contrib/database/db/schema.py) · [backup_handler.py 影子欄](https://github.com/baserow/baserow/blob/develop/backend/src/baserow/contrib/database/fields/backup_handler.py)
- PostgreSQL 16|[limits.html(1600 欄 / dropped 仍計入)](https://www.postgresql.org/docs/16/limits.html) · [sql-altertable.html(rewrite 規則 / ANALYZE / USING 不套 default)](https://www.postgresql.org/docs/16/sql-altertable.html)
- 線上 schema 變更|[pgroll](https://pgroll.com/) · [Xata pgroll 說明](https://xata.io/blog/pgroll-schema-migrations-postgres) · [boringSQL 型別變更實測](https://boringsql.com/posts/how-not-to-change-postgresql-column-type/) · [Bytebase 受影響列數預覽](https://www.bytebase.com/blog/how-to-handle-database-schema-change/) · [Flyway dry run](https://documentation.red-gate.com/flyway/flyway-concepts/migrations/migration-command-dry-runs)
- Teable|[官方 field doc(Ctrl+Z 可還原轉換)](https://help.teable.ai/en/basic/field)
- 資料倉儲|[Kimball — Slowly Changing Dimensions(asOf 模式的正典)](https://www.kimballgroup.com/2008/08/slowly-changing-dimensions/)
- 選項身分|[Airtable Field model(choices[].id)](https://airtable.com/developers/web/api/field-model) · [Airtable Scripting cell values](https://airtable.com/developers/scripting/api/cell_values) · [Airtable single-select doc(刪除行為未載之證據)](https://support.airtable.com/docs/single-select-field) · [Notion property object(id 不隨改名而變)](https://developers.notion.com/reference/property-object) · [Notion update property schema(replace-all 語意 + 無法改名)](https://developers.notion.com/reference/update-property-schema-object)
- Salesforce picklist|[rename vs replace 差異](https://help.salesforce.com/s/articleView?id=000385717&language=en_US&type=1) · [Deactivate / Reactivate](https://help.salesforce.com/s/articleView?id=platform.fields_deactivate_reactivate_values.htm&language=en_US&type=5) · [🔴 停用值從 report bucket 靜默移除(expected behavior)](https://help.salesforce.com/s/articleView?id=000384189&language=en_US&type=1) · [🔴 inactive 值 4000 硬上限](https://help.salesforce.com/s/articleView?id=release-notes.rn_forcecom_fields_inactive_picklists.htm&language=en_US&release=230&type=5)
- Ragic 選項|[如何大量變更選項欄位值?(官方教手動大量修改)](https://www.ragic.com/intl/zh-TW/doc-kb/145/%E5%A6%82%E4%BD%95%E5%A4%A7%E9%87%8F%E8%AE%8A%E6%9B%B4%E9%81%B8%E9%A0%85%E6%AC%84%E4%BD%8D%E5%80%BC%EF%BC%9F)
- 真實表同架構原始碼|[Teable single-select.field.ts(存名稱)](https://github.com/teableio/teable/blob/develop/packages/core/src/models/field/derivate/single-select.field.ts) · [NocoDB columns.service.ts(改名同交易改寫 + interchange)](https://github.com/nocodb/nocodb/blob/develop/packages/nocodb/src/services/columns.service.ts) · [Baserow field_types.py(整數 FK = 設計 A 反例)](https://gitlab.com/baserow/baserow/-/raw/develop/backend/src/baserow/contrib/database/fields/field_types.py) · [NocoDB #3896 改名不連動衍生設定](https://github.com/nocodb/nocodb/issues/3896) · [Grist useractions.py RenameChoices(改名同步改寫 filter)](https://github.com/gristlabs/grist-core/blob/main/sandbox/grist/useractions.py)

### 查不到 / 證據不足(誠實聲明)

1. Ragic「不必讓本月商品…」原文 —— **查無**,已更正(見 A-3)
2. Airtable 官方**未逐字**說明 lookup 即時性(已實抓確認);即時性由社群 + Baserow 官方對照佐證
3. Notion rollup/relation 即時性、是否有 freeze —— 官方文件**查無**
4. **未找到「因 snapshot 造成重大事故」的公開案例** —— 該側證據是困惑與需求,非災難
5. Salesforce 官方頁 JS 渲染,三次抓取失敗;內容經搜尋引擎擷取 + 二手交叉,**完整轉換矩陣未取得**
6. Teable undo 的確切 TTL 數字 —— 確認機制持久化,未取得數值
7. Airtable 型別轉換警告對話框的確切措辭 —— 查無;社群明確反映 text→number **無警告**

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-29 | v1.1 | **§A 快照帶入全數落地**(§A-9 表):`syncMode` 顯式化(預設 live 保既有語意)、snapshot 物理欄 + lazy backfill、重整 endpoint 帶 diff 與逐筆稽核、設計器情境化文案、帶入三層權限閘(承 E-1 FMEA D3)。**瀏覽器實走抓到整合測遮住的缺陷**:`action_audit` 對 app 車道缺 grant(migration 0029 補;該測試已改走 app 車道)。preserveManualEdits 明列為不做及理由 | Claude Code |
| 2026-07-25 | v0.1 | 初版 DRAFT — docs/27 §6 順序 4（承 form-designer-2d）：系統欄/rollup/lookup/link 補完/autoNumber pattern/選項顏色+連動/barcode/mask;核心洞見(RollupService 已完整、formula 讀時注入範本、link 部分、系統欄投影);image/signature 依賴 file-storage 排除 P0（OQ-FTP-6）;OQ-FTP-1..7 待裁定 | Claude Code |
| 2026-07-25 | v0.2 | **OQ-FTP-1..7 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。定調:讀時 systemManaged pseudo-field(承 formula)、系統欄投影 audit、options 加法擴充零遷移、link 補完(含 link&load)、autoNumber counter table 統一、image/signature 依 file-storage 排除 P0、§1.1 八項為 P0 | Claude Code |
| 2026-07-25 | v1.0 | **M1–M5 SHIPPED**。M1 registry 加 6 virtual 型別(系統欄 4/lookup/rollup;no-op buildColumn,baseQuery 排除)+ RecordService.withComputed 讀時注入(系統欄投影/lookup 批次/rollup listByParents+純函式聚合,抽 rollup-agg 避服務循環)。M2 autoNumber pattern(counter 0011 + dateFormat + reset scope)+ 選項顏色/連動 + link displayFields(options 加法零遷移)。M3 barcode 型別 + text displayMask + 前端 enum 同步/渲染(計算型唯讀、barcode 輸入)。M4 設計器進階 palette + 設定編輯器(autoNumber pattern/link/lookup/rollup/系統欄)。M5 field-types.spec。FMEA T1–T4 P0 緩解(T1 lookup 欄位級權限為 ⚠️ 殘留);顯示層(QR 渲染/顏色 chip/連動過濾)+ image/signature(file-storage)+ member/rich-text 等為 P1。api 236 + web 17 e2e 綠 | Claude Code |

---

## v1.5|選擇群組(2026-08-06)

### 站③|Ragic 官方「欄位種類」逐字(`doc/27`,本機鏡像,查證 2026-08-06)

該頁是欄位型別的**權威清單**,分八類。與我方對照後,`docs/25` 記的五個缺口對應到:

| docs/25 的說法 | Ragic 的名稱 | 本次 |
|---|---|---|
| 群組 | 選項欄位 → **選擇群組** | ✅ 本次 |
| rich text | 文字欄位 → **文字編輯器** | 未起 |
| Markdown | 文字欄位 → **Markdown** | 未起 |
| 結構化地址 | 資訊欄位 → **地址** | 未起 |
| 付款 | 動作欄位 → **付款** | 未起 |

> 「**選擇群組**|選擇在資料庫中建立的群組。勾選**給予選取的群組這筆資料管理權限**,
> 則被選取的群組也會與建立此筆資料的人一樣,擁有管理此筆資料的權力……同樣也可以允許**多選**。」

⚠️ 順帶記下**這一頁還揭露了我方未列的型別**:文字遮罩(PII 遮罩 + 指定群組可揭露)、
循環日期、匯率、統計、傳閱、動作條碼、編號/號碼。`docs/25` 的「28 型已建」是對的,
但「缺哪些」那一欄**只列了五個** —— 之後要重新對一次這張表。

### 裁定

| # | 議題 | 裁定 |
|---|---|---|
| 儲存形態 | 與 `member` 同構:`bigint` 指向角色。不另立形態 |
| 選人器的權限 | **view 權**的 `access-preview/groups`,不是 admin only 的 `/authz/roles` —— 填單者要選群組,不該需要管理權(同 `listActors` 逐字的理由);且只回 id 與名稱,不洩漏組織結構 |
| 標籤怎麼翻 | 走**與連結欄同一張表**(`${fieldId}:${id}`)。`formatFieldValue` 的第五個參數就是「這一欄的 id → 看得懂的東西」,群組正是這個形狀。多開一個參數會讓**每個出口**都要多帶一個 |
| 🔴 `grantsAccess` | **刻意不做**。記錄級存取讀的是 `assignees`(actor 陣列),要支援群組得改 RLS policy 去展開「這個人屬於這個群組」。那是安全邊界的變更,不該夾在欄位型別裡順手做 —— **半接的授權比沒有更危險**(畫面說「已授權」而實際上沒有) |
| 多選 | v1 單選。多選是 `bigint[]`,與 member 的多選一起做才不會有兩套 |

### 🔴 這次把檢查一起做了

`value.ts` 的註解逐字寫著:

> 「上面那段註解(#96 member 欄)逐字寫過同一件事,而 link 還是踩了 ——
>  因為那條規則寫在註解裡,**沒有任何機制在漏列時發出訊號**。」

指向 id 的型別要同時列進 `toSubmitValue`(否則值**送不出去**)與 `formatFieldValue`
(否則畫面印**裸 id**),而**兩者漏列型別都抓不到**。加 `group` 時同一個坑就在正前方,
故先寫 `id-fields.test.ts` 再改碼。

**它立刻抓到兩件事**:`group` 的兩個漏列(意料中),以及
🔴 **`member` 查不到名字時印裸數字**(`link` 是回 `#id`)—— 既有的不一致,順手修掉。

### 兩個實走才會出現的

1. **`"use client"` 被 import 擠到第二行** → 整頁 500。型別檢查與 lint 都不會抱怨,
   只有真的載入那一頁才炸。**在檔首插 import 時要看清楚第一行是什麼。**
2. **路由猜了兩次都錯**:`?mode=new` 不存在;builder 的 `mode=fill` 是**設計畫布**
   (欄位顯示的是示例值不是輸入框)。最後走「記錄頁 → 編輯」這條真實路徑。
   **路由要去讀,不要猜。**

另外兩道既有的列舉檢查也各自發火了一次(`sample-value.test` 的「不得落到 default」、
`Record<CellValueType, …>` 的型別完整性)—— 那正是它們存在的理由。

---

## v1.5-bis|欄位型別逐項重對(2026-08-06)

`docs/25` 那一列的「缺哪些」**只列了四項**,而 Ragic `doc/27` 是 **30 種**的權威清單。
逐項對完之後真正缺 **8 項**,而且有一項被**誤列為缺**。

⚠️ 這與 #42 是同一個形狀,但**機器檢查擋不到**:`packages/docs-check` 擋的是
「模組出貨了而清單沒提」,擋不到「**缺口本身就沒列全**」。
後者只能靠「對權威清單逐項重對」,而權威清單在競品文件裡。

### 逐項對照(Ragic `doc/27` 全 30 種 × 我方 29 型,查證 2026-08-06)

| Ragic | 我方 | |
|---|---|---|
| 自由輸入 | `text` / `longText` | ✅ |
| **文字編輯器**(粗體/表格/圖片/錨點,似簡易 Word) | — | ❌ |
| **文字遮罩** | `textMask` | ✅ **v1.7** |
| **Markdown** | `markdown` | ✅ **v1.6** |
| 從選單選擇 | `singleSelect` | ✅ |
| 從選單多選 | `multiSelect` | ✅ |
| 打勾選項(**30 種圖示**的單選,值是文字) | `checkbox`(布林) | 🟡 |
| 從其他表單選擇 | `link` | ✅ |
| 選擇使用者 | `member` | ✅ |
| 選擇群組 | `group` | ✅ **v1.5** |
| 傳閱 | — | ➖ **不是獨立型別**(官方逐字:「其實就是**選擇使用者**欄位並勾選**邀請該使用者檢視這筆資料**」) |
| 檔案上傳 | `attachment` | ✅ |
| 圖片上傳 | `image` | ✅ |
| 日期 | `date` / `dateTime` | ✅ |
| **循環日期**(每年/每月/每週,配提醒) | — | ❌ |
| 數值 | `number` | ✅ |
| 百分比 | `percent` | ✅ |
| 金額 | `money` | ✅ |
| **匯率**(即時抓 **Open Exchange Rates**,可指定匯率日期參照欄位) | — | ❌ 🔴 第三方相依 |
| 統計(筆數/總和/最大/最小/平均) | `rollup` | ✅ 🔴 **原被誤列為缺** |
| 自動產生 | `autoNumber` | ✅ |
| 條碼 | `barcode` | ✅ |
| 編號/號碼(信用卡 / 身分證 / 車牌 / 自訂格式) | 格式遮罩(`text` 的 option) | 🟡 部分 |
| 電子信箱 | `email` | ✅ |
| 電話 | `phone` | ✅ |
| **地址** | — | ❌ ⚠️ **語意未查證**(該頁只在檔名設定的清單裡提到它,沒有獨立說明段) |
| 網址 | `url` | ✅ |
| 簽名 | `signature` | ✅ |
| **動作條碼**(掃描 → 查看這筆 / **執行動作按鈕**) | `barcode` 只做顯示 | ❌ |
| **付款**(拋轉繳款單 + 線上付款,**串接綠界科技**) | — | ❌ 🔴 第三方相依 |

我方另有 Ragic 未列為「型別」的:`formula` / `lookup` / `rating` /
`createdAt`·`createdBy`·`updatedAt`·`updatedBy`(Ragic 以系統欄與公式提供)。

### 🔴 兩項在動工前要先裁定,不是單純加型別

| 項目 | 相依 | 要先決定的事 |
|---|---|---|
| 匯率 | **Open Exchange Rates**(外部 API,有免費額度但非 OSS) | 與 OSS-only 的關係;離線 / 私有主機怎麼辦;匯率是**財務數字**,抓不到時不能靜默填 0 |
| 付款 | **綠界科技**(台灣金流) | 這其實是**整合**不是欄位型別;而且金流牽涉對帳(R2 的 J/K),不該由一個欄位獨立決定 |

### 建議順序(未裁定)

1. **Markdown** —— 最小、無外部相依;但要**輸出淨化**(XSS)。⚠️ `marked` 已在 `node_modules`(glide-data-grid 的 peer),站②要先複驗授權與是否真能直接用
2. **文字遮罩** —— 與 PII / 個資法相關,而我方已有欄位級權限可接「指定群組可揭露」
3. **文字編輯器** —— 富文字的儲存與淨化最重,排在 Markdown 之後才有共用的淨化層
4. **循環日期** —— 要有提醒排程才有意義(H 段通知已出貨,可接)
5. **地址** —— 先補查語意再談
6. 動作條碼 / 匯率 / 付款 —— 各自有前置裁定

---

## v1.6|Markdown 欄位(2026-08-06)

### 🔴 做法:由 token 直接產 React 元素,整條路徑不存在 HTML 字串

常見做法是 `marked.parse()` → HTML → `dangerouslySetInnerHTML` → 補一層 sanitiser。
**本模組不走那條路**:`lexer()` 只解析,由 token 產 React 元素,
白名單之外的 token 一律當**純文字**印出(不是丟掉 —— 使用者打的東西不該無聲消失)。

於是 XSS **在構造上不可能**,而不是靠淨化擋住 ——
繞過 sanitiser 是一整個持續進化的研究領域,「不產生 HTML」不會被繞。
代價是要自己列舉支援的 token,而那正好與 parity 對齊:

> Ragic `doc/27` 逐字:「透過簡單的語法,即可在欄位中加入**標題、清單、簡易表格與文字格式**」
> 「此欄位**不支援**以 Markdown 語法插入**連結與圖片**」

**「不支援連結與圖片」在它是產品取捨,在我方兼作安全邊界**:沒有 `<a href>` 就沒有
`javascript:` 協定問題,沒有 `<img src>` 就沒有外連追蹤與 SSRF。
⚠️ **不宣稱那是它的理由** —— 官方沒這樣說。

後端**完全不參與**:儲存與 `longText` 相同(純文字),不做任何轉換。存的是使用者打的原字。

### 站②|`marked` 早就裝了但零使用

`packages/ui` 的直接相依(18.0.6,**MIT**,讀 `LICENSE` 檔本文確認),而全 repo 零 import
—— 這一輪第二個「裝了沒用」的套件(前一個是 `next-intl`)。

### 🔴 順手解掉一個更大的:apps/web 的元件測試**根本跑不起來**

`vitest.config.ts` 的 `include` 一直寫著 `.test.tsx`,但 **JSX transform 從沒接上** ——
於是 `apps/web` 裡任何元件測試都會以 parse error 失敗,而既有測試全是純邏輯的 `.ts`,
所以**沒有人發現**。AGENTS.md 的測試分層把「元件互動」列為**佔多數的快層**,
而那一層在 apps/web **等於不存在**。

根因是 tsconfig 的 `jsx: "preserve"`(Next.js 慣例:JSX 留給 Next 自己轉),
於是 vite 原封不動地把 JSX 交給 parser。修法是在 vitest config 明講 `oxc.jsx.runtime = "automatic"`
—— **不必裝 `@vitejs/plugin-react`**。

⚠️ 這是「設定寫了但沒接完」的形狀:`include` 那一行**看起來**已經支援了。

### 測試上的一個自我更正

安全測試第一版斷言「輸出不含 `onerror=`」→ **直接紅,而功能是對的**:
跳脫後的文字裡本來就會有那幾個字元,那是無害的。
要驗的是「**有沒有被跳脫**」(`&lt;img`),不是「有沒有出現這串字」。

### 殘留

| 殘留 | 說明 |
|---|---|
| 網格內編輯 | 目前網格顯示攤平後的純文字;要在格子裡編輯 Markdown 需要一個彈出編輯器 |
| 語法提示 | 只在 placeholder 講了三種語法 |
| Ragic 的兩個怪癖 | 底線 `_` 預設不解析(要前後加空格)、行內語法用三個 `` ` `` —— **刻意不抄**,那是它的實作副作用不是語意 |

---

## v1.7|文字遮罩(2026-08-06)

### 🔴 這個型別的全部意義在於「遮罩在伺服器端做」

若後端回完整值、前端負責遮,任何人打開開發者工具就看得到 —— **那不叫遮罩叫裝飾**。
故遮罩掛在**讀取的咽喉**,而且**預設就遮**:刻意不放進 `maskRead`,
因為那一支在 `policy === undefined` 時整個短路(內部路徑不套欄位權限),
而文字遮罩的語意是「除非有人明示要看,否則都遮」—— 內部路徑也不該看到身分證字號。

### 🔴 最重要的一道其實是「寫入端」

讀出來的是 `••••6789`,使用者按編輯又直接存檔的話,那串點就會**蓋掉真值** ——
**一次無心的儲存永久毀掉一筆個資,而且沒有任何錯誤訊息。**

Ragic 的解法是「編輯時清空、必須重新輸入」(官方逐字)。前端照做,但那是**體驗**;
真正的保證在伺服器:看起來像遮罩值的寫入一律拒(`MaskedValueWriteError`),
而且**這一段放在 `policy === undefined` 短路之前**。

⚠️ 代價誠實記:使用者真的想存一個含 `•` 的字串會被誤擋。
對「儲存隱私資料」用途的欄位,這個誤擋遠比毀掉真值划算。

### 🔴 真瀏覽器實走抓到第五個出口

整合測試驗了 `getRecord` 與 `listRecords`,兩條都遮得好好的。
**而記錄頁下半部的修改紀錄把 `A123456789` 完整印出來** ——
`record_revision` 存的是原始值,它是另一條會吐出欄位值的路徑。

「值只要有第二個出口就會漏」在這個 repo 已經是**第五次**
(公式污染閉包 / 連結標題 / 通知內容 / 修改紀錄的遮罩 / 這次)。

**補的不是個案**:測試改成**逐一走過每個會吐出欄位值的端點**,
新增出口時那一條會紅。

### 其他決定

| 議題 | 裁定 |
|---|---|
| 篩選運算子 | **一個都不給**。可篩就可以用二分逼近把值猜出來 —— 與「隱藏欄不得出現在 WHERE / ORDER BY」同一條理由 |
| 遮罩長度 | **固定四個點**,不隨原值長度變化。Ragic 是逐字遮(長度可見),我方刻意不同:長度本身也是資訊(帳號 / 病歷號的長度會縮小猜測空間) |
| `revealRoleIds` | **不是「誰看得到這一欄」**,是「誰可以按眼睛」。欄位可見性仍走既有的欄位級權限,兩者正交 |
| 揭露稽核 | **與取值同一個交易**。「取到了但沒記」比兩者都失敗更糟 —— 那正是稽核最需要成立的時刻 |
| 前端要不要判斷權限 | **不判斷**。一律顯示眼睛,按了由後端決定 —— 前端先判斷就是第二份權限來源,必然分岔 |
| 揭露是不是 toggle | **不是**。看過就是看過(且留了稽核),收合只是把畫面收回去 |

### 殘留

| 殘留 | 說明 |
|---|---|
| 設計器沒有遮罩選項的 UI | 目前 `mode` / `keep` / `revealRoleIds` 只能由 API 設定 —— **這違反第一約束**,要補 |
| 匯出 / PDF 的出口未逐一驗 | 兩者都走 `RecordService` 的讀取路徑故理論上已遮,但**沒有測試釘住** |
| 搜尋索引 | 遮罩欄的值會不會進全文索引未查 —— 若進了就是另一個出口 |
