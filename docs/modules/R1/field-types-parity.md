# field-types-parity.md — [R1·UP-4] 欄位型別 parity（form-engine-core 增量）設計文件

> ✅ **狀態：APPROVED — OQ-FTP-1..7 已裁定（2026-07-25;全採建議 = 全 A）;進入 M1**
> **裁定摘要**｜1=A 讀時 systemManaged pseudo-field · 2=A 系統欄投影 audit · 3=A options 加法擴充 · 4=A link 補完(含 link&load,級聯 P1) · 5=A counter table 統一 · 6=A image/signature 依 file-storage 排除 P0 · 7=A 採 §1.1 八項為 P0。
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

- ❌ **image / signature 欄 + attachment 上傳完成**｜依賴**檔案儲存基礎設施**(上傳端點 + 物件儲存抽象,OSS MinIO/local + 病毒掃描 + 大小/數量限制)—— 列為 **file-storage 依賴**(OQ-FTP-6:自成 P1 子件,本模組 P0 不含)。barcode(渲染)/mask(顯示)不需儲存 → 入 P0。
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
| **M1** | 後端：系統欄 + rollup + lookup 讀時型別（api commit）| ⏳ |
| **M2** | 後端：link 補完 + autoNumber pattern + 選項顏色/連動 | ⏳ |
| **M3** | 前端：新型別 palette + field-input 渲染 | ⏳ |
| **M4** | 前端：設計器新型別 options 設定（M3–M5 web commit）| ⏳ |
| **M5** | field-types.spec 固化 + FMEA + doc v1.0 + MODULES ✅ | ⏳ |

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

## 12. 失效場景反思（FMEA）— M5 收尾必填（R17）；pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| T1 | lookup 越權讀 target 表/欄（BOLA）| 注入前驗操作者對 target form/field 讀權;無權不注入 | P0 |
| T2 | rollup / lookup 洩他租戶資料 | rollupBatch/load 走 tenant-scoped(inTenantTx);child 綁 parent_id+tenant | P0 |
| T3 | autoNumber 並發重號 | counter `ON CONFLICT DO UPDATE RETURNING`(row lock,tx 內)保序;壓測斷言唯一 | P0 |
| T4 | 系統欄/計算欄被寫入 | systemManaged + valueSchema z.never() 拒寫（承既有）| P0 |
| T5 | 讀時計算 N+1 拖慢（rollup/lookup per-record）| rollupBatch(單查詢分組);lookup 批次 whereIn;metadata 快取(P1)| P1 |
| T6 | 計算順序循環（formula↔rollup↔lookup 互引用）| 拓樸排序 + 環偵測(承 formula);跨型別引用限制或偵測 | P1 |
| T7 | 選項顏色/連動 options 破既有表 | 加法擴充、valueSchema 不變、讀時忽略未知鍵 → 零遷移;斷言既有 select 表不破 | P1 |
| T8 | link targetFormId 指向已刪/他租戶表 | 建立時驗 ready + tenant;target 刪除 → link 顯示 orphan（不炸）;級聯策略 P1 | P1 |
| T9 | barcode/mask 值當程式碼執行（XSS/注入）| barcode OSS lib 渲染（值為資料）;mask 顯示格式（非執行）;值走 text valueSchema | P1 |
| T10 | 部署順序:前端先於 0011 migration | migration 必先(R10);缺 counter 表 → autoNumber pattern 降級（無 reset）或報明確錯 | P1 |

> **檢查點**：M5 收尾時所有 P0（T1–T4）須 ✅ 方可標 SHIPPED。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-25 | v0.1 | 初版 DRAFT — docs/27 §6 順序 4（承 form-designer-2d）：系統欄/rollup/lookup/link 補完/autoNumber pattern/選項顏色+連動/barcode/mask;核心洞見(RollupService 已完整、formula 讀時注入範本、link 部分、系統欄投影);image/signature 依賴 file-storage 排除 P0（OQ-FTP-6）;OQ-FTP-1..7 待裁定 | Claude Code |
| 2026-07-25 | v0.2 | **OQ-FTP-1..7 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。定調:讀時 systemManaged pseudo-field(承 formula)、系統欄投影 audit、options 加法擴充零遷移、link 補完(含 link&load)、autoNumber counter table 統一、image/signature 依 file-storage 排除 P0、§1.1 八項為 P0 | Claude Code |
