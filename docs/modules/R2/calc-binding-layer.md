# calc-binding-layer.md — [R2 命門] 語意計算綁定層(自由表單 ↔ 算)設計文件

> ✅ **狀態:APPROVED — OQ-CBL-1..8 全採建議(2026-07-19 裁定)**;R2 design-ahead,M1–M7 待 R2 計算層啟動時實作
>
> **一句話**|把「用戶自建的自由表單」連到「剛性計算層(GL 過帳 / 估值 / 成本 / MRP)」的那座橋。**橋本身必須自助化(no-code)**——否則背叛 Ragic 核心價值,Weyver 退化成剛性 ERP。此為「以 Ragic 表單引擎為基底,取代 ERP」能否兌現的地基(見 memory `feedback-calc-binding-self-service`)。
>
> **定位提醒**|R2 模組,**現為 design-ahead**(先想清楚架構 + 記 OQ,非即刻實作;目前工程在 R1 P0-2/P0-3)。人月**內含於 R2 計算層既有預算**(docs/18 之 P0-6~),本檔不新增 MVP 人月,只把「綁定機制」從隱性提升為一等設計概念。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-19)

---

## 1. 目標與範圍

### 1.1 目標

- 定義**計算綁定(Calc Binding)為一等 metadata**:宣告「某張用戶表單,在什麼觸發下,以什麼語意,餵給哪個計算引擎,產生什麼結果」。
- 讓綁定的建立與維護**全程 no-code / 自助**:語意欄位標記 + 預建模板 + AI 提議人核准 + ZEN 視覺規則,**逃生門絕不落到「寫程式」**。
- 讓 docs/18 的確定性計算(過帳 / 沖帳 / 估值 / 成本 / MRP)能消費**任意 schema 的用戶表單**,而非要求表單回到固定 schema。
- 對映 AGENTS 安全不變量:**結構化 intent → 確定性驗證 → 人核准 → audit**——綁定即「結構化 intent 層」。

### 1.2 對應 Stakeholder 訴求

- 既有 Ragic 客戶(如鮮勇):已用自由表單思考;要的是「自己建的採購單 / 銷貨單,系統照樣會過帳、算成本」,而**不必請顧問配剛性規則**。
- 差異化命門|**不在「有算」**(鼎新也有算),**在「算落在用戶自建的自由表單上、且仍不需要工程師」**。

### 1.3 不做的事(scope out)

- **不重寫計算演算法**|GL / 估值 / 成本 / MRP 邏輯是 docs/18 的事;本層只負責「把 record 依語意組成計算輸入 + 把結果寫回」。
- **不做剛性 posting 配置台**|不做「需 ERP 顧問配一堆科目對照矩陣」的傳統 ERP 模式(那正是要避免的反面)。
- **不碰傳票原語**|複式借貸、期間鎖、不可變沖轉由計算層負責;本層只在過帳前驗證 + 傳遞。
- **不自研規則引擎 / 工作流引擎**|決定規則走 GoRules ZEN、觸發長流程走 DBOS(docs/20 已定案),本層只是它們的**組裝與治理層**。

---

## 2. 上游 / 既有現況走查

| 上游 | 狀態 | 與本層關係 |
|---|---|---|
| **docs/15 表單引擎**(Tier-2 動態真實表 + metadata catalog)| ✅ SHIPPED(form-engine-core v1.0)| 綁定的「來源」= form_def / field_def;綁定的 field 引用必走 metadata catalog 白名單(繼承注入防線) |
| **docs/18 計算層演算法** | ✅ 規格(蒸餾)| 綁定的「目標」= 各 calc_kind(過帳 / 沖帳 / 估值 / 成本 / MRP / FX);本層組 facts 餵入、接結果寫回 |
| **docs/20 §2 GoRules ZEN** | ✅ 決策採用 | 綁定的「決定規則」層(科目決定 / 稅率 / 借貸方向 / 驗證)= per-tenant JDM 決策表,no-code 視覺編輯 + 可 AI 提議 |
| **docs/20 §3 DBOS + BullMQ** | ✅ 採用 | 綁定的「觸發後長流程」= 過帳 / 期結 / 對帳走 DBOS durable;batch / MRP kickoff 走 BullMQ |
| **docs/17 AI-native** | ✅ 向上設計 | 綁定的「AI 提議」層(L2):讀 form_def + 樣本 → 提議角色映射 → 人核准 |
| **docs/04 第三支柱「預建表單模板」** | 概念已列 | 綁定的 L0:模板把綁定包好,多數用戶零配置 |

**缺口(本檔補的)**|docs/20 §5 已畫出「表單/計算層 → 規則(ZEN)+ 長流程(DBOS)」的**堆疊圖**,但**「一張具體用戶表單如何宣告它的綁定」從未被當第一級概念設計**(docs/20:58 已承認「過帳規則…你都得自建」)。本檔即定義這個 metadata 與其自助化生成路徑。

---

## 3. 剩餘 scope 切分

| 子題 | 內容 | 備註 |
|---|---|---|
| **A1 綁定 metadata 模型** | `calc_binding` + `binding_role_map` + 語意角色 registry + 版本化 | 地基 |
| **A2 語意角色 + facts 組裝器** | 欄位 ↔ 語意槽映射;record → 計算輸入 facts | L1 自助核心 |
| **A3 決定規則(ZEN)整合** | 科目 / 稅 / 借貸方向 決策表;per-tenant JDM 治理 | 承 docs/20 |
| **A4 觸發 + orchestration** | 狀態轉換 → 計算;一表單多計算之順序 / 原子性 | 承 C 工作流 + DBOS |
| **A5 過帳前驗證(fail-closed)** | 角色齊 / 科目存 / 期間開 / 借貸平 / 冪等 key | 命門安全閘 |
| **A6 自助化階梯** | L0 模板 / L1 角色標記 / L2 AI 提議人核准 / L3 ZEN | 命門約束落地 |
| **A7 綁定治理** | 改綁定 = 特權(SoD)+ 人核准 + audit + 版本快照 | 呼應 v2.7 E SoD |

---

## 4. A1|綁定 metadata 模型

### 4.1 資料模型(概念,Tier-1 固定真實表)

```
calc_binding
  id, tenant_id, form_id(來源表單),
  calc_kind         -- discriminated union: gl_posting | inventory_move | settlement | costing | ...
  trigger           -- { on: 'status_transition', from, to }  (接 C 工作流)
  zen_ruleset_id    -- nullable;A3 決定規則(科目/稅/方向)
  version, state    -- draft | active | retired
  created_by, ...   -- audit

binding_role_map
  binding_id, semantic_role, field_id   -- 欄位 ↔ 語意槽;field_id 走 metadata catalog 白名單
  (unique: binding_id + semantic_role;某些角色可多欄如子表明細)

-- 語意角色 registry:程式碼定義(非用戶自訂),每個 calc_kind 宣告必填/選填角色集
--   gl_posting 必填: amount, account_hint(或由 ZEN 決定), post_date;選填: currency, tax_code, party, cost_center
--   inventory_move 必填: item, qty, warehouse, direction, unit_cost(或由估值算)
```

### 4.2 邏輯

- **綁定 = 宣告式 intent,非程式碼**|`calc_kind` 是 discriminated union → 新增 case 未處理即編譯錯(exhaustiveness)。
- **版本不可變快照**|過帳時把 `binding_version` + `zen_ruleset_version` 快照進所產傳票的來源欄;綁定日後改動**不回溯**已過帳歷史(呼應 docs/18 傳票不可變)。
- **來源引用白名單**|`binding_role_map.field_id` 必為該 form 的合法 field(metadata catalog 驗證),防綁定引用不存在/他表欄位。

### 4.3 UI

- 綁定編輯器**內嵌於表單設計器(S3)**——設計表單時同一畫面「這張表要不要會算?」;不是另開一個 IT 專用後台(反 Ragic 精神)。

---

## 5. A2|語意角色 + facts 組裝器(L1 自助核心)

- **語意角色標記**|用戶在表單設計器對欄位下拉標角色:「金額」「科目提示」「數量」「倉別」「對象(客戶/供應商)」「幣別」「稅別」「過帳日」…。用戶欄位可任意命名(「廠商」/「supplier」皆可),角色是語意層。
- **facts 組裝器**|執行期把 record 依 `binding_role_map` 抽成計算引擎認得的 `facts` 物件(Zod 驗證 shape);金額欄一律以 `numeric`/decimal string 取出(禁 float,docs/18 §0)。
- **必填角色檢查**|依 calc_kind 的 registry,缺必填角色 → 綁定 state 不得 `active`(設計期擋)+ 過帳期 fail-closed(A5)。

---

## 6. A3|決定規則(ZEN)整合

- **科目決定 / 稅 / 借貸方向**走 **GoRules ZEN 決策表**(per-tenant JDM JSON,存 PG,docs/20):輸入 facts(如 品項類別 / 對象 / 稅別)→ 輸出 科目 + 借貸 + 稅額。
- **no-code + AI 綜效**|ZEN 現成視覺編輯器讓非工程師配規則;AI 可**提議**決策表列,人視覺化核准(docs/20 §6 + docs/17 guardrail)。
- **邊界**|ZEN 只算決策(確定性、sandbox、50ms timeout);facts 組裝、輸出套用(產傳票 / 交易 / 過帳)、持久化與 audit 由本層負責——ZEN 不碰 side effect。
- **簡單情形免 ZEN**|固定單科目綁定不需決策表(L1 直接指定);ZEN 只在「依欄位值決定科目 / 稅」時才用(L3)。

---

## 7. 資料模型變動

### 7.1 新增(Tier-1)

`calc_binding`、`binding_role_map`、`zen_ruleset`(per-tenant JDM 存放,若 docs/20 未先建)。皆帶 `tenant_id` + RLS FORCE。

### 7.2 SQL / Migration

Drizzle 固定 schema(非動態 Tier-2);binding 引用的 form 欄位為軟引用(field_id + 白名單校驗),不設硬 FK 到動態表以免耦合 DDL。

### 7.3 RLS / Permission

- 全表 `tenant_id` + RLS FORCE(架構鐵則 3)。
- **改綁定 = 特權操作**|過帳規則影響帳務正確性 → 需高權限 + SoD(建綁定者 ≠ 啟用者,呼應 v2.7 E SoD)+ 每次變更 audit + 人核准。

---

## 7-bis. 企業級 cross-cutting 檢核

### 7-bis.1 安全模型
- **注入**|binding_role_map.field_id 走 catalog 白名單;facts 組裝只讀已驗證欄位,值參數綁定。
- **授權**|過帳由「有權限的人」核准狀態轉換(docs/18);綁定變更為特權 + SoD + audit。
- **AI 載重不變量**|AI 只提議「結構化綁定 intent」(角色映射 / 決策表列),**確定性程式碼驗證 → 人核准 → audit**;AI 絕不直接過帳,絕不決定授權。
- **租戶邊界**|ZEN ruleset、binding 均 tenant-scoped;跨租戶讀不到(隔離測試斷言)。

### 7-bis.2 容量規劃
- 綁定解析 + facts 組裝為每筆過帳一次;metadata(binding / role_map / ruleset)快取 Redis,綁定變更失效。
- 大量過帳(batch / 期結)走 DBOS / BullMQ 背景,不擋請求;ZEN 50ms timeout 需驗證不卡大 MRP(docs/20 待驗項)。

### 7-bis.3 失效模式
- **綁定不完整**|缺必填角色 → 設計期擋 + 過帳期 fail-closed 拒過帳(不靜默略過)。
- **schema 演化破綁定**|用戶刪 / 改被綁定欄位 → binding re-validation 標失效 + 阻擋破壞性 DDL(見 OQ-CBL-3)。
- **部分過帳**|一表單觸發多計算(GL + 庫存 + 成本)→ 單一 tx 全 rollback 或 outbox 保證最終一致(見 OQ-CBL-5)。
- **冪等**|同一 record 同一觸發帶 idempotency key,重試不重複過帳(docs/22 鐵則)。

### 7-bis.4 觀測性
- 每次計算落 audit:binding_version + zen_version + 來源 record id + 產出傳票/異動鏈 + facts 快照。
- 不變量對帳 job:定期斷言「由綁定產出的傳票 Σ借 == Σ貸」「庫存異動帳 == 數量」。

### 7-bis.5 資料生命週期
- 綁定版本化;已過帳歷史引用當時快照,綁定 retire 不刪歷史。
- 傳票不可變(docs/18);綁定改動只影響「未來」過帳。

### 7-bis.6 向後兼容 + Rollout
- 綁定為 opt-in:表單不綁定 = 純 Ragic 表單(現況,零影響)。R1 客戶不受影響。
- 逐 calc_kind 上線(GL 過帳先,估值 / 成本後)。

### 7-bis.7 成本模型
- OSS-only:ZEN(MIT)+ DBOS(自 host,近零 ops);無額外授權。計算成本為 CPU(過帳 / 估值),走背景 worker。

---

## 8. 測試策略

| 層 | 覆蓋 | 位置 |
|---|---|---|
| Vitest(api,Testcontainers 真 PG)| facts 組裝正確性 / 必填角色 fail-closed / 過帳借貸平 / 冪等重試不重複 / 租戶隔離 / 綁定版本快照 | apps/api/test |
| 生成式(fast-check)| 由 form_def + binding 生成隨機 record → 斷言計算輸入 shape 恆正確(客戶無限表單組合)| apps/api/test |
| Vitest(web)| 語意角色標記 UI / 綁定編輯純函式 / AI 提議 diff 呈現 | apps/web |
| Playwright(固化)| 建表 → 標角色 → 設觸發 → 填單核准 → 驗傳票落庫借貸平 | apps/web/e2e |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** 設計 review | 本檔 → APPROVED(裁定 OQ-CBL-1..8)| ⏳ |
| **M1** A1 | 綁定 metadata 模型 + 語意角色 registry + 版本化 | ⬜ |
| **M2** A2 | facts 組裝器 + 必填角色檢查(先服務 GL 過帳)| ⬜ |
| **M3** A3 | ZEN 決定規則整合(科目決定 / 稅 / 方向)| ⬜ |
| **M4** A4 | 觸發(狀態轉換)+ 一表單多計算 orchestration(DBOS)| ⬜ |
| **M5** A5 | 過帳前驗證 fail-closed + 冪等 + audit | ⬜ |
| **M6** A6 | 自助化階梯 L0 模板 / L1 角色標記 UI /(L2 AI 提議依 OQ-CBL-6)/ L3 ZEN 編輯器嵌入 | ⬜ |
| **M7** 收尾 | FMEA + SHIPPED | ⬜ |

> 排序|**GL 過帳為第一 calc_kind**(最合規敏感、最能驗證架構);估值 / 成本 / MRP 之綁定隨 R2 各 ERP 模組上線接入。此模組與 J/K/L/N + 計算層並行,是它們共用的「接法」。

---

## 10. 開放問題(OQ-CBL-N)— ✅ 已裁定(2026-07-19,全採建議)

> 命門總約束(所有 OQ 之答案不得違反)|**綁定必須自助化,逃生門絕不落到寫程式**([[feedback-calc-binding-self-service]])。

| # | 議題 | 選項 | 裁定(全採建議)|
|---|---|---|---|
| **OQ-CBL-1** | 綁定表達層次 | A. 語意角色映射(L1)+ ZEN 決策(L3)分層,簡單情形免 ZEN <br> B. 一律走 ZEN <br> C. 只做固定映射不做條件決定 | **A** — 簡單綁定(單科目)用 L1 零決策表,依欄位值決定科目 / 稅才用 ZEN;兼顧「簡單事簡單做」與「複雜可自助」,不強迫每個綁定都碰決策表 |
| **OQ-CBL-2** | 科目決定機制 | A. ZEN 決策表(輸入品項/對象/稅別 → 科目)<br> B. 表單欄位直接選科目 <br> C. 兩者皆可 | **C** — 預設 B(用戶欄位就標「科目」角色,直接選);進階(依品類自動決科目)用 A(ZEN)。承 OQ-CBL-1 分層精神 |
| **OQ-CBL-3** | 綁定 vs schema 演化 | A. 綁定引用的欄位「受保護」——刪 / 改型別前先解綁或阻擋 <br> B. 允許改,綁定自動標失效需重設 <br> C. 不管 | **A** — 破壞性 DDL(刪被綁定欄 / 改型別)前 re-validation,阻擋或要求先解綁;避免靜默壞帳。呼應 docs/22 不變量 |
| **OQ-CBL-4** | 觸發模型 | A. 綁狀態轉換(status → 過帳),接 C 工作流 <br> B. 獨立事件訂閱 <br> C. 手動按鈕 | **A**(+C 備援)— 主觸發綁狀態機(核准 → 過帳),語意清楚且接既有簽核;保留手動「過帳」按鈕給例外。長流程走 DBOS |
| **OQ-CBL-5** | 一表單多計算原子性 | A. 全同一 tx(GL + 庫存 + 成本一起成敗)<br> B. outbox 最終一致 <br> C. 混合 | **C** — 強一致部分(GL 借貸)同 tx;跨模組副作用(如觸發 MRP)走 outbox / DBOS,crash 不丟(docs/22) |
| **OQ-CBL-6** | AI 提議綁定(L2)時機 | A. R2 就做 <br> B. 延到 R4 AI 進階 <br> C. R2 做唯讀提議、R4 做自動 | **C** — R2 提供 L1 手動 + L2「AI 提議角色映射(唯讀 diff,人核准)」薄層(復用 docs/17 建表助手能力);全自動綁定生成延 R4。避免 R2 過重 |
| **OQ-CBL-7** | 綁定變更權限 | A. 特權角色 + SoD(建 ≠ 啟用)+ 人核准 + audit <br> B. 一般編輯權 | **A** — 過帳規則影響帳務正確,列高風險操作;呼應 v2.7 E 職責分離 SoD |
| **OQ-CBL-8** | 過帳前驗證強度 | A. fail-closed 硬檢查清單(角色齊 / 科目存 / 期間開 / 借貸平 / 冪等 key),任一不過即拒 <br> B. 警告但放行 | **A** — 帳務零容忍,fail-closed;寧可擋住要求補正,不可過出不平的帳 |

---

## 10-bis. 綁定的入口形狀(2026-08-08 由決策方的品牌重設計提出)

**背景**|決策方 2026-08-08 的前端重設計(`docs/mockups/weyver-v3.html` →「公式建構器」)
在欄位元件庫裡放了一組「**營運**」:**過帳科目 / 成本中心 / 庫存估值 / MRP 展開**,
與一般欄位型別並排,**拖進畫布即用**。

### 10-bis.1 這與本檔 A6-L1 是同一目標的兩種機制

| | 本檔原案:**語意角色標記**(§9) | 決策方稿:**營運欄位型別** |
|---|---|---|
| 手勢 | 對**既有欄位**在設定裡下拉標角色 | 從元件庫**拖一個欄位**進來 |
| 可發現性 | 🔴 **低** —— 要先知道有「角色」這個設定,才會去標 | **高** —— 元件庫是使用者本來就會看的地方 |
| 不多一欄 | ✅ 已有「金額」就標它 | ❌ 已有「金額」還拖一個就重複 |
| 解綁 | 需要另一個動作 | **刪掉那個欄位** |

**兩者不互斥。** 本檔 A6-L1 假設了「標記」這個手勢,但**從未論證它比「拖」好** ——
而可發現性正是第一約束的一部分:**做得到但找不到,等於做不到。**

### 10-bis.2 🔴 但「營運」那四項是三類東西,不能放同一組

| 稿子上的東西 | 它其實是 | 適合的形狀 |
|---|---|---|
| **過帳科目 / 成本中心** | **值** —— 哪一個科目 | singleSelect + 語意角色。拖不拖都行 |
| **庫存估值 / MRP 展開** | **行為** —— 「這張表會影響庫存估值」 | 🔴 **那不是欄位,是表單級綁定** |
| 畫布上的「**庫存估值影響**」 | **後果的投影**(唯讀,「移動平均 → NT$ 39.90 / 件」+ 推導式)| 唯讀計算欄 |

把**行為**放進欄位元件庫是**類別錯誤** —— 除非刻意讓它成為一等的東西,見下。

### 10-bis.3 一個可能的解:讓綁定本身成為表單上的一個欄位

拖「庫存估值」進來 = 建立一個**唯讀的後果欄**,而**綁定就是它的存在本身**。於是:

- 綁定**看得見**(不是藏在設定頁的一個開關)
- 綁定**可以刪**(刪掉那一欄 = 解綁)· 可以擺位 · 有權限(沿用欄位級權限)
- 綁定**有位置** —— 出現在單據上它該出現的地方,而不是另一個 IT 後台

⚠️ **這不取代 OQ-CBL-3**:綁定還會引用**其他**欄位(金額 / 數量 / 科目),那些仍需保護。
但它讓「綁定本身」的生命週期回到使用者手上,而不是多一套解綁 UI。

⚠️ **待驗證**:引擎現有的 `lookup` / `rollup` 已經是「**設定出來的虛擬計算欄**」
(`virtual: true` · `systemManaged: true` · 設定放 `optionsSchema`)——
**這個機制能不能直接承載計算層綁定?** 未查證,R2 啟動時先做這一題。

### 10-bis.4 🔴 本檔真正缺的一塊:**後果預覽**

本檔有 L0–L3 自助化階梯,但**全文沒有「預覽 / 後果 / 試算」**(2026-08-08 grep 零命中)。
決策方的稿把它畫出來了:**填單當下**就顯示「這筆會讓移動平均變成 NT$ 39.90 / 件」,
並附推導式「=(既有庫存金額 + 本次金額) ÷(既有數量 + 驗收數量)」。

**為什麼這不是錦上添花**|
自助化解決的是「**我能不能自己綁**」;後果預覽解決的是「**我綁對了嗎**」。
少了後者,自助化只是讓人**更容易綁錯** ——
而帳務綁錯的代價是**過帳之後才發現**,那時已經不可變(AGENTS 鐵則 4:傳票過帳後不刪不改)。

**形狀不用發明,R1 已有三個同型先例**:`convert-type` 的預覽卡
(「將被清空 N / 值會被改變 N」)· `relookup` 的「試算差異 → 套用」·
事件觸發器的「試跑」(拿目前設定空跑一次,不寫入)。

### 10-bis.5 新增待裁定(R2 啟動時處理)

| # | 議題 | 選項 | 傾向(未裁定)|
|---|---|---|---|
| **OQ-CBL-9** | 綁定的入口形狀 | A. 語意角色標記(原案)<br> B. 營運欄位型別(拖)<br> C. 兩者並存:**值**走 A、**行為**走 B | **C** —— 但要先解 10-bis.2 的三類混淆,不能整組照搬 |
| **OQ-CBL-10** | 後果預覽 | A. 填單即時顯示 <br> B. 送出前確認頁 <br> C. 不做 | **A** —— 「所見即後果」與 D1 同源;沿用既有三個先例 |
| **OQ-CBL-11** | 綁定是否即欄位 | A. 綁定 = 一個唯讀後果欄(10-bis.3)<br> B. 綁定是表單設定,與欄位分離 | 未定 —— 先驗 `lookup`/`rollup` 的 virtual 機制能否承載 |

⚠️ **本節不改任何既有裁定**(OQ-CBL-1..8 維持)。它補的是**入口形狀**與**後果可見性**,
那是原案沒有處理的兩個面。

---

## 11. SOP — 日常操作

> M6/M7 收尾時填(使用情境:建綁定 / 改綁定核准流 / 過帳失敗排查 / audit 查詢 binding→傳票鏈)。

---

## 12. 失效場景反思(FMEA)— 收尾必填(R17)

> M7 收尾逐路徑填(過帳觸發 / facts 組裝 / ZEN 決策 / schema 演化 / 並發過帳 / AI 提議)。P0 未緩解不得上 prod。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-19 | v0.1 | 初版 DRAFT — 命門「語意計算綁定層」;A1–A7 切分 + OQ-CBL-1..8;上游 = docs/15 引擎(SHIPPED)+ docs/18 算 + docs/20 ZEN/DBOS + docs/17 AI;自助化四級階梯(L0 模板 / L1 角色 / L2 AI 提議 / L3 ZEN)為命門約束落地;R2 design-ahead,人月內含 R2 計算層預算 | Claude Code |
| 2026-07-19 | v0.2 | OQ-CBL-1..8 全採建議裁定;狀態 DRAFT → APPROVED(R2 design-ahead,M1–M7 待 R2 計算層啟動實作)| Claude Code |
