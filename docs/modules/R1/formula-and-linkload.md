# formula-and-linkload.md — [P0-3] 公式引擎 + 關聯 Link&Load 設計文件

> ✅ **狀態:APPROVED — OQ-FML-1..8 全採建議(2026-07-19 裁定)**;含 OQ-FEC-7 拍板 fork Teable `packages/formula`(MIT,clean-room),進 M1。**OQ-FML-9/10(2026-07-19 企業級研究後新增)待裁定**——不阻擋 M1/M2,於 M4(Rollup)前定即可
>
> **一句話**|Ragic 兩大招牌的技術核心:**欄位公式即時重算**(C 模組)+ **關聯 Link&Load / Lookup / Rollup**(D 模組)。兩者共用「依賴圖 + 重算引擎」故合為一個 P0-3 模組。**這是 R1 實作模組**(非 design-ahead)。
>
> **上游**|form-engine-core v1.0 SHIPPED(動態 Tier-2 真實表 + metadata catalog + `field_def` formula stub + `relation_def` 空殼)· docs/16(Teable `packages/formula` MIT fork 分析)· OQ-FEC-7(遞延至本模組裁定 fork 時點)。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-19)

---

## 1. 目標與範圍

### 1.1 目標

- **公式欄位**|`field_def` 型別 `formula`:用戶輸入公式(參照他欄 + 函數)→ 解析 → 依賴圖 → 求值 → 顯示;來源欄變動即重算。
- **關聯 Link&Load**|落地 `relation_def`(承 form-engine 空殼):一張表單參照另一張表單的記錄(FK 語意)+ 帶入(Load)欄位值。
- **Lookup / Rollup**|Lookup = 從關聯記錄即時拉一欄;Rollup = 對子表 / 關聯多筆做聚合(SUM / COUNT / AVG…)。
- **即時性**|前端輸入即預覽重算(docs/14「fx 即時重算」);後端為權威真值。
- **安全**|用戶公式 = **不可信輸入**;parse 成 AST **非 eval**,值參數綁定;金額 `numeric` 禁 float。

### 1.2 對應 Stakeholder 訴求

- 既有 Ragic 客戶依賴公式(單價 × 數量 = 小計)、Link&Load(採購單帶入供應商主檔)、Rollup(訂單合計 = Σ 明細)。**R1 parity 缺這塊,客戶無法遷移。**
- docs/10 標 Link&Load 為 Ragic 招牌;docs/14 §1.2 S2 網格「fx 即時重算」依賴本引擎。

### 1.3 不做的事(scope out)

- **不做 ERP 深層計算**|GL 過帳 / MRP / 成本結轉是 docs/18 計算層(R2),經 [[calc-binding-layer]] 綁定,**非公式**。公式只做「表單內 / 表單間的值運算」。
- **不做自動化工作流**|C 模組之觸發器 / 動作按鈕 / 排程(其餘部分)另行;本模組只做**公式求值 + 關聯**核心。
- **不自研 grid**|canvas 為 Glide(已 SHIPPED 封裝);本模組供 grid 顯示計算值。
- **不做全物化或全讀時算之極端**|採混合(見 A2 / OQ-FML-2)。

---

## 2. 上游 / 既有現況走查

| 上游 | 狀態 | 與本模組關係 |
|---|---|---|
| **form-engine-core**(Tier-2 真實表 + catalog)| ✅ SHIPPED | 公式 / 關聯欄為 `field_def` 之型別;求值讀寫走引擎 DML;識別碼白名單繼承 |
| **`field_def` formula stub** | ✅ 預留 | 本模組實作其 parse / 依賴 / 求值 / 物化 |
| **`relation_def` 空殼** | ✅ 建殼 | 本模組落地關聯語意(link 型別 + junction) |
| **docs/16 §5 公式引擎分析** | ✅ 研究 | **Teable `packages/formula`(ANTLR `Formula.g4`)MIT 可 fork**;求值混合式(讀時算 + 物化 PG generated column);HyperFormula 因 GPL/商用降備選 |
| **docs/16 §3 雙軌 ORM** | ✅ 定案 | Drizzle(metadata:formula_def / relation_def)+ Knex(動態表物化欄 DDL / 求值 DML)|
| **OQ-FEC-7**(fork 時點遞延)| ⏳ 本檔裁定 | 「fork Teable packages/formula vs 自研」= OQ-FML-1;clean-room 逐檔驗 MIT 標頭 + attribution(AGENTS 鐵則 5)|
| **Glide Data Grid**(canvas)| ✅ SHIPPED 封裝 | 顯示公式 / Lookup / Rollup 計算值(唯讀 cell)|

**已知瓶頸(AGENTS 明列)**|**Link&Load + Lookup/Rollup 是 N+1 破口** —— 本模組核心風險,A4 以 dataloader / 正確 join / batch 重算處理。

---

## 2-bis. 巨人的肩膀:企業級公式 / Rollup 引擎做法參考(2026-07-19 web 研究)

> 除 docs/16 的 OSS 同類(Teable/Baserow/NocoDB)外,對照企業級 / 業界標竿的實證架構,把「計算引擎內構」與「Rollup at scale」做對。

| 系統 | 類型 / 授權 | 借鏡到本模組(不採其實作,採其架構經驗)|
|---|---|---|
| **HyperFormula**(Handsontable)| Excel 級計算引擎 · GPL/商用(**不採碼,只借架構**)| **A1/A2 計算引擎黃金內構**:`Parser(→AST) → DependencyGraph(有向圖,vertex=cell/range)→ Interpreter`;**增量重算(只算受影響 cell)**;**循環偵測 = 強連通分量 SCC 分解(Tarjan)**,非樸素 DFS;**lazy computation**;range 為一等 vertex |
| **Airtable** | 專有(借 UX 語意)| **A3/A4 語意分類**:`rollup = lookup + formula`;**條件式 rollup**(篩選哪些子記錄計入,如「只加已核准明細」)→ OQ-FML-10;即時重算 |
| **Salesforce Roll-Up Summary + DLRS** | 標準功能 + DLRS 開源 | **A2/A5 三種重算模式**:**Realtime(同步)/ Scheduled(背景)/ Bulk-API(初始 backfill·全重算)**;**⚠️ 反面教材(本模組必修正)**:①標準 rollup 刪子記錄**不自動重算**→ 本模組刪/改子必精準重算(7-bis.3 硬需求);②不支援 grandchild **多層** rollup → OQ-FML-9;③25 rollup/物件**武斷上限** → 本模組不設武斷上限,以物化 + 依賴圖擴展 |
| **Notion** | 專有(借模型)| rollup 擴充 relation;背景自動重算;函數集 SUM/AVG/COUNT/MIN/MAX/MEDIAN/RANGE/percent-empty(對映 A1 聚合函數)|
| **Teable / Baserow / NocoDB** | Teable `packages/*` MIT(**可 fork**)| docs/16:parser fork Teable ANTLR `Formula.g4`;求值**混合式**(讀時算 + 物化 PG generated column);canvas grid |

**綜合設計結論**|本模組的 A2 重算引擎採 **HyperFormula 式架構**(增量 + SCC 循環偵測 + lazy),parser 採 **Teable ANTLR fork**(MIT,OQ-FML-1),Rollup 採 **Airtable 語意 + DLRS 三模式**,並**刻意修正 Salesforce 三個已知痛點**(刪除重算 / 多層 / 武斷上限)—— 這三點正好是差異化空間。

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 難度 |
|---|---|---|
| **A1 公式 parser + 函數庫** | fork/自研 ANTLR 文法 → AST;math / logic / text / date / 參照 函數集 | 高 |
| **A2 依賴圖 + 重算引擎** | 欄位依賴 DAG + 循環偵測 + 拓樸重算;讀時算 / 物化 混合 | **極高** |
| **A3 關聯 Link + Load(帶入)** | relation_def 落地(link 型別 + junction)+ 選記錄 UI + 帶入欄位快照 | 高 |
| **A4 Lookup + Rollup** | 即時拉關聯欄(Lookup)+ 子表 / 關聯聚合(Rollup);**N+1 防護** | **極高** |
| **A5 即時預覽 + 權威重算** | 前端共享求值即時顯示;後端權威重算 + 一致性 | 中 |
| **A6 安全 + 精度** | parse 非 eval / 值參數綁定 / 金額 numeric / 求值 timeout + 深度限制 | 高 |

---

## 4. A1|公式 parser + 函數庫

### 4.1 資料模型(metadata,Drizzle 固定表)

```
formula_def
  field_id(該公式欄),tenant_id,
  expr_source        -- 用戶輸入原文(如 "{單價} * {數量}")
  ast_json           -- 解析後 AST(快取,避免每次重 parse)
  result_type        -- 推斷結果型別(number / text / date / boolean)
  depends_on         -- field_id[](本表欄)+ relation 路徑(跨表)
  materialized       -- bool:是否物化為 PG generated / 觸發器維護欄
```

### 4.2 邏輯(ANTLR 文法 → AST → visitor)

- **parse**|ANTLR `Formula.g4`(fork Teable MIT,見 OQ-FML-1)→ AST;**絕不 `eval` 使用者字串**。
- **欄位參照**|`{欄名}` → 解析為 field_id(走 catalog 白名單;查無即語法錯,設計期擋)。
- **函數集 MVP**|math(SUM/ABS/ROUND/CEIL/FLOOR)· logic(IF/AND/OR/NOT/SWITCH)· text(CONCAT/LEFT/RIGHT/MID/LEN/TRIM)· date(TODAY/NOW/DATEADD/DATEDIF/YEAR/MONTH)· 聚合(用於 Rollup:SUM/COUNT/AVG/MIN/MAX)。其餘 P1-I 逐一加。
- **型別推斷 + 檢核**|AST 靜態推結果型別 + 參數型別驗證(設計期即報錯,非執行期才炸)。
- **金額精度**|涉及 money 欄之運算以 decimal(numeric)進行,禁 float(架構鐵則 2)。

### 4.3 UI

- 公式編輯器(表單設計器 S3 內):輸入框 + 欄位插入 + 函數提示 + **即時語法 / 型別錯誤標示**。

---

## 5. A2|依賴圖 + 重算引擎(命門)

- **依賴圖(DAG)**|每個公式 / Lookup / Rollup 欄記錄其 `depends_on`;全表 / 跨表構成有向圖。
- **循環偵測(SCC)**|採 **HyperFormula 式強連通分量分解(Tarjan)** 而非樸素 DFS —— 建 / 改公式時偵測環,**設計期 reject**(OQ-FML-3);runtime 兜底防無限重算。SCC 亦讓「一組互相依賴」的錯誤一次點出。
- **增量重算(HyperFormula 式)**|record 寫入 → 依依賴圖找**只受影響的下游** → 拓樸序重算(非全表);lazy:未讀取的物化欄可延後算。
- **三種重算模式(Salesforce DLRS 式)**|**Realtime**(同步,關鍵值如過帳基礎)/ **Scheduled**(背景 BullMQ,重 Rollup)/ **Bulk backfill**(新增公式 / 關聯時對既有列一次性回填,分批不鎖表)。
- **重算策略(混合,Teable pattern,OQ-FML-2)**|
  - **讀時算**|簡單、同列、輕量公式(單價 × 數量)→ 讀時求值 / PG generated column,不落額外儲存。
  - **物化**|重 Rollup / 跨表聚合 / 高頻讀 → 物化欄(觸發器 / 背景重算維護),避免每次讀掃全子表。
  - 選擇準則|見 OQ-FML-8(依 fan-in / 讀寫比 / 跨表與否)。
- **重算觸發**|record 寫入 → 找出依賴此欄的下游 → 拓樸序重算 → 物化欄更新(單一 tx / 背景 job 依規模)。

---

## 6. A3|關聯 Link + Load(帶入)

- **Link(關聯)**|`relation_def`:from_form × to_form × 關聯型別(一對多 / 多對多 via junction);link 欄存 to_record 引用(+ junction `__order` 保序,Teable pattern)。
- **Load / 帶入**|選定關聯記錄時,把來源欄值**快照複製**進本記錄(可編輯的當下值,如帶入供應商地址)—— 與 Lookup(即時)區分(OQ-FML-4)。
- **選記錄 UI**|link 欄填單時彈出來源表單搜尋 + 選取(承 field-input 擴充)。

---

## 7. A4|Lookup + Rollup(N+1 命門)

- **Lookup**|即時從關聯記錄拉一欄(唯讀;來源變動即反映)。與 Load 差異:Lookup 不快照、恆為來源現值。
- **Rollup**|對子表明細 / 一對多關聯做聚合(訂單合計 = SUM 明細金額;COUNT / AVG / MIN / MAX / MEDIAN / RANGE;函數集對映 Notion)。
- **條件式 Rollup(Airtable 式,OQ-FML-10)**|可篩選哪些子記錄計入(如「只加狀態=已核准的明細」)。
- **多層鏈式 Rollup(OQ-FML-9;修 Salesforce 不支援 grandchild)**|Rollup 欄本身可被上層 Rollup 依賴(訂單→明細→批次遞迴)—— 依賴圖天生支援鏈式,設**深度上限**防爆炸。此為差異化(Salesforce 至今不支援)。
- **刪 / 改子記錄必精準重算(修 Salesforce 標準 rollup 之已知痛點)**|子記錄刪除 / 修改 → 依賴圖精準失效 → 只重算受影響父列 Rollup。**非選項,是正確性底線**(7-bis.3)。
- **N+1 防護(AGENTS 明列瓶頸)**|
  - 列表 / grid 載入 N 列且各含 Lookup/Rollup → **dataloader 批次**(一次 IN 查詢)或**正確 join**,禁逐列查。
  - 重 Rollup 物化(A2),讀列表時直接讀物化欄不即時聚合。
  - 來源子表變動 → 只重算受影響父列之 Rollup(依賴圖精準失效),非全表重算。

---

## 8. A5|即時預覽 + 權威重算

- **前端即時預覽**|同一份公式求值器編譯到 JS(共享文法,OQ-FML-7)→ 輸入即算即顯示(docs/14 即時感)。
- **後端權威**|儲存時後端重算為真值(前端算的只是預覽,防篡改 / 不一致)。
- **一致性**|前後端同文法 / 同函數語意,避免「前端顯示 A、後端存 B」。

---

## 9. 資料模型變動

### 9.1 新增(Drizzle 固定 metadata)

`formula_def`、`relation_def`(落地既有空殼)、junction 動態表(多對多,Knex 建)。

### 9.2 SQL / Migration

- 物化公式欄:Knex 於 Tier-2 動態表加 PG generated column 或觸發器維護欄(識別碼白名單 + regex)。
- junction 表:Knex 動態建(帶 tenant_id + RLS)。

### 9.3 RLS / Permission

- formula_def / relation_def / junction 全帶 tenant_id + RLS FORCE。
- Lookup / Rollup 跨表求值**必在同租戶內**(跨租戶引用拒;隔離測試斷言)。

---

## 7-bis. 企業級 cross-cutting 檢核

### 7-bis.1 安全模型
- **公式注入**|parse 成 AST **非 eval**;無任意程式執行;欄位參照走 catalog 白名單;值參數綁定。
- **求值 DoS**|AST 深度 / 節點數上限 + 求值 timeout + Rollup 掃描列數上限(防惡意深巢狀 / 巨聚合拖垮)。
- **跨租戶**|Lookup/Rollup 關聯路徑限本租戶;RLS 兜底。
- **clean-room**|fork Teable `packages/formula`(MIT)須逐檔驗授權標頭 + 保留 attribution + 記 clean-room log(AGENTS 鐵則 5;承 OQ-FEC-7)。

### 7-bis.2 容量規劃
- 依賴圖 / AST 快取 Redis(公式變更失效)。
- 重 Rollup 物化 + 背景重算(BullMQ);大批來源變動走 batch 重算不擋請求。
- N+1:dataloader 批次;grid 分頁只算可視列。

### 7-bis.3 失效模式
- **循環引用**|設計期 reject(A2);runtime 兜底偵測防無限重算。
- **來源刪除**|link 指向的記錄被刪 → Lookup/Rollup 優雅降級(顯示空 / 標失效,不炸)。
- **公式引用欄被刪 / 改型別**|re-validation 標公式失效 + 阻擋破壞性 DDL(呼應 CBL OQ-CBL-3 同理)。
- **重算落後**|物化欄背景重算延遲 → 標「重算中」或最終一致;關鍵值(過帳基礎)走同步。

### 7-bis.4 觀測性
- 重算耗時 / N+1 查詢數 / Rollup 掃描列數 監控;慢公式告警。
- 公式錯誤(型別 / 循環 / 逾時)結構化記錄。

### 7-bis.5 資料生命週期
- 物化值隨來源重算更新;公式定義版本化(改公式影響既有列 → 重算 or 標記)。

### 7-bis.6 向後兼容 + Rollout
- 公式 / 關聯為 opt-in 欄型別;不用即純資料欄(現況零影響)。
- 逐能力上線:公式(同列)→ Link/Load → Lookup → Rollup。

### 7-bis.7 成本模型
- OSS-only:Teable packages/formula(MIT,fork)/ ANTLR runtime;無授權費。成本為重算 CPU(背景 worker)。

---

## 10. 測試策略

| 層 | 覆蓋 | 位置 |
|---|---|---|
| Vitest(api,Testcontainers 真 PG)| parse 正確 / 型別推斷 / 依賴拓樸重算 / 循環 reject / 物化與讀時算一致 / Rollup 聚合正確 / **N+1 查詢數斷言** / 跨租戶隔離 / money 精度 | apps/api/test |
| 生成式(fast-check)| 隨機公式 + 隨機 record → 前端 JS 求值 == 後端求值(前後端一致性)| 共享 |
| Vitest(web)| 公式編輯器語法 / 錯誤標示 / 即時預覽純函式 | apps/web |
| Playwright(固化)| 建公式欄 → 填單即時重算 → Link 選記錄帶入 → Rollup 子表合計 → 改來源即重算 | apps/web/e2e |

---

## 11. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-FML-1..8;含 OQ-FEC-7 fork 決策)| ⏳ |
| **M1** A1 | 公式 parser(fork/自研 ANTLR)+ 函數庫 + 型別推斷 + formula_def | ⬜ |
| **M2** A2 | 依賴圖 + 循環偵測 + 重算引擎(讀時算 / 物化混合)| ⬜ |
| **M3** A3 | relation_def 落地 + Link 選記錄 + Load 帶入 | ⬜ |
| **M4** A4 | Lookup + Rollup + **N+1 防護(dataloader / 物化)** | ⬜ |
| **M5** A5 | 前端共享求值即時預覽 + 後端權威重算一致性 | ⬜ |
| **M6** 收尾 | 安全 / 精度硬化 + Playwright 固化 + FMEA + SHIPPED | ⬜ |

---

## 12. 開放問題(OQ-FML-N)— OQ-1..8 ✅ 已裁定(全採建議);OQ-9/10 研究後新增待裁定

| # | 議題 | 選項 | 裁定(全採建議)|
|---|---|---|---|
| **OQ-FML-1**(承 OQ-FEC-7)| 公式 parser 來源 | A. fork Teable `packages/formula`(MIT,ANTLR `Formula.g4`)+ clean-room 逐檔驗 <br> B. 自研 ANTLR 文法 <br> C. formula.js / 他庫 | **A** — docs/16 已驗 MIT 可 fork,省數月且授權乾淨;逐檔驗標頭 + attribution + clean-room log(AGENTS 鐵則 5);自研為 fallback |
| **OQ-FML-2** | 求值策略 | A. 混合(簡單讀時算 + 重 Rollup 物化)<br> B. 全物化 <br> C. 全讀時算 | **A** — Teable pattern;讀時算省儲存、物化省重讀,依 A2 準則分流;避免 Baserow 全物化寫放大 / NocoDB 全讀時算讀放大兩極 |
| **OQ-FML-3** | 循環引用 | A. 設計期偵測即 reject <br> B. runtime 才擋 | **A** — 建 / 改公式時圖偵測環,拒存;runtime 兜底防無限重算 |
| **OQ-FML-4** | Load(帶入)vs Lookup 語意 | A. 兩者都做且區分(Load 快照可編輯 / Lookup 即時唯讀)<br> B. 只做其一 | **A** — Ragic 兩者皆有且語意不同(帶入地址可改 vs 即時單價唯讀);都是 parity 必需 |
| **OQ-FML-5** | 跨表重算觸發 | A. 來源變動 → 依賴圖精準失效 → 只重算受影響下游(dataloader 批次)<br> B. 定期全表重算 <br> C. 純讀時算不預重算 | **A** — 精準失效 + 批次;重 Rollup 物化背景重算(BullMQ)。N+1 為本模組頭號風險 |
| **OQ-FML-6** | 函數集 MVP 範圍 | A. math/logic/text/date/聚合 核心 ~30 函數 <br> B. 對齊 Ragic/Airtable 全集 <br> C. 極簡僅四則 + IF | **A** — 覆蓋 80% 場景;其餘(財務函數 / 進階文字 / 正則)P1-I 逐一加 registry。避免一次做全集 |
| **OQ-FML-7** | 前後端求值一致 | A. 同 ANTLR 文法編譯到 JS(前端預覽)+ 後端(權威),共享語意 <br> B. 前端另寫一套 <br> C. 前端不預覽,一律後端 | **A** — 單一文法來源避免前後端漂移;後端恆為權威,前端僅即時預覽(docs/14) |
| **OQ-FML-8** | 物化 vs 讀時算 選擇準則 | A. 依 fan-in(被多少下游依賴)+ 讀寫比 + 是否跨表聚合 自動 / 半自動決定 <br> B. 一律讓用戶手選 <br> C. 全預設讀時算,超標才物化 | **A** — 預設規則自動分流(跨表 Rollup / 高讀寫比 → 物化;同列輕量 → 讀時算),進階可覆寫;不逼用戶懂物化 |
| **OQ-FML-9**(研究後新增)| 多層鏈式 Rollup(grandchild)| A. 支援(依賴圖天生鏈式 + 深度上限)<br> B. 只單層(如 Salesforce 標準)| **A** — 依賴圖本就支援 Rollup 欄再被上層 Rollup 依賴;設深度上限(如 ≤5)防爆炸。**差異化**(Salesforce 至今不支援 grandchild);待用戶確認是否 MVP 就開或限深度 |
| **OQ-FML-10**(研究後新增)| 條件式 Rollup(篩選子記錄)| A. MVP 就做(篩選「哪些子記錄計入」)<br> B. P1-I 再補 | **A** — Airtable 標配,客戶常用場景(「訂單合計只加已核准明細」);與 Rollup 同期做邊際成本低。待用戶確認 MVP 範圍 |

---

## 13. SOP — 日常操作

> M6 收尾填(建公式 / 排查重算落後 / 慢公式優化 / 循環錯誤處理)。

---

## 14. 失效場景反思(FMEA)— 收尾必填(R17)

> M6 收尾逐路徑填(公式求值 / 依賴重算 / Lookup 來源刪除 / Rollup 大聚合 / 前後端不一致 / 並發重算 / 循環)。P0 未緩解不得上 prod。

---

## 15. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v0.1 | 初版 DRAFT — P0-3 公式引擎(C)+ Link&Load(D)合一;A1–A6 切分 + OQ-FML-1..8(含承 OQ-FEC-7 之 fork Teable packages/formula 決策);上游 = form-engine-core v1.0 + docs/16 Teable MIT fork 分析;N+1(Link&Load + Lookup/Rollup)標為頭號風險;求值混合式(讀時算 + 物化)| Claude Code |
| 2026-07-19 | v0.2 | OQ-FML-1..8 全採建議裁定;狀態 DRAFT → APPROVED;**OQ-FEC-7 拍板 fork Teable `packages/formula`(MIT,逐檔驗 + clean-room log)**;進 M1(parser + 函數庫)| Claude Code |
| 2026-07-19 | v0.3 | **企業級做法研究(站在巨人肩膀上)**:新增 §2-bis 參考表(HyperFormula 計算引擎內構 + SCC 循環偵測 + 增量 + lazy · Airtable 條件式 rollup · Salesforce DLRS 三重算模式 + 三反面教材 · Notion 函數集);A2/A4 據此強化(SCC / 增量 / Realtime·Scheduled·Bulk 三模式 / 條件式 rollup / 多層鏈式 / 刪除必重算);新增 OQ-FML-9(多層 rollup)+ OQ-FML-10(條件式 rollup)待裁定(不阻擋 M1/M2)| Claude Code |
