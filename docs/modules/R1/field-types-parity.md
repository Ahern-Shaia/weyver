# field-types-parity.md — [R1·UP-4] 欄位型別 parity（form-engine-core 增量）設計文件

> ✅ **狀態：SHIPPED v1.0（2026-07-25;M1–M5 全綠;api 236 + web 17 e2e 過）**
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
- **Ragic 官方說得最透**:**連結與載入 = 需要觸發(快照)**,只在選連結欄位時帶入。理由原文:
  「不必讓本月商品的變動內容影響**去年的舊訂單**」
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

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-25 | v0.1 | 初版 DRAFT — docs/27 §6 順序 4（承 form-designer-2d）：系統欄/rollup/lookup/link 補完/autoNumber pattern/選項顏色+連動/barcode/mask;核心洞見(RollupService 已完整、formula 讀時注入範本、link 部分、系統欄投影);image/signature 依賴 file-storage 排除 P0（OQ-FTP-6）;OQ-FTP-1..7 待裁定 | Claude Code |
| 2026-07-25 | v0.2 | **OQ-FTP-1..7 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。定調:讀時 systemManaged pseudo-field(承 formula)、系統欄投影 audit、options 加法擴充零遷移、link 補完(含 link&load)、autoNumber counter table 統一、image/signature 依 file-storage 排除 P0、§1.1 八項為 P0 | Claude Code |
| 2026-07-25 | v1.0 | **M1–M5 SHIPPED**。M1 registry 加 6 virtual 型別(系統欄 4/lookup/rollup;no-op buildColumn,baseQuery 排除)+ RecordService.withComputed 讀時注入(系統欄投影/lookup 批次/rollup listByParents+純函式聚合,抽 rollup-agg 避服務循環)。M2 autoNumber pattern(counter 0011 + dateFormat + reset scope)+ 選項顏色/連動 + link displayFields(options 加法零遷移)。M3 barcode 型別 + text displayMask + 前端 enum 同步/渲染(計算型唯讀、barcode 輸入)。M4 設計器進階 palette + 設定編輯器(autoNumber pattern/link/lookup/rollup/系統欄)。M5 field-types.spec。FMEA T1–T4 P0 緩解(T1 lookup 欄位級權限為 ⚠️ 殘留);顯示層(QR 渲染/顏色 chip/連動過濾)+ image/signature(file-storage)+ member/rich-text 等為 P1。api 236 + web 17 e2e 綠 | Claude Code |
