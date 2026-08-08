# gl.md — [R2·P0-6] 總帳 GL(複式簿記)設計文件

> ✅ **狀態:M0 APPROVED(2026-08-08)— OQ-GL-1..8 全數裁定**(1/2/3/4/7/8 研究錨定自動核准〔AGENTS ✅ 規則,三家一手依據收斂〕;5/6 因懸未查證斷言交裁,均採建議);**design-ahead**(依 docs/35 OQ-R2M-3:深度停在「資料模型 + 不變量 + OQ + R1 預留」,M1–M6 待 R2 啟動;**動工時強制重走查 §2 前提快照 + §0.2 站②對碼**;v1.1 深度補齊後,M0 級未查證已清零 —— M1 殘留:pg numeric 對碼 / 商業會計項目表現行版複驗 / 處理準則對版 / §7-bis 三項實測)
>
> **一句話**|R2 計算層的心臟與全圖匯點(docs/35 §3):K/L/N/O/P/R 的傳票全走同一條 calc-binding → GL pipeline。**分錄 ledger 是全系統唯一「DB 層強制不可變」的資料**——錯了開沖轉,不改不刪(AGENTS 鐵則 4)。
>
> **上游**|docs/18 §1(演算法蒸餾)· docs/20 §4(自研裁定 + TigerBeetle escape hatch)· docs/35(總圖)· R2/calc-binding-layer.md(綁定層 APPROVED)
> 版本:v0.1(2026-08-08)

---

## 0. 站在巨人的肩膀(三站)

### 0.1 站①|自家 repo

| 來源 | 已裁定 / 已知 | 對本模組的約束 |
|---|---|---|
| docs/18 §0 鐵律 | 金額 `numeric` 禁 float / 過帳單一 tx / 期間鎖 / **不可變+沖轉** / 可回溯 | 全數直通 §4 不變量 |
| docs/18 §1 | 科目五類正常餘額表 / 過帳 pseudocode(Σ借=Σ貸+期間開)/ 期結(損益→本期損益→保留盈餘)/ 試算恆等式 | 演算法基準;本檔補 schema 與強制點 |
| docs/20 §4 | **GL 自研於 Postgres**(藍圖 ERPNext+OFBiz;⚠️ 2026-08-03 §5-bis 從嚴後 **ERPNext 只讀公開文件**,可讀原始碼者僅 OFBiz)· TigerBeetle(Apache-2.0)為高交易量 escape hatch | 選型已定,本檔不重議 |
| docs/35(APPROVED)| J.gl 為匯點,各模組不得自帶過帳;共用原語 §4(過帳 pipeline / 期間 / 不可變 journal / 精度 / 三元組 / outbox / 對帳 job)| 共用原語在本模組落地為 `calc-core`,不得重複自建 |
| calc-binding-layer(APPROVED)| 觸發=狀態轉換(OQ-CBL-4)· fail-closed(OQ-CBL-8)· GL 借貸同 tx、跨模組走 outbox(OQ-CBL-5)· **OQ-CBL-9/10/11 待裁(含後果預覽)** | 本模組是綁定層的第一個消費者;過帳前驗證清單(§5)= OQ-CBL-8 的 GL 具體化 |
| R1 現況(2026-08-08 推定,動工對碼)| **P3 表單級不可變語意:無**(記錄可改可刪)· **P7 期間鎖攔截點:無** · P4 currency numeric 精度:**待對碼** · P1 狀態轉換事件:簽核+事件觸發器 SHIPPED,語意粒度待對碼 | docs/35 §5 已裁定 P1–P4 入 R1 backlog;本模組是這四項的需求方 |

### 0.2 站②|相依套件(design-ahead 淺查,M1 對碼)

- **pg / Drizzle 之 `numeric` 回傳為 string**(避免 JS float 失真)——金額在應用層的運算表示(string 直算 / decimal 庫)**未查證,列 M1 第一件對碼事**;禁止任何 `parseFloat` 落點。
- 既有 `form-engine-core` 的 DDL 安全鏈 / RLS provision / `action_audit` 為本模組 Tier-1 表的複用底座(不另造)。

### 0.3 站③|競品(2026-08-08 三路平行研究;OFBiz=讀原始碼,ERPNext=只讀官方文件,Odoo=本地文檔庫 CC BY-SA 不讀 developer/)

> ✅ **承重句逐條親驗(2026-08-08 v1.1,依 [[feedback-verify-load-bearing-claims]] 不採信 subagent 轉述)**|OFBiz 原檔下載後逐句 grep:LICENSE 檔頭 "Apache License Version 2.0" ✓ · ±0.01 容差 `AcctgTransServices.xml` L196/L201 ✓ · SECA 守衛 `secas.xml` L176-181(updateAcctgTrans/deleteAcctgTrans → checkAcctgTransPosted)✓ · 雙金額 `accounting-entitymodel.xml` L1886-1890(amount/currencyUomId/origAmount/origCurrencyUomId/debitCreditFlag)✓ · `GlAccountHistory` L2167-2179(opening/postedDebits/postedCredits/ending)✓ · 沖轉 D↔C 互換 `GeneralLedgerServices.xml` L306-310 ✓ · 期結 PERIOD_CLOSING/RETAINED_EARNINGS L686/L700 ✓。ERPNext 三頁原文抓回比對("keeps the original rows and posts matching reversal rows" / "No role can save or submit the restricted transactions" / "transfers the net balance of income and expense accounts")✓。Odoo 本地 RST 六句 grep 行號在案(year_end L131/L146-150 · data_inalterability L8-14 · credit_notes L18 · taiwan L59 · tax_returns L81)✓。**零反轉** —— 三個研究 agent 的轉述全數與原檔一致。

**OFBiz(Apache-2.0,LICENSE 檔本文複驗 2026-08-08)**——資料模型藍圖:

- [accounting-entitymodel.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/datamodel/entitydef/accounting-entitymodel.xml)|`GlAccount`(`accountCode` unique + `parentGlAccountId` 科目樹)· `AcctgTrans`(`isPosted` 旗標非狀態機;**來源單據用一排 nullable FK 硬連** invoice/payment/shipment…)· `AcctgTransEntry`(**雙金額** `origAmount/origCurrencyUomId` 原幣 + `amount/currencyUomId` 本位幣;`debitCreditFlag` D/C + 金額恆正)
- [AcctgTransServices.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/accounting/minilang/ledger/AcctgTransServices.xml)|過帳前驗證:重複過帳拒 / 試算平衡(**容差 ±0.01 寫死**)/ 單邊全零拒 / transactionDate 落不到期間或期間 `isClosed` 拒;過帳動作只是 `isPosted=Y`
- [secas.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/accounting/servicedef/secas.xml) L176-181|**posted 後 update/delete 由 SECA(service 層)攔** —— 繞過 service 直寫 DB 無防護 → **這是要修的包袱:Weyver 不可變下沉到 DB**
- [GeneralLedgerServices.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/accounting/minilang/ledger/GeneralLedgerServices.xml)|沖轉=整張複製 + **D↔C 互換、金額不變號**;期結=彙總損益類 → 開 `PERIOD_CLOSING` 傳票(科目用 `glAccountTypeId` 間接映射非寫死)→ 逐科目存 `GlAccountHistory`(`openingBalance/postedDebits/postedCredits/endingBalance`)→ `isClosed=Y`;**平時餘額即時彙總分錄,期結才寫快照**
- [AccountingSeedData.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/datamodel/data/seed/AccountingSeedData.xml)|正常餘額由 seed 的 class 樹表達(頂層 `DEBIT`/`CREDIT` 兩棵)——**正常餘額是資料不是程式碼**

**ERPNext(GPL-3.0,只讀 docs.frappe.io,未觸原始碼)**——行為基準:

- [accounting-entries](https://docs.frappe.io/erpnext/user/manual/en/accounting-entries)|"Every posting must balance: total debits equal total credits. ERPNext validates this before a posting document can be submitted."——**單據(form)→ GL Entry(ledger)兩層分離**
- [chart-of-accounts](https://docs.frappe.io/erpnext/user/manual/en/chart-of-accounts)|"Group accounts organize the tree and cannot receive General Ledger entries. Ledger accounts are the final nodes used in transactions."
- [immutable-ledger](https://docs.frappe.io/erpnext/user/manual/en/immutable-ledger-in-erpnext)|"Instead of silently deleting the original ledger effect when a transaction is cancelled, ERPNext keeps the original rows and posts matching reversal rows."·"corrections follow controlled workflows"
- [accounting-period](https://docs.frappe.io/erpnext/user/manual/en/accounting-period)|"No role can save or submit the restricted transactions once the Accounting Period has closed them"(硬鎖);[period-closing-voucher](https://docs.frappe.io/erpnext/user/manual/en/period-closing-voucher)|PCV "transfers the net balance of income and expense accounts to an Equity or Liability closing account";關帳後補帳 → **再開一張 PCV**
- [multi-currency-accounting](https://docs.frappe.io/erpnext/user/manual/en/multi-currency-accounting)|"Do not change an Account's currency after ledger entries exist."
- [accounts-settings](https://docs.frappe.io/erpnext/user/manual/en/accounts-settings)|凍結日 + 例外角色("Role Allowed to Set Frozen Accounts & Edit Frozen Entries")

**Odoo 18(本地 `reference-materials/odoo-docs-18/content/applications/finance/`)**——鎖與年結的差異化設計:

- `reporting/year_end.rst`|**三層鎖**:Lock Everything("prevents modifications to any posted journal entries with an accounting date on or before the lock date… the system automatically sets the accounting date to the day after the lock date",管理員可設例外+記 chatter)· **Hard Lock**("irreversible… cannot be changed or overridden, regardless of access rights")· `reporting/tax_returns.rst` 稅鎖(早於鎖日的交易稅額 "moved to the next open tax period" —— 滾入下期而非拒絕)
- `reporting/year_end.rst`|**年結不做逐科目 closing entry**:"Odoo uses a unique account type called current year's earnings to display the difference between the income and expense accounts."(999999 動態科目)+ 手動 misc entry 分配到權益
- `reporting/data_inalterability.rst`|**SHA-256 hash 鏈**("the previous entry's hash is always added to the next entry… to ensure a new entry is not added afterward between two secured entries";以 sequence prefix 為鏈單位;啟用後不可回頭)
- `customer_invoices/credit_notes.rst`|"Issuing a credit/debit note is the only legal method for canceling, refunding, or modifying a validated invoice."(反向分錄 + `R` 前綴序號互指)
- `fiscal_localizations/taiwan.rst`|**Odoo 有台灣 localization**(`l10n_tw` CoA + ECPay 電子發票 + "The standard tax rate in Taiwan is 5%")——台灣 CoA 預載模板有成例可對照
- `get_started/journals.rst`|六種 journal(Bank/Cash/Credit Card/Sales/Purchase/Miscellaneous),code 作分錄序號前綴

### 0.4 站③-bis|台灣法規一手(2026-08-08 深查;law.moj.gov.tw 全國法規資料庫;§17/§38 已由本檔作者親驗原文)

**商業會計法(pcode=J0080009)**:
- **§17(傳票法定分類,🔴 直接改 schema)**|「記帳憑證,其種類規定如下:一、收入傳票。二、支出傳票。三、轉帳傳票。前項所稱轉帳傳票,得視事實需要,分為現金轉帳傳票及分錄轉帳傳票。」→ 傳票須能對映法定三類(§3 schema `statutory_type`)
- **§18(結轉分錄的法源,🔴 錨定 OQ-GL-5)**|「商業應根據原始憑證,編製記帳憑證,根據記帳憑證,登入會計帳簿。但**整理結算及結算後轉入帳目等事項,得不檢附原始憑證**。」→ 系統自動產生之結轉傳票(無原始憑證)**於法有據**
- **§33**|「非根據真實事項,不得造具任何會計憑證」;**§38(🔴 進不變量)**|「各項會計憑證…至少保存五年。各項會計帳簿及財務報表…**至少保存十年**。」
- §6 曆年制會計年度 · §65 決算於年度終了後二個月內(得延長二個半月)· §68 決算報表承認後責任解除

**商業使用電子方式處理會計資料辦法(pcode=J0080029,🔴 錨定 OQ-GL-6)**:
- §3|內部控制五款(分工 / 權限管理監督 / 軟體變更授權 / 輸入處理輸出核驗 / 備份)確保「安全、正確、**完整性**」
- §5|「記帳憑證及會計帳簿,得經由**權限密碼設定之控制程序替代**負責人、經理人、主辦及經辦會計人員之**簽名或蓋章**」→ posted_by + 授權紀錄即滿足簽章要求
- §6|「如發現錯誤應經審核後輸入更正之,**並作成紀錄**」→ 沖轉 + audit 正是法定「更正作成紀錄」的實作;**全辦法無 hash 鏈 / 技術性不可竄改之明文**(法未指定技術手段)

**商業會計處理準則(pcode=J0080010;⚠️ 版本雙軌:強制適用 110-09-16 版 / 115-07-03 修正版 117-01-01 施行得提前適用,M1 落 CoA 模板時逐條對版)**:
- §14 資產負債表分類(資產:流動/非流動;負債:流動/非流動;權益:資本/資本公積/保留盈餘/其他權益/庫藏股票)· §32 綜合損益表項目
- **§3(客戶自訂科目的法源)**|「本準則所列會計憑證、會計項目、會計帳簿及財務報表,**商業得因實際需要增訂**」;官方標準科目 = 經濟部公告「商業會計項目表」(GCIS 商工行政入口網;屬主管機關公告文件非法條,時效 M1 複驗)

**法規結論**|「系統產生分錄、posted 不可改、錯開沖轉」與法規**零衝突**且三處加分(§33 真實性 / 辦法 §6 更正留痕 / §68 責任解除之可重現性);**唯二新約束**:§17 法定傳票分類、§38 十年保存(租戶刪除時帳務資料單獨保留政策)。出處|[商業會計法](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0080009) · [電子方式辦法](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=J0080029) · [處理準則](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0080010) · [商業會計項目表(經濟部公告)](https://gcis.nat.gov.tw/mainNew/publicContentAction.do?method=showPublic&pkGcisPublicContent=4295)(皆查證 2026-08-08)

**三家收斂 / 分歧(對本設計的裁定素材)**|收斂:①借貸平衡在過帳前強制驗證 ②posted 後不改不刪、更正走反向分錄 ③單據與 ledger 分兩層 ④科目樹 + group/ledger 之別 ⑤雙金額 day-1。分歧:**年結**(OFBiz/ERPNext 產結轉傳票 vs Odoo 動態科目)→ OQ-GL-5;**鎖**(ERPNext 期間硬鎖 vs Odoo 三層軟硬並存)→ OQ-GL-4;**不可變強制**(OFBiz service 層 vs Odoo hash 鏈)→ OQ-GL-6。

---

## 1. 目標與範圍

### 1.1 目標

- 複式簿記 ledger:科目表(CoA)· 傳票 → 分錄過帳 · 期間管理與期結 · 試算表 / BS / PL 基礎報表。
- **與眾模組的接法**:任何模組(含手工傳票)產生分錄**只有一條路**——calc-binding 驗證 → GL 過帳 pipeline(docs/35 不變式)。
- **不可變下沉 DB**:posted 分錄在資料庫層拒絕 UPDATE/DELETE(修 OFBiz 的 service 層包袱)。

### 1.2 不做的事(scope out)

- AP/AR 沖帳 / 帳齡 / 三方比對(J.ap-ar 模組)· FX 期末重估演算法(docs/18 §4,另檔)· 固資折舊(J.fixed-asset)· 營業稅申報(O 模組;**稅鎖**亦隨 O 再議)· 預算 / 合併報表(對標)· 現金流量表(P1)。
- 不自研規則引擎:科目決定 / 借貸方向規則走 ZEN(calc-binding L3)。

## 2. 上游 / 既有現況走查(前提快照 2026-08-08)

| 上游 | 狀態 | 關係 |
|---|---|---|
| form-engine-core / RLS / audit | ✅ SHIPPED | Tier-1 表復用 provision 與稽核底座 |
| 簽核 + 事件觸發器 | ✅ SHIPPED | 傳票核准 → 過帳觸發(P1 語意對碼)|
| calc-binding-layer | ✅ APPROVED(M1–M7 未起;OQ-CBL-9/10/11 待裁)| 過帳的唯一入口 |
| docs/35 R1 預留 P1–P4/P7 | 已入 R1 backlog / 本檔為需求方 | §6 |
| R1 currency 欄位型別 | 待對碼 | P4 |

## 3. 資料模型(Tier-1 固定表;全部 RLS FORCE + tenant_id;金額全 `numeric`)

> 命名沿用引擎慣例;欄位為 M0 形狀,M1 出 migration 前再細校。

```
gl_account(科目)
├─ id · tenant_id · code(租戶內 unique)· name · parent_id(樹)
├─ class:asset|liability|equity|revenue|expense|contra_*(正常餘額由 class→normal_side 映射表推導,資料驅動)
├─ role:none|retained_earnings|current_year_earnings|ar_control|ap_control|fx_gain|fx_loss…(行為映射,期結/自動過帳用 role 找科目,不寫死 code)
├─ is_postable(group 科目不可過帳)· currency_id(可空=本位幣;有分錄後禁改)
└─ status:active|deprecated(已用科目禁刪,只能停用)

gl_journal_entry(傳票 header)
├─ id · tenant_id · entry_no(依 journal_kind 前綴序號)· journal_kind:sales|purchase|bank|cash|misc|closing
├─ transaction_date · period_id · state:draft|posted|reversed(posted 之後只能被沖轉,不回 draft)
├─ statutory_type:income|expense|transfer_cash|transfer_journal(商業會計法 §17 法定傳票分類,v1.1 新增)
├─ source_form_id + source_record_id + calc_binding_id(多型參照,修 OFBiz nullable-FK 包袱)
├─ reversal_of_id(沖轉互指)· idempotency_key(unique,重試不重複過帳)
└─ posted_at / posted_by · description

gl_journal_line(分錄)
├─ entry_id + line_no · account_id(必 is_postable)
├─ debit · credit(兩欄非負,恆一者為零 —— OQ-GL-2)
├─ orig_amount · orig_currency_id · rate(原幣三元組;本位幣即 debit/credit)
└─ party_ref? · dimension?(成本中心等維度,P1 預留欄不啟用)

gl_period(會計期間)
├─ tenant_id · fiscal_year · period_no(1..12;OQ-GL-4 是否留 13th 調整期)
├─ from_date · to_date · state:open|closed|hard_locked(hard_locked 不可逆)
└─ closed_at / closed_by

gl_account_balance(期間餘額快照;期結時寫入,平時餘額=分錄即時彙總 —— OFBiz pattern)
└─ account_id + period_id · opening · debits · credits · ending
```

## 4. 不變量(DB 層強制,不是 service 禮貌)

1. **借貸平衡**|每張 posted entry `Σdebit = Σcredit`(deferred constraint trigger,tx 結束驗)且非全零。
2. **append-only**|`state='posted'` 之 entry 與其 lines:**DB trigger 拒 UPDATE/DELETE**(唯一例外:標記 `reversed` 與對帳狀態欄);更正=沖轉傳票(D/C 互換、金額不變號、互指)。
3. **期間鎖**|`transaction_date` 落於非 `open` 期間 → 過帳拒;已 posted 分錄所在期間 `closed` 後連沖轉都須落在開放期間(後期沖轉,docs/18 鐵律 3)。
4. **精度**|`numeric` + 每幣別小數位(TWD 0 / USD 2);捨入差額歸尾行;**容差 = 0**(不學 OFBiz ±0.01)。
5. **租戶**|RLS FORCE;`weyver_app` 角色無 BYPASSRLS(沿 P0-1)。
6. **冪等**|`idempotency_key` unique;重試回既有結果。
7. **對帳 job**|定期斷言:全帳試算恆平衡 / 快照=分錄重算(AGENTS ⚙️ 不變量對帳)。
8. **法定保存(v1.1)**|posted 帳務資料保存 ≥10 年(商業會計法 §38);租戶刪除 / 回收桶清理政策對 `gl_*` 表**不適用一般 purge**,單獨保留軌(與 I 段 PDPA 資料權利的邊界:帳務屬法定保存例外)。

## 5. 過帳 pipeline(calc-binding OQ-CBL-8 之 GL 具體化;fail-closed,任一不過即拒)

```
validate:綁定 active → 角色映射齊 → 科目存在且 is_postable 且 active
        → 期間 open → Σ借=Σ貸(容差 0)→ 幣別/精度合法 → 冪等 key 未用
post(單一 tx):寫 entry+lines(posted)→ 觸發 outbox(跨模組副作用)→ audit
```

- 手工傳票與系統拋轉走**同一條**(手工傳票=傳票表單模板 + 內建綁定,OQ-GL-1)。
- 過帳前「後果預覽」(試算差異卡)承 calc-binding OQ-CBL-11(待裁),本模組預留唯讀試算 API。

## 6. R1 預留對應(本模組=docs/35 P1–P4/P7 的需求方)

| docs/35 | 本模組用途 | 若缺 |
|---|---|---|
| P1 狀態轉換事件 | 傳票核准 → 過帳觸發 | 回頭改 R1 事件模型 |
| P2 DDL veto hook | 來源表單改欄 → 綁定 re-validation(OQ-CBL-3)| 綁定靜默壞 → 錯帳 |
| P3 表單級不可變 | 傳票表單 posted 後鎖(與 §4.2 DB trigger 成對)| 表單側可改 = 兩面帳 |
| P4 currency numeric | 來源金額欄精度 | 進 ledger 前失真 |
| P7 期間鎖攔截 | 表單側早擋(UX),ledger 側兜底 | 只剩兜底,體驗差 |

## 7. 開放問題(OQ-GL-N)— ✅ 全數裁定(2026-08-08)

> 1/2/3/4/7/8 依「研究錨定=已核准」規則直接落定(依據見 §0.3 逐字引用);**5/6 因建議懸在未查證斷言上交決策方徵詢,均採建議** —— 5 之「台灣會計師期待結轉傳票」與 6 之「台灣無 hash 鏈法規」皆標待驗證,M1 前補查(5 問鮮勇配合會計師;6 併 O 模組合規研究)。

| OQ | 議題 | 建議(=裁定;依據) |
|---|---|---|
| **OQ-GL-1** | **傳票的形態**:A. 傳票=引擎表單(模板)+ 過帳時鏡射寫 Tier-1 ledger;B. 傳票+分錄全 Tier-1 系統表 | **A** —— 「一切皆表單」不破(簽核/權限/附件/列印全復用),而 ledger 獨立成 Tier-1 才能 DB 級不可變;= ERPNext「單據 → GL Entry」兩層("Every submitted accounting transaction… creates balanced debit and credit entries in the General Ledger")。表單=事實來源之敘事層,ledger=法定帳 |
| OQ-GL-2 | 分錄金額表示:debit/credit 兩欄 vs D/C flag+單欄(OFBiz) | **兩欄非負**(ERPNext/Odoo 同;試算 Σdebit=Σcredit 直算,與 docs/18 pseudocode 一致) |
| OQ-GL-3 | 正常餘額:class enum + 映射表(資料驅動) | 採(OFBiz class 樹的簡化;不寫進程式碼分支) |
| **OQ-GL-4** | **期間鎖模型**:單一 closed 旗標(OFBiz)vs 三層(Odoo) | **兩層 MVP**:`closed`(管理員可重開,全程 audit)+ `hard_locked`(不可逆,對齊 Odoo "cannot be changed or overridden");稅鎖留 O 模組。13th 調整期:**不做**,調整分錄落 12 月+journal_kind=closing 區分 |
| **OQ-GL-5** | **年結**:產生結轉傳票(OFBiz PERIOD_CLOSING / ERPNext PCV)vs 動態 current-year-earnings 科目(Odoo) | **混合**:平時 BS 用動態本期損益(report-time,Odoo 式,月結零成本);**年結產生結轉傳票草稿 → 人核准過帳**(損益→本期損益→保留盈餘,科目用 `role` 映射),與 calc-binding「人核准」不變量一致。**🔄 v1.1 依據升級:一手法源找到** —— 商業會計法 **§18 但書「整理結算及結算後轉入帳目等事項,得不檢附原始憑證」明文承認結轉分錄**,系統自動產生於法有據;原「台灣會計師期待」推定不再承重(會計師實務偏好降為 M1 選問) |
| OQ-GL-6 | 不可變強制:DB trigger 之上是否加 SHA-256 hash 鏈(Odoo data_inalterability) | **MVP 只做 DB trigger + audit**;hash 鏈**預留欄位不實作**。**🔄 v1.1 已查證**:電子方式辦法 §3(完整性內控)+ §6(更正留痕)**無 hash 鏈 / 技術性不可竄改明文**(法未指定技術手段)→ hash 鏈是**對稽核的加分項,非法定義務**;辦法 §6 之「更正經審核 + 作成紀錄」反而正面錨定沖轉+audit 設計 |
| OQ-GL-7 | 台灣 CoA 預載模板 | 做(onboarding 模板)。**🔄 v1.1 依據升級**:處理準則 **§3「商業得因實際需要增訂」= 客戶自訂科目的法源**(與表單範式的自助精神同向);分類骨架依準則 §14/§32,科目內容依經濟部「商業會計項目表」自建(公告文件,M1 複驗現行版)——**不抄 Odoo `l10n_tw`**(LGPL 模組資料;l10n_tw 僅作存在證明)。⚠️ 準則版本雙軌(110 強制 / 115 修 117 施行),M1 對版 |
| OQ-GL-8 | TigerBeetle escape hatch 觸發條件 | 明文化:pilot 客群(食品 SMB)分錄量遠低於 PG 瓶頸,**MVP 不接**;僅當單租戶分錄寫入成為實測瓶頸才啟動(docs/20 既有裁定,此處只定觸發條件) |

## 7-bis. GL 設計難題清單(v1.1;一手錨定,實測留 M1 —— 「哪些難題存在」先列出來)

| # | 難題 | 一手依據(2026-08-08)| 我方姿勢 / M1 待實測 |
|---|---|---|---|
| 1 | **熱點科目(hot account)**:少數科目(收入/費用/現金)出現在多數交易,維護即時餘額列 = 高競爭 row lock | TigerBeetle 官方 docs 逐字:"Locks can be used to ensure that updates to these 'hot accounts' are consistent. But the resulting contention can bring the system's performance to a crawl."([concepts/oltp](https://docs.tigerbeetle.com/concepts/oltp/));官方 blog:"these hot rows locked in most transactions, serializing system performance"([2024-07-23](https://tigerbeetle.com/blog/2024-07-23-rediscovering-transaction-processing-from-history-and-first-principles/));LICENSE 複驗 Apache-2.0 | **本設計不維護 balance row(餘額=SUM 分錄 + 期結快照)→ append-only INSERT 無列可爭,結構性避開**;M1 實測驗證併發過帳吞吐;OQ-GL-8 escape hatch 觸發條件不變 |
| 2 | **deferred constraint trigger 的排隊成本**:借貸平衡於 tx 結束驗 = 每列 queue 一次 AFTER ROW trigger | PG 官方:"they are said to be _deferred_… not checked until transaction commit"([CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html) / [SET CONSTRAINTS](https://www.postgresql.org/docs/current/sql-set-constraints.html));限制:"Constraint triggers must be `AFTER ROW` triggers on plain tables";⚠️ "evaluation of the `WHEN` condition is not deferred" | 可行性成立;M1 實測大批分錄(千行傳票)之 per-row 排隊成本,備案=statement 級驗證於 service 層 + trigger 兜底 |
| 3 | **append-only 大表聚合成本**:餘額=SUM(分錄) 能撐多久 | PG 官方:index-only scan "will be a win only if a significant fraction of the table's heap pages have their all-visible map bits set"、"tables in which a large fraction of the rows are unchanging are common enough to make this type of scan very useful"([Index-Only Scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html));BRIN "designed for handling very large tables in which certain columns have some natural correlation with their physical location"([BRIN](https://www.postgresql.org/docs/current/brin.html)) | 分錄表正是 "rows unchanging" 理想型;**SUM 成本無官方量化 → M1 實測**(參 dynamic-permissions 30 萬列實測範式);⚠️ insert-only 表的 autovacuum 觸發(visibility map 維護)M1 一併驗;transaction_date BRIN 候選 |

## 8. 測試策略(M1+ 展開;此處定鐵則)

- 不變量全部要有**繞過 service 直打 DB** 的負向測試(posted UPDATE/DELETE 被 trigger 拒)——OFBiz 包袱的教訓。
- 生成式:任意合法傳票集 → 試算恆平衡(fast-check);跨租戶隔離(A 過帳 B 讀不到)沿既有 e2e 模式。

## 9. 落地順序(依 docs/35 §6;R2 啟動後)

M1 schema+migration+對碼(§0.2 numeric 表示 / P1–P4 實況)→ M2 CoA+模板 → M3 過帳 pipeline+不可變 → M4 期間+期結 → M5 報表 → M6 手工傳票表單+綁定。FMEA 依 R17 於收尾必填(§12 template)。

## 13. 變更紀錄

- **2026-08-08 v1.1**|**深度補齊三塊(決策方裁定)**:(a) **承重句逐條親驗**(§0.3 註記)—— OFBiz 原檔 grep(±0.01 L196/201 · SECA L176-181 · 雙金額 L1886-1890 · GlAccountHistory L2167-2179 · D↔C L306-310 · PERIOD_CLOSING L686/700)+ ERPNext 三頁原文比對 + Odoo 六句行號 + 法條 §17/§38 原文,**零反轉**;(b) **§0.4 台灣法規一手深查**(商業會計法 / 電子方式辦法 / 處理準則)—— **兩條改設計**(§17 法定傳票分類 → schema `statutory_type`;§38 十年保存 → 不變量 8 保留政策)、**三條升級 OQ 依據**(§18 但書錨定年結結轉傳票 / 辦法無 hash 鏈明文 / 準則 §3 自訂科目法源),原「未查證」二筆全數清掉;(c) **§7-bis 設計難題清單**(TigerBeetle hot-account 逐字 + PG deferred trigger / index-only scan / BRIN 官方文件),實測項明列留 M1。
- **2026-08-08 v1.0**|OQ-GL-1..8 全數裁定 → **M0 APPROVED**(1/2/3/4/7/8 研究錨定自動核准;5 年結混合案、6 hash 鏈預留不實作 經徵詢採建議)。遺留待驗證兩筆:台灣結轉傳票慣例(問會計師)、hash 鏈法規(併 O 模組)。
- **2026-08-08 v0.1**|M0 首版(design-ahead)。三站研究:OFBiz 原始碼(LICENSE 複驗 Apache-2.0;entity/過帳/沖轉/期結逐檔)+ ERPNext 官方文件(Immutable Ledger / PCV / 期間硬鎖;未觸原始碼)+ Odoo 本地文檔(三層鎖 / 動態年結 / hash 鏈 / l10n_tw)。資料模型五表 + 七不變量(不可變下沉 DB,修 OFBiz service 層包袱;容差 0 不學 ±0.01)+ 過帳 pipeline + R1 預留對應 + OQ-GL-1..8。
