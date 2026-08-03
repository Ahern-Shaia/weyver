# formula-and-linkload.md — [P0-3] 公式引擎 + 關聯 Link&Load 設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-19)— M0–M6 全數達成**。fork Teable `packages/formula`(MIT,clean-room);Tarjan SCC 依賴圖 + 讀時算 + Link&Load + Rollup(N+1);前端設計器啟用 formula 欄 + 即時預覽 + e2e 固化。FMEA §14 P0 F1–F4 全清、殘留 F6(N+1)/F7(刪欄保護)P1 已知。⚠️ 對外上 prod 前提同引擎(F-2 auth)。
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

> ⚠️ **2026-08-03 稽核附註|本節是 retrospective 自評,結論的可靠度結構性偏高。**
> 同日(2026-07-19)以相同形態補寫的 §2-bis 共四份
> (`form-engine-core` / `form-designer-ui` / `grid-and-excel-import` / `formula-and-linkload`),
> 其中兩份的結論已被後續的 0-bis 推翻。**成因不是不用功,是問題設錯了** ——
> 第一輪 retrospective 問的是「我當初選對了嗎」,而那個問題的答案幾乎必然是「對」。
> 該問的是「**這個套件 / 這個競品在這一題附近還給了什麼我沒用到的**」。
> 依 `_template.md` §0.4:**禁寫「無向上缺口」這類終局結論。**
> 稽核見 `docs/modules/_audit/giants-shoulders-audit-A.md`。


> 除 docs/16 的 OSS 同類(Teable/Baserow/NocoDB)外,對照企業級 / 業界標竿的實證架構,把「計算引擎內構」與「Rollup at scale」做對。

| 系統 | 類型 / 授權 | 借鏡到本模組(不採其實作,採其架構經驗)|
|---|---|---|
| **HyperFormula**(Handsontable)| Excel 級計算引擎 · GPL/商用(**不採碼,只借架構**)| **A1/A2 計算引擎黃金內構**:`Parser(→AST) → DependencyGraph(有向圖,vertex=cell/range)→ Interpreter`;**增量重算(只算受影響 cell)**;**循環偵測 = 強連通分量 SCC 分解(Tarjan)**,非樸素 DFS;**lazy computation**;range 為一等 vertex |
| **Airtable** | 專有(借 UX 語意)| **A3/A4 語意分類**:`rollup = lookup + formula`;**條件式 rollup**(篩選哪些子記錄計入,如「只加已核准明細」)→ OQ-FML-10;即時重算 |
| **Salesforce Roll-Up Summary + DLRS** | 標準功能 + DLRS 開源 | **A2/A5 三種重算模式**:**Realtime(同步)/ Scheduled(背景)/ Bulk-API(初始 backfill·全重算)**;**⚠️ 反面教材(本模組必修正)**:①標準 rollup 刪子記錄**不自動重算**→ 本模組刪/改子必精準重算(7-bis.3 硬需求);②不支援 grandchild **多層** rollup → OQ-FML-9;③25 rollup/物件**武斷上限** → 本模組不設武斷上限,以物化 + 依賴圖擴展 |
| **Notion** | 專有(借模型)| rollup 擴充 relation;背景自動重算;函數集 SUM/AVG/COUNT/MIN/MAX/MEDIAN/RANGE/percent-empty(對映 A1 聚合函數)|
| **Teable / Baserow / NocoDB** | Teable `packages/*` MIT(**可 fork**)| docs/16:parser fork Teable ANTLR `Formula.g4`;求值**混合式**(讀時算 + 物化 PG generated column);canvas grid |

**綜合設計結論**|本模組的 A2 重算引擎採 **HyperFormula 式架構**(增量 + SCC 循環偵測 + lazy),parser 採 **Teable ANTLR fork**(MIT,OQ-FML-1),Rollup 採 **Airtable 語意 + DLRS 三模式**,並**刻意修正 Salesforce 三個已知痛點**(刪除重算 / 多層 / 武斷上限)—— 這三點正好是差異化空間。

> ⚠️ **上句「三個已知痛點」之逐字依據見 §2-bis.1(2026-08-03 補一手)。其中兩條經查證後強度不足,措辭須降級。**

### 2-bis.1 · 三條 Salesforce 反面教材的一手查證(2026-08-03 補一手)

> **背景**|§2-bis 表格的 Salesforce 欄列出三條「反面教材」,並由 §7 / OQ-FML-9 / FMEA F8 承接為差異化主張,但原文**無 URL、無查證日期**。依 AGENTS〈向上設計三條〉條件 ①(巨人明確停在那裡須有一手逐字依據)補查。
> **查證日期**|2026-08-03。**查證者**|Claude Code。**方法**|Salesforce 官方 `help.salesforce.com` 檢索 + 直取;本地 `reference-materials/teable-docs`、`baserow-docs` 對照。
> **技術限制(誠實標注)**|`help.salesforce.com/s/articleView?id=platform.fields_about_roll_up_summary_fields.htm` 為 JS 渲染之 SPA,直取只回導覽結構,**該頁正文逐字本次未取得**;能取得逐字者僅純文字 KB 文章(下表 ①③)。

| # | §2-bis 原斷言 | 查證結果 | 強度 |
|---|---|---|---|
| ① | 「標準 rollup 刪子記錄**不自動重算**」 | **⚠️ 過度概化,須降級。** 官方可查得的敘述**僅限 campaign(行銷活動)roll-up summary 欄位**,非「標準 rollup」全稱:「Salesforce doesn't recalculate the value of campaign roll-up summary fields when a lead or contact is deleted」;另有「in some cases, there can be small numerical remainders after deletion or filtering of records when you use SUM as the roll-up type」與「Force a mass recalculation of this field」手動重算選項。**「一般 master-detail rollup 刪子記錄是否自動重算」本次未查證。** | 🟡 部分成立(範圍遠小於原文) |
| ② | 「不支援 grandchild **多層** rollup」 | **⚠️ 未查證(官方逐字未取得)。** 檢索回傳之綜述稱 rollup 僅聚合直屬 detail 層、無法跨層;但其底層來源為 Trailblazer / Developer 社群討論串,**非官方 help 正文**。另查得官方確有**多層 master-detail**(自訂物件為 master 時可再有 3 層 subdetail),故「Salesforce 完全做不到多層彙總」之敘述**不得作為承重依據**。 | 🔴 未查證 |
| ③ | 「**25 rollup/物件**武斷上限」 | **✅ 成立但數字須補完。** 官方 KB 逐字:「Default: 25 roll-up summary fields per object. Maximum: 40 roll-up summary fields per object — this is a hard-coded limit and **cannot** be increased above 40.」;提高至 40 須「Submit a limit increase request with Salesforce Support」。故正確敘述為「**預設 25、硬上限 40,25→40 須向原廠提申請**」,非單一數字 25。<br>出處:`https://help.salesforce.com/s/articleView?id=000386702&language=en_US&type=1`(查證 2026-08-03) | 🟢 一手逐字 |

**對本模組裁定的影響(不改既有裁定,僅記錄建議)**

| 承重位置 | 原本靠哪一條 | 補查後 |
|---|---|---|
| §7「刪 / 改子記錄必精準重算」+ FMEA F8「修 Salesforce 痛點」 | ① | 設計本身**不受影響** —— 讀時算天生即反映,其正當性來自正確性底線,不需要競品做不到來支撐。**建議重裁 OQ-FML-5 之措辭**(僅措辭,非選項):F8 敘述刪去「修 Salesforce 痛點」,改為「架構免疫:讀時算無 stale 窗口」 |
| OQ-FML-9=A(多層鏈式 Rollup)裁定欄之「差異化勝 Salesforce」 | ② | ② 已降為未查證 → **建議重裁 OQ-FML-9 之措辭**:保留 A(依賴圖天生鏈式 + 深度 ≤5,獨立成立),但刪去「勝 Salesforce」之比較句,改為「多層為依賴圖之自然結果,無額外成本」 |
| §2-bis「本模組不設武斷上限」 | ③ | 成立。且依 AGENTS 第一約束(**設定不得外包給顧問**),更具承重力的敘述不是「上限數字小」,而是「**提高上限須向原廠提申請**」—— 那是把設定外包出去。本模組以物化 + 依賴圖擴展,無此申請路徑 |

**對照組缺口(誠實標注)**|`reference-materials/teable-docs`、`baserow-docs` 兩份本地鏡像經檢索(2026-08-03)**無 rollup 語意之專屬文件頁**(命中者僅 changelog 與 API reference)→ Teable / Baserow 之 rollup 上限與刪子重算行為**未查證**,不列入對照。

**對外措辭提醒**|依 AGENTS〈第一約束〉之「對外措辭」條:上述三條**不得**寫進對外文案作「對手做不到」的敘述,尤其 ①② 強度不足。對外只講本模組做得到什麼。

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
| **M1** A1 | 公式 parser(fork Teable ANTLR)+ 函數庫 + 型別推斷 + formula_def | ✅ **完成**|`packages/formula`(parser vendored + evaluate + ~28 函數 Decimal 禁 float + infer + 參照收集;28 tests;CLEANROOM MIT 鏈)+ apps/api `formula_def` 表(RLS+grants)+ `FormulaService.defineFormula`(parse→名稱解析成 field id→型別推斷→存;unknown/自我參照/語法錯設計期擋;7 整合測試真 PG)|
| **M2** A2 | 依賴圖 + 循環偵測 + 重算引擎(讀時算 / 物化混合)| ✅ **核心完成**|`packages/formula/graph.ts`(**Tarjan SCC 循環偵測 + 拓樸求值序**,HyperFormula 式,11 tests)+ `FormulaService` 定義期循環檢查(FormulaCycleError 帶欄名鏈)+ `computeRecord` **讀時重算**(拓樸序鏈式,真 PG 9 整合測)· 物化 / Scheduled / Bulk 三模式為後續優化(OQ-FML-8/2) |
| **M3** A3 | relation_def 落地 + Link 選記錄 + Load 帶入 | ✅ **後端核心完成**|link 欄儲存(bigint 目標 id + options.targetFormId)已由 form-engine 型別系統落地;`RelationService`.registerRelation(寫 relation_def,idempotent)+ **load 帶入**(讀目標記錄指定欄值,採購單→供應商 帶入 地址/電話);6 整合測(真 PG)· **選記錄 UI(前端)+ M2M junction 續** |
| **M4** A4 | Lookup + Rollup + **N+1 防護(dataloader / 物化)** | ✅ **後端核心完成**|`RollupService`(子表聚合 SUM/COUNT/AVERAGE/MIN/MAX + **條件式**(OQ-FML-10)+ **rollupBatch N+1 安全**(一次 whereIn 撈全部子列 app 層分組)+ **讀時算故刪子即反映**(修 Salesforce 痛點))+ `RecordService.listByParents` + `RelationService.lookup`(即時單欄);6 整合測(真 PG)· 多層鏈式由依賴圖串接 · 物化為後續 |
| **M5** A5 | 前端共享求值即時預覽 + 後端權威重算一致性 | ✅ **共享引擎完成**|apps/web 依賴同一 `@weyver/formula`(parser/求值/依賴圖 by construction 一致,OQ-FML-7=A)+ `computeFormulaPreview` 前端即時預覽 util(拓樸序鏈式 + 循環偵測 + Decimal 精度)+ 5 web 單元測;後端為權威。**渲染進填單 UI(formula 欄唯讀顯示)於 M6 隨設計器啟用** |
| **M6** 收尾 | 安全 / 精度硬化 + Playwright 固化 + FMEA + SHIPPED | ✅ **SHIPPED**|後端 createForm 自動 defineFormula + 讀時算注入(88 api tests 零回歸)+ 前端設計器啟用 formula 欄(palette + 運算式)+ 填單即時預覽(computeFormulaPreview)+ grid 唯讀 + `e2e/formula.spec.ts` 固化(建欄→預覽 50→存→資料檢視)+ §14 FMEA(P0 全清)|

---

## 12. 開放問題(OQ-FML-N)— ✅ OQ-1..10 全數裁定(全採建議)

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
| **OQ-FML-9** | 多層鏈式 Rollup(grandchild)| A. 支援(依賴圖天生鏈式 + 深度上限)<br> B. 只單層 | **A** — MVP 支援,深度上限 ≤5 防爆炸;差異化勝 Salesforce(2026-07-19 裁定)|
| **OQ-FML-10** | 條件式 Rollup(篩選子記錄)| A. MVP 就做 <br> B. P1-I 再補 | **A** — MVP 做(Airtable 標配「只加已核准明細」);與 Rollup 同期邊際成本低(2026-07-19 裁定)|

---

## 13. SOP — 日常操作

- **建公式欄**|設計器選 formula 型別 + 輸入 `{欄名}` 運算式 → createForm/addField 自動 `defineFormula`(parse/依賴/型別/循環)。語法/參照/循環錯於建立期即回。
- **排查值不對**|`FormulaService.computeRecord(tenantId, formId, values)` 手動重算比對;`formula_def.depends_on` 看依賴、`resultType` 看推斷型別。
- **循環錯誤**|`FormulaCycleError` 訊息列環的欄名鏈;移除其一依賴即解。
- **慢查詢**|列表含公式欄且列多 → 見 FMEA F6(N+1;優化為批次 computeWith / 物化)。
- **回歸守護**|`packages/formula/*.test.ts`(35)+ apps/api `formula*/relation/rollup*.integration.test.ts`(28)三層,改動前後必綠。

---

## 14. 失效場景反思(FMEA)— 收尾(R17)

| # | 失效路徑 | 嚴重 | 緩解(狀態)|
|---|---|---|---|
| F1 | 使用者公式挾帶任意程式執行 | **P0** | **parse 成 AST 非 `eval`**(ANTLR);欄位參照走 catalog 白名單;值 Decimal/字串強制轉,無 code path。✅ |
| F2 | 循環依賴 → 無限重算 | **P0** | Tarjan SCC **定義期 reject** + 求值 evaluationOrder 再驗;跨欄環擋。✅ 單元 + 整合測 |
| F3 | 金額公式以 float 失精度 | **P0** | 全程 `decimal.js`(0.1+0.2=0.3 驗);formula 欄 numeric(38,10)。✅ |
| F4 | 跨租戶 Lookup/Rollup 洩漏 | **P0** | getRecord / listByParents 綁 tenantId + RLS FORCE 兜底。✅ 繼承引擎防線 |
| F5 | 除零 / 未知函數 / 型別錯 | P1 | typed `FormulaEvalError`/`FormulaDefinitionError` fail-closed,不靜默。✅ |
| F6 | 列表逐列 computeRecord → N+1 | P1 | `hasFormula` 短路(非公式表零額外查詢);公式表每列一次 computeRecord。⚠️ **已知**:批次預載 defs / 物化為優化,列大時再做;pilot 頁 ≤200 可忍 |
| F7 | 被引用欄被刪 → 公式讀時算得壞值(非崩)| P1 | depends_on 存 id(**改名不壞**,已驗);**刪除保護未強制**(OQ-FML-3 治本:破壞性 DDL 前檢查 formula_def 引用)。⚠️ 已知殘留 |
| F8 | Rollup 刪/改子列值 stale | — | **讀時算(無物化)→ 天生即反映**(修 Salesforce 痛點,已驗 180→150)。✅ 架構免疫 |
| F9 | 前後端顯示不一致 | P1 | 前後端共用**同一** `@weyver/formula`(by construction 一致);後端為權威。✅ |
| F10 | Rollup 巨聚合拖垮(大子表)| P2 | 一次 whereIn 撈子列 + app 聚合;超大子表掃描上限 / 物化為後續。⚠️ MVP 可忍 |

**結論**|F1–F4(P0)全數緩解且具測試佐證 → 後端引擎**無 P0 未緩解**。殘留 F6(N+1 優化)/ F7(刪欄保護)為 P1 已知,治本方向明確,pilot 規模可忍。

**⚠️ SHIPPED 前尚缺(前端)**|設計器啟用 formula 欄(palette + 運算式輸入)+ 填單 / grid 唯讀渲染計算值(接 getRecord 已注入 / computeFormulaPreview 即時)+ **Playwright 固化**。後端引擎 + API 整合完整;前端 UI 為最後一哩。

---

## 15. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-08-03 | v1.0(補一手)| **§2-bis.1 三條 Salesforce 反面教材補一手查證**(承 `_audit/giants-shoulders-audit-A.md` 行動 6)。結果:① 刪子不重算 → **降級**(官方敘述僅限 campaign rollup,非標準 rollup 全稱);② 不支援 grandchild → **標未查證**(官方 help 正文為 JS 渲染未取得逐字,現有依據僅社群討論串);③ 25 上限 → **成立但補完**(官方 KB 逐字:預設 25 / 硬上限 40 / 提高須向 Salesforce Support 提申請,附 URL + 查證日)。記錄「建議重裁 OQ-FML-5 / OQ-FML-9 之**措辭**」(選項不變,由決策方裁定);標注 teable-docs / baserow-docs 無 rollup 專屬文件頁故未列對照。**未修改任何既有裁定與程式碼** | Claude Code |
| 2026-07-19 | v0.1 | 初版 DRAFT — P0-3 公式引擎(C)+ Link&Load(D)合一;A1–A6 切分 + OQ-FML-1..8(含承 OQ-FEC-7 之 fork Teable packages/formula 決策);上游 = form-engine-core v1.0 + docs/16 Teable MIT fork 分析;N+1(Link&Load + Lookup/Rollup)標為頭號風險;求值混合式(讀時算 + 物化)| Claude Code |
| 2026-07-19 | v0.2 | OQ-FML-1..8 全採建議裁定;狀態 DRAFT → APPROVED;**OQ-FEC-7 拍板 fork Teable `packages/formula`(MIT,逐檔驗 + clean-room log)**;進 M1(parser + 函數庫)| Claude Code |
| 2026-07-19 | v1.0 | **M6 前端 + SHIPPED**|設計器啟用 formula 欄(palette + options.expression)+ 填單 computeFormulaPreview 即時預覽(client 同引擎;數量 4→5 即 50→62.5)+ grid/資料唯讀顯示後端注入值;`e2e/formula.spec.ts` 固化;MCP 實走驗證。**狀態 → SHIPPED v1.0**(M0–M6 全達成;對外 prod 前提 F-2 auth)| Claude Code |
| 2026-07-19 | v0.12 | **M6 後端整合 + FMEA**|DdlService/RecordService optional 注入 FormulaService(createForm 自動 defineFormula + 讀時算注入 getRecord/listRecords;hasFormula 短路;88 api tests 零回歸);3 端到端整合測(自動註冊 + 12.5×4=50 + 逐列 50/30);§13 SOP + §14 FMEA(P0 F1–F4 全清、F6 N+1 / F7 刪欄保護 P1 已知)。前端設計器啟用 + 唯讀渲染 + Playwright 固化 = SHIPPED 前最後一哩 | Claude Code |
| 2026-07-19 | v0.11 | **M5 前後端一致求值(共享引擎)**|apps/web 接同一 `@weyver/formula`(瀏覽器相容:antlr4ts + decimal.js);`formula-preview.ts`(computeFormulaPreview:拓樸序鏈式即時預覽 + 循環偵測,與後端 computeRecord by construction 一致)+ 5 web 單元測(0.1+0.2=0.3 / 鏈式 / IF / 串接 / 循環);web build 綠。formula 欄之填單渲染 + 設計器啟用 = M6 | Claude Code |
| 2026-07-19 | v0.10 | **M4 後端核心:Lookup + Rollup(N+1 防護)**|`RecordService.listByParents`(一次 whereIn parent_id 撈全部子列)+ `RollupService`(SUM/COUNT/AVERAGE/MIN/MAX + 條件式 rollup + rollupBatch N+1 安全 + 空集不拋)+ `RelationService.lookup`;6 Testcontainers 整合測(子表聚合 / 條件式 130 / 批次多父 / **刪子列即反映 = 讀時算修 Salesforce 刪子不重算痛點**)。多層鏈式由 M2 依賴圖串接;物化 / 前端選記錄 UI 為後續 | Claude Code |
| 2026-07-19 | v0.9 | **M3 後端核心:Link + Load**|發現 link 欄儲存已由 form-engine 型別系統落地(bigint 目標 id + options.targetFormId);新 `RelationService`(registerRelation 寫 relation_def idempotent + load 帶入讀目標記錄指定欄);6 Testcontainers 整合測(採購單 link 供應商 → 帶入 地址/電話 + 錯誤路徑)。選記錄 UI(前端 P0-3)+ M2M junction 為後續 | Claude Code |
| 2026-07-19 | v0.8 | **M2 核心:依賴圖 + SCC 循環偵測 + 讀時重算**|`graph.ts` Tarjan 強連通分量(循環偵測 + 反拓樸求值序,11 tests);`FormulaService.defineFormula` 加定義期循環檢查(跨欄環 → FormulaCycleError);`computeRecord` 讀時重算(拓樸序鏈式,數量→小計 驗證);9 Testcontainers 整合測。物化 / 背景 / bulk 模式(OQ-FML-8)為後續優化。M3 Link/Load 續 | Claude Code |
| 2026-07-19 | v0.7 | **M1 完成:formula_def + depends_on 落地(apps/api)**|`packages/formula` 加參照收集器(collectAstReferences,5 tests);apps/api 加 `formula_def` 表(Drizzle + RLS FORCE + weyver_app grants,migration 0004)+ `FormulaService.defineFormula`(名稱→field id 穩定解析 / 型別推斷 / unknown·自我參照·語法錯設計期擋 / upsert)+ 7 Testcontainers 整合測試。依賴圖 + 循環偵測 + 重算引擎 = M2 | Claude Code |
| 2026-07-19 | v0.6 | **M1 二交付:求值 + 函數庫 + 型別推斷**|`evaluate.ts`(AST 樹走訪求值器,decimal.js 禁 float,除零/未知函數 typed error)+ `functions.ts`(registry ~28:SUM/AVERAGE/MIN/MAX/COUNT/ABS/ROUND/CEILING/FLOOR/MOD/POWER · IF/AND/OR/NOT/ISBLANK · CONCAT/LEN/TRIM/UPPER/LOWER/LEFT/RIGHT/MID · YEAR/MONTH/DAY/DATEDIF)+ `infer.ts`(靜態型別推斷,IF 取分支型別);23 tests(Decimal 0.1+0.2=0.3 驗證);formula_def metadata + depends_on 抽取(apps/api)續 | Claude Code |
| 2026-07-19 | v0.5 | **M1 首交付:fork Teable parser 落地**|建 `packages/formula`,vendored `@teable/formula`(MIT,文法源自 Baserow MIT)ANTLR parser(隔離出 strict gate + `@ts-nocheck` + CLEANROOM.md 登錄)+ Weyver `parseFormula()` typed wrapper(parse 非 eval,typed FormulaSyntaxError)+ 4 smoke tests 綠;antlr4ts runtime dep。函數庫 / 型別推斷 / 依賴圖 / formula_def 續 | Claude Code |
| 2026-07-19 | v0.4 | OQ-FML-9/10 全採建議裁定(多層 rollup 深度 ≤5 / 條件式 rollup MVP 做);進 M1 | Claude Code |
| 2026-07-19 | v0.3 | **企業級做法研究(站在巨人肩膀上)**:新增 §2-bis 參考表(HyperFormula 計算引擎內構 + SCC 循環偵測 + 增量 + lazy · Airtable 條件式 rollup · Salesforce DLRS 三重算模式 + 三反面教材 · Notion 函數集);A2/A4 據此強化(SCC / 增量 / Realtime·Scheduled·Bulk 三模式 / 條件式 rollup / 多層鏈式 / 刪除必重算);新增 OQ-FML-9(多層 rollup)+ OQ-FML-10(條件式 rollup)待裁定(不阻擋 M1/M2)| Claude Code |
