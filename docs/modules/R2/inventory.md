# inventory.md — [R2·P0-7] K 進銷存與庫存估值 設計文件

> ✅ **狀態:M0 APPROVED(2026-08-08)— OQ-INV-1..9 全數裁定**(1/2/3/7/8/9 研究錨定自動核准;4/5/6 交裁均採建議);**design-ahead**(docs/35 OQ-R2M-3:深度停在「資料模型 + 不變量 + OQ + R1 預留」,M1+ 待 R2 啟動;動工時強制重走查 §2 前提快照;M1 殘留:pg numeric/單位換算對碼 · COGS 出貨認列與 gl 年結同批問會計師 · §7-bis 三項實測)
>
> **一句話**|採購 / 銷貨 / 庫存單據全是引擎上的表單;**庫存異動 ledger(append-only)是估值的唯一真相源**,估值(加權 / 移動平均 / FIFO)由計算層逐筆維護並經 calc-binding 過帳 GL(收貨借存貨、出貨認列 COGS)。**估值方法白名單直接錨定台灣稅法**(所得稅法 §44)。
>
> **上游**|docs/18 §2.3 / §3(三方比對 + 三法演算法)· docs/35(K 依賴 J.gl;與 M 批號介面)· R2/gl.md(過帳鏡射範式)· calc-binding-layer
> 版本:v0.1(2026-08-08)

---

## 0. 站在巨人的肩膀(四站 + 親驗,AGENTS〈🔴 深度研究鐵則〉)

### 0.1 站①|自家 repo

| 來源 | 已裁定 / 已知 | 約束 |
|---|---|---|
| docs/18 §3 | 三法演算法(加權平均=定期 / 移動平均=永續逐筆 / FIFO=成本層 queue);「估值與 GL 連動…是計算層典型職責(表單存不了)」 | 演算法基準 |
| docs/18 §2.3 | 三方比對(PO↔GRN↔發票,容差內放行付款)| 資料在 K,付款放行歸 J.ap-ar(§1.2)|
| R2/gl.md(M0 APPROVED)| **「單據=表單 + 鏡射 Tier-1 ledger」範式**(OQ-GL-1)· 過帳 pipeline / 期間鎖 / 冪等 / 不可變 DB trigger | 本模組照搬同一範式於庫存 ledger |
| docs/35 | K 邊界 `procurement`+`sales`+`inventory`;M 模組管批號主檔 / 效期 / 追溯;P 關稅→進貨成本;共用原語不重建 | §1.2 邊界 |
| docs/04 v2.8 K | 採購收貨 5 · 三方比對 1 · 銷貨出貨 5 · 庫存 7 · 信用額度 2 · AI 抽單 3(=33)| scope 上限 |
| R1 現況(推定,動工對碼)| 數量/單位欄位精度、單位換算(docs/35 原語 6)未起;子表(單身)已 SHIPPED | P4′ 對碼 |

### 0.2 站②|相依套件(design-ahead 淺查,M1 對碼)

- 同 gl.md §0.2:pg `numeric` 應用層表示 M1 對碼;數量亦為 `numeric`(fixed-point,OFBiz 同)。
- 既有匯入管線(import-to-existing-form)= 期初庫存 / 期初成本層的載入路徑(Q 匯入 uplift 共用)。

### 0.3 站③|競品(2026-08-08 三路平行;OFBiz=原始碼,ERPNext=只讀官方文件,Odoo=本地文檔庫)

> ✅ **承重句親驗(2026-08-08)**|OFBiz 原檔 grep:InventoryItem 欄位 L1967-1977(expireDate/lotId/QOH/ATP/accountingQuantityTotal)✓ · InventoryItemDetail 三軸 diff L2134-2136 ✓ · 兩型 seed `ProductSeedData.xml` L436-437(SERIALIZED/NON_SERIAL)✓ · CostServices.groovy L483 TODO「handle …WEIGHTED_AVG_COST and MOVING_AVG_COST」(只有 SIMPLE_AVG_COST)✓ · GL 層耗用 COGS_FIFO/COGS_LIFO 按 `datetimeReceived` 排序 L1063-1067 ✓。ERPNext 原文比對:"accounting entry is done for every stock transaction" ✓ · "Once the Item is saved, the Valuation Method cannot be changed" ✓ · repost "Recalculates…from a specific point in time" ✓。Odoo 本地行號:`inventory_valuation_config.rst` L21(perpetual real-time journal entries)/ L325(Anglo-Saxon:COGS "only recorded as an expense when a customer is invoiced")✓ · `expiration_dates.rst` 四日期欄 ✓ · `fefo.rst` L5-6("targets products for removal based on their assigned removal dates")✓。法條 §44/§51/§46 逐字全文親驗 ✓(見 §0.4)。**零反轉**。

**OFBiz(Apache-2.0,LICENSE 本文複驗 2026-08-08)**:
- **`InventoryItemDetail` = 單一 append-only 明細帳,三軸 diff**(`quantityOnHandDiff` / `availableToPromiseDiff` / `accountingQuantityDiff`)+ 每筆帶單據 FK(order/shipment/return/receipt/physicalInventory)完整回溯([product-entitymodel.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/datamodel/entitydef/product-entitymodel.xml) L2128-2160)—— 總量是 diff 的累計,**ATP/QOH 用同一本帳的不同欄分開累計**(預留降 ATP 不動 QOH,出庫才動 QOH)
- **收貨即成本層**:每次收貨產生一筆 `InventoryItem`(自帶 `unitCost`),FIFO 不需另建 layer 表;GL 過帳層按 `datetimeReceived` 升/降序逐層吃量([GeneralLedgerServices.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/accounting/minilang/ledger/GeneralLedgerServices.xml) L997-1130)
- 平均成本**只有 SIMPLE_AVG_COST**,原始碼 TODO 承認 WEIGHTED/MOVING 未做([CostServices.groovy](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/product/src/main/groovy/org/apache/ofbiz/product/product/cost/CostServices.groovy) L483);Lot 貧血(4 欄)、效期雙處存 —— **包袱不學**
- 序列化品=一件一筆 InventoryItem(`SERIALIZED_INV_ITEM`/`NON_SERIAL_INV_ITEM`,[ProductSeedData.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/datamodel/data/seed/ProductSeedData.xml) L436-437)—— 量大時退貨路徑複雜,**序號品 MVP 不做一件一筆**(對標再議)

**ERPNext(GPL-3.0,只讀 docs.frappe.io)**:
- [Perpetual Inventory](https://docs.frappe.io/erpnext/user/manual/en/perpetual-inventory)|"accounting entry is done for every stock transaction";收貨**借存貨、貸過渡科目** "Stock Receipt But Not Billed"(發票到才沖 = GR/IR)、出貨時 "an equal amount is debited to the expense account 'Cost of Goods Sold'"
- [Repost Item Valuation](https://docs.frappe.io/erpnext/user/manual/en/repost-item-valuation)|**回溯異動 → 背景重算後續 SLE + GL**("from a specific point in time"、"processed in the background by scheduled jobs";警告勿對已關帳年度 repost)—— **回溯重算是必要機制不是選配**
- [Stock Settings](https://docs.frappe.io/erpnext/user/manual/en/stock-settings)|"Once the Item is saved, the Valuation Method cannot be changed"(另頁稱 FIFO→MA 單向可換 —— 兩頁矛盾照實記,我方裁定見 OQ-INV-3);"Allow Negative Stock has removed for Serial / Batch Items from version 15"
- [負庫存估值扭曲](https://docs.frappe.io/erpnext/stock-adjustment-cogs-with-negative-stock)|負庫存下收貨以舊估值入帳、差額進 Stock Adjustment,事後 repost 修 —— **負庫存的代價是估值失真 + 修帳**
- [Serial and Batch Bundle](https://docs.frappe.io/erpnext/serial-and-batch-bundle)|出庫揀選 "Pick Serial / Batch Based On: FIFO / LIFO / **Expiry**"(= FEFO 存在)

**Odoo 18(本地 `content/applications/inventory_and_mrp/`)**:
- `inventory_valuation_config.rst` L21|"perpetual (automatic) inventory valuation creates real-time *journal entries*";automated 四科目組(Stock **Valuation** / **Input** / **Output** Account + Stock Journal);切換成本法警告 "highly recommended to consult an accountant first",既有庫存**保留原值**
- 同檔 L325|**Anglo-Saxon vs Continental**:COGS "only recorded as an expense when a customer is invoiced"(Anglo)vs "as soon as a product is received into stock"(Continental)—— 台灣制度取向見 OQ-INV-6
- `expiration_dates.rst`|**效期四日期欄**:Expiration / Best Before / **Removal** / Alert(收貨日+天數推算,可覆寫);`removal_strategies/fefo.rst`|FEFO 依 **removal date**(≠ expiration date)揀貨 —— 批號效期模型歸 M 模組,此為 M 的先行證據
- `landed_costs.rst`|到岸成本五種分攤(Equal / Qty / Current Cost / Weight / Volume)—— P 模組關稅介面(對標)

**收斂 / 分歧**|收斂:①異動 ledger(SLE / InventoryItemDetail / SVL)與單據分層,append-only ②永續=異動即過帳(收貨借存貨)③批號+效期+FEFO 是食品業標配 ④回溯要 repost。分歧:負庫存(ERPNext 可開但示範了代價 / Odoo 未明文)→ OQ-INV-5;COGS 時點(Anglo vs Continental)→ OQ-INV-6;FIFO 層(OFBiz 收貨即層 vs 獨立 layer 表)→ OQ-INV-4。

### 0.4 站④|台灣法規一手(law.moj.gov.tw;§44/§51/§46 已親驗逐字全文)

- **所得稅法 §44(pcode=G0340003)**|「存貨之估價,以實際成本為準;成本高於淨變現價值時,納稅義務人得以淨變現價值為準,跌價損失得列銷貨成本…第一項成本,得按存貨之種類或性質,採用**個別辨認法、先進先出法、加權平均法、移動平均法**或其他經主管機關核定之方法計算之。」——**現行條文無 LIFO**(97 年版列有「後進先出法」,98.5.27 修正刪除,舊條文對照確認)→ **估值方法白名單的法源**
- **所得稅法施行細則 §46(G0340004)**|五法逐款定義(含零售價法);末項:「採**先進先出法或移動平均法**者,**應採用永續盤存制**。」→ **方法 × 盤存制連動驗證**
- **營利事業所得稅查核準則 §51(G0340051)**|「**在同一會計年度內,同一種類或性質之存貨不得採用不同估價方法**。」§50 但書:「以成本與淨變現價值孰低為準估價者,**一經採用不得變更**。」→ **年度中途換法阻擋 + 變更僅年度交界生效**
- **查核準則 §101(盤損)**|商品盤損科目「僅係對於存貨採**永續盤存制**或經核准採零售價法者適用」;「事實發生後**三十日內**檢具清單報請該管稽徵機關調查,或經會計師盤點並提出查核簽證報告」;無證明文件者盤損率 **1% 以下**得認定 → **盤點單據需日期戳 + 盤損率自動計算 + 報備期限提示**
- **商業會計處理準則 §15(J0080010)**|存貨定義 + 「存貨應以**成本與淨變現價值孰低**衡量…沖減金額應於發生當期認列為銷貨成本」→ 期末 NRV 評價(跌價損失入銷貨成本)列 P1
- 營業稅法(進貨憑證 / 銷貨開立)→ **O 模組範圍**,此處不涉
- ⚠️ 「方法變更須事前報准」**現行條文查無明文**(可能為舊法,誠實標注;不作承重)

出處|[所得稅法 §44](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340003&flno=44) · [施行細則 §46](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340004&flno=46) · [查核準則 §50/§51/§101](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340051&flno=51) · [處理準則 §15](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=J0080010&flno=15)(皆查證 2026-08-08)

---

## 1. 目標與範圍

### 1.1 目標

- 採購(PO→收貨)/ 銷貨(SO→出貨)/ 庫存(異動 / 調撥 / 盤點)單據 = 引擎表單;**庫存異動 ledger = Tier-1 append-only**(gl.md 範式)。
- 估值三法(加權平均 / 移動平均 / FIFO)逐筆維護;永續制異動經 calc-binding 過帳 GL。
- 盤點差異單據含台灣稅法要件(§101:日期戳 / 盤損率 / 30 日報備提示)。

### 1.2 不做的事(scope out)

- **批號主檔 / 效期四日期 / FEFO / 追溯圖**|M 模組(本模組異動列**帶 `batch_ref` 欄**,FEFO 揀貨建議消費 M 的 removal date)
- **三方比對的付款放行**|J.ap-ar(本模組供 PO / GRN 資料與比對 API)
- **關稅 / 到岸成本分攤**|P 模組(成本層預留 `landed_cost_adj` 掛點,對標)
- 信用額度擋單|本模組僅定介面(SO 確認前 ZEN 規則查 AR 餘額,P1-C 落地)
- 儲位 / 序號一件一筆 / WMS 揀貨路徑|P1-C 之後;NRV 孰低期末評價|P1
- 生產領退料|L 模組(消費本模組 ledger API)

## 2. 上游 / 既有現況走查(前提快照 2026-08-08)

| 上游 | 狀態 | 關係 |
|---|---|---|
| R2/gl.md | ✅ M0 APPROVED | 過帳目的地;GR/IR 過渡科目 role 需在 gl_account.role 增列(gr_ir / inventory / cogs / stock_adjustment)|
| calc-binding-layer | ✅ APPROVED(M 未起)| 異動→過帳的唯一通道 |
| M 品保批次追蹤 | ⬜ 未開 M0 | `batch_ref` 介面先行(§3);M 開檔時對齊 |
| 簽核 / 事件觸發器 / 子表 | ✅ SHIPPED | 單據表單復用;P1(狀態轉換事件)同 gl |
| R1 匯入機制 | ✅ SHIPPED | 期初庫存 / 期初成本層載入 |

## 3. 資料模型(Tier-1;RLS FORCE + tenant_id;金額與數量全 `numeric`)

```
inv_move(庫存異動 ledger,append-only —— SLE/InventoryItemDetail/SVL 三家收斂)
├─ id · tenant_id · item_ref(form+record)· warehouse_ref · batch_ref?(M 模組主檔)
├─ move_kind:receipt|issue|adjust_in|adjust_out|transfer_in|transfer_out|return_in|return_out
├─ qty_delta(基準單位,正負號)· occurred_at(業務時點)· posted_at
├─ unit_cost · cost_amount(= 估值引擎回填;定期加權制期末回填)
├─ source_form_id + source_record_id + calc_binding_id(多型參照,同 gl)
├─ gl_entry_id?(永續制過帳互指)· idempotency_key(unique)
└─ reversal_of_id(沖轉互指;posted 後不改不刪,DB trigger 同 gl 範式)

inv_balance(item×warehouse[×batch] 即時量,衍生快取 —— 可由 ledger 重建,對帳 job 斷言)
└─ qty_on_hand · qty_reserved(P1 預留欄,MVP 不啟用)· avg_cost(移動平均制的現行均價)

inv_cost_layer(FIFO 成本層;僅 FIFO 品項)
├─ item_ref × warehouse_ref [× batch_ref] · received_at · qty_original · qty_remaining · unit_cost
└─ source_move_id(收貨異動互指)· landed_cost_adj?(P 模組掛點,對標)

inv_valuation_policy(估值政策)
├─ tenant_id · item_class_ref(§51「種類或性質」的落點:品項分類層)· method:weighted_avg|moving_avg|fifo
├─ inventory_system:perpetual|periodic(§46 連動:fifo/moving_avg → 強制 perpetual)
└─ effective_fiscal_year · changed_by/at + 前後方法(審計軌跡;僅年度交界生效)

盤點單 / 調撥單 / 收貨單 / 出貨單 = 表單(模板),確認後鏡射寫 inv_move
盤點差異:count_date · 盤損率(自動算)· 報備期限(count_date+30 天,§101)
```

## 4. 不變量

1. **append-only**|`inv_move` posted 後 DB trigger 拒 UPDATE/DELETE;更正=反向異動(同 gl 範式)。
2. **量值一致**|`inv_balance` = Σ ledger(對帳 job 斷言,漂移告警);餘額是**衍生**,ledger 是真相。
3. **估值方法白名單**|`method` 僅 §44 四法中的三法(LIFO 不存在於 enum);**FIFO/移動平均 → `inventory_system` 強制 perpetual**(施行細則 §46,DB CHECK)。
4. **年度內不換法**|`inv_valuation_policy` 變更僅允許 `effective_fiscal_year` = 未來年度(§51);全程審計。
5. **成本層守恆**|FIFO:Σ layer.qty_remaining = balance.qty_on_hand(對帳 job);出庫扣層與 COGS 過帳同一 tx。
6. **期間鎖跟隨 GL**|永續制過帳受 gl_period 鎖;`occurred_at` 落非開放期間之異動拒(回溯規則見 OQ-INV-4)。
7. **冪等 / 租戶 / 精度**|同 gl 範式(idempotency_key unique / RLS FORCE / numeric + 每幣別小數位;數量精度依品項單位)。

## 5. 估值與過帳(與 calc-binding / gl 的接法)

```
永續制(perpetual;fifo/moving_avg 必選,weighted_avg 亦可選用):
  收貨確認 → inv_move(receipt)→ 估值引擎(建層/更新均價)→ calc-binding →
    GL:借 存貨(role=inventory)/ 貸 GR-IR 過渡(role=gr_ir;發票到由 J.ap-ar 沖)
  出貨確認 → inv_move(issue)→ 估值引擎(FIFO 吃層 / 均價出)→ calc-binding →
    GL:借 COGS(role=cogs)/ 貸 存貨 —— 出貨即認列(OQ-INV-6)
定期制(periodic;僅 weighted_avg):
  平時只記量;期末 close 流程算加權均價 → 回填 cost_amount → 一張彙總過帳(人核准,同 gl 年結範式)
盤點:盤點單確認 → adjust 異動 → 差異過帳(role=stock_adjustment)+ 盤損率/報備期限標記
回溯:僅開放期間內允許;觸發背景 repost(重算受影響 SLE 尾段 + GL 以沖轉重過)→ OQ-INV-4
```

## 6. R1 預留對應

同 gl.md §6(P1 狀態轉換事件 / P2 DDL veto / P3 表單級不可變 / P4 numeric)全數適用;另加:
- **P4′ 數量與單位換算**(docs/35 原語 6):採購單位↔庫存基準單位;`qty_delta` 一律基準單位,換算在表單層 —— R1 單位欄位型別待對碼。

## 7. 開放問題(OQ-INV-N)

| OQ | 議題 | 建議(依據)| 裁定 |
|---|---|---|---|
| OQ-INV-1 | 兩層形態:單據=表單 + 異動=Tier-1 ledger 鏡射 | 採(gl OQ-GL-1 同範式;SLE / InventoryItemDetail / SVL 三家收斂)| ✅ 研究錨定 |
| OQ-INV-2 | 估值方法範圍:加權平均(定期)+ 移動平均 + FIFO;**LIFO 不做**;個別辨認法留序號品對標 | 採(§44 白名單親驗;LIFO 2009 刪除;OFBiz 連均價都只做 simple 的教訓=範圍寧小勿假)| ✅ 研究錨定 |
| OQ-INV-3 | 方法綁定層級與變更:綁**品項分類**(§51「種類或性質」)· 年度中途禁換 · 變更僅未來年度生效 + 審計軌跡 | 採(§51/§50 親驗;ERPNext「saved 後不可換」的簡化版被其自家另頁打臉 → 我方用法規時點規則取代「永遠不可換」)| ✅ 研究錨定 |
| **OQ-INV-4** | **回溯異動與 repost**:允許到什麼程度? | **建議**:`occurred_at` 限開放期間;回溯插入 → 背景 repost(重算該品項該倉自插入點後的估值尾段;GL 差額以沖轉補過,不改原分錄)—— ERPNext 證明 repost 是必要機制("from a specific point in time"、背景 job),我方差異=GL 端守不可變(沖轉補差,非改帳)。**成本不小,列 K 內最大單一工程風險** | ✅ 採建議(2026-08-08 裁定)|
| **OQ-INV-5** | **負庫存政策** | **建議:一律禁止(fail-closed)**——ERPNext 示範了代價(估值失真+Stock Adjustment 修帳+repost),且其 v15 已對批號/序號品移除負庫存;食品業批號場景負庫存=追溯斷鏈。實務「先出貨後補單」用**草稿異動+補收貨排序**解,不開負庫存後門 | ✅ 採建議(2026-08-08 裁定)|
| OQ-INV-6 | COGS 認列時點 | **出貨確認即認列**(永續制;ERPNext 同)。⚠️ 不採 Odoo Anglo-Saxon「開發票才認列」—— 但「台灣中小企業實務以出貨認列為主流」屬推定**未查證**(不承重;與 gl OQ-GL-5 同批問會計師)| ✅ 採建議(2026-08-08 裁定;M1 前驗證)|
| OQ-INV-7 | 批號邊界:K 異動帶 `batch_ref`,批號主檔/效期/FEFO 歸 M | 採(docs/35 既定邊界;Odoo 效期四日期欄+FEFO 為 M 的先行證據,已存 §0.3)| ✅ 研究錨定 |
| OQ-INV-8 | 預留/ATP:MVP 只 QOH;`qty_reserved` 欄預留不啟用 | 採(OFBiz 證明同一 ledger 加 diff 欄可後補;食品 SMB pilot 無搶貨場景 —— 後半句為推定,標註)| ✅ 研究錨定(架構)|
| OQ-INV-9 | GR/IR 過渡科目(收貨≠發票時間差) | 採(ERPNext "Stock Receipt But Not Billed" 逐字;gl_account.role 增列 gr_ir/inventory/cogs/stock_adjustment)| ✅ 研究錨定 |

## 7-bis. 設計難題清單(一手錨定,實測留 M1)

| # | 難題 | 依據 | 姿勢 |
|---|---|---|---|
| 1 | **repost 的爆炸半徑**:一筆回溯收貨 → 該品項後續所有出庫 COGS 全變 | ERPNext repost 背景 job + 勿碰已關年度警告(§0.3)| 限開放期間 + 尾段重算 + GL 沖轉補差;M1 實測長尾段 repost 耗時 |
| 2 | **FIFO 層競爭**:高頻出庫並行吃層(qty_remaining 遞減)是天然熱點列 | gl §7-bis TigerBeetle hot-row 同型 | 出庫扣層走 per-item advisory lock(P0-1 DDL 鏈已有 advisory lock 範式);M1 實測併發出庫 |
| 3 | **定期加權的期末依賴**:cost_amount 期末才回填 → 期中報表無成本 | docs/18 §3.1(期末統一計)| 期中顯示「暫估(上期均價)」並標示;期末 close 回填 |

## 8. 測試策略(鐵則)

同 gl §8(繞過 service 直打 DB 的負向測試 / 生成式:任意異動序列 → Σlayer=QOH、balance=Σledger / 跨租戶隔離);另加:**三法各自的黃金案例組**(docs/18 §3 演算法逐例)+ 負庫存拒絕路徑 + 年度換法阻擋。

## 9. 落地順序(R2 啟動後;依 docs/13 P0-7 / P1-C)

M1 schema+對碼 → M2 ledger+balance+不變量 → M3 估值三法+黃金案例 → M4 單據表單模板+綁定(收貨/出貨/盤點)→ M5 GL 整合(GR/IR+COGS)→ M6 repost。FMEA 收尾必填(R17)。

## 13. 變更紀錄

- **2026-08-08 v1.0**|OQ-INV-1..9 全數裁定 → **M0 APPROVED**(1/2/3/7/8/9 研究錨定自動核准;4 回溯限開放期間+背景 repost、5 負庫存一律禁止、6 COGS 出貨即認列 經徵詢採建議)。親驗補完(ERPNext "Recalculates" / Odoo fefo.rst L5-6),四站全數零反轉。
- **2026-08-08 v0.1**|M0 首版(design-ahead,首份按〈🔴 深度研究鐵則〉四站+親驗走完的 M0)。四站研究:OFBiz 原始碼(InventoryItemDetail 三軸 diff append-only / 收貨即成本層 / 均價只做 simple 的 TODO)+ ERPNext 官方文件(perpetual 過帳鏈 / GR-IR / repost 必要性 / 負庫存代價)+ Odoo 本地文檔(SVL 四科目組 / Anglo vs Continental / 效期四日期+FEFO)+ **台灣稅法一手**(§44 白名單無 LIFO / §46 FIFO·移動平均強制永續制 / §51 年度內不換法 / §101 盤損 30 日+1%)。資料模型四表 + 七不變量(三條直接由法條推出)+ 估值過帳管線 + OQ-INV-1..9(六條研究錨定自動核准,三條交裁)。
