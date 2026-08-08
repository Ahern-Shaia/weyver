# manufacturing.md — [R2·P0-7/P1-D] L 生產(BOM / 工單 / 簡易 MRP / 委外加工)設計文件

> ✅ **狀態:M0 APPROVED(2026-08-08)— OQ-MFG-1..8 全數裁定**(1/2/3/5/6/8 研究錨定自動核准;4/7 交裁均採建議);**design-ahead**(docs/35 OQ-R2M-3;動工時強制重走查 §2 前提快照;M1 殘留:委外「原料我出」台灣實務問 pilot 客戶 · 快照/狀態機/numeric 對碼 · §7-bis 三項實測)
>
> **一句話**|BOM / 工單 / 委外單全是引擎表單;**L 不自帶任何庫存帳** —— 領退料 / 完工入庫 / 委外發料收回全部鏡射 K 的 `inv_move`,MRP 是讀表單真實表的純計算(產出=建議草稿,人核准才轉單)。**工單回報欄位直接對映台灣法定「生產日報表」**(帳簿辦法 §2),超耗差異報表是查核準則 §58 兩級制的證據鏈。
>
> **上游**|docs/18 §7(MRP:LLC / 多階展開 / 淨需求 / 前置期偏移)· docs/35(L 依賴 K;N 依賴 J+K+L;MES=T 模組 R3)· R2/inventory.md(ledger API)· R2/gl.md · calc-binding
> 版本:v0.1(2026-08-08)

---

## 0. 站在巨人的肩膀(四站 + 親驗)

### 0.1 站①|自家 repo

| 來源 | 已知 / 已裁定 | 約束 |
|---|---|---|
| docs/18 §7 | MRP 演算法蒸餾:低階碼 LLC / 多階展開 / 淨需求 / 前置期偏移;§9:MRP 寫「計畫單(草稿)」via 引擎 API | 演算法基準;產出=草稿 |
| R2/inventory.md(APPROVED)| `inv_move` ledger / 負庫存禁止 / 倉庫=表單記錄 | **L 的所有庫存動作走 K,零新 ledger** |
| R2/gl.md(APPROVED)| 過帳範式;工單成本結轉歸 N(docs/18 §5.2)| L 只記量與事實,成本計算歸 N |
| docs/34 | ISA-95:ERP=L4 / MES=L3;**工單=L(計畫/發放/完工回報),現場逐站報工/SCADA=T(R3)**;APS 無 JS/TS CP-SAT 待獨立 M0 | 排程只做前置期回推,不做產能 |
| **linkload 模組(R1 SHIPPED)** | **自家已有循環偵測先例(Tarjan)** —— link 圖防循環已解過一次 | BOM 防循環復用同範式,不重發明 |
| Link&Load 快照(R1 SHIPPED)| lookup snapshot 機制已存在 | 工單抓 BOM 行快照的引擎基礎,M1 對碼 |
| docs/04 v2.8 L | BOM 多階 8 · 工單 7 · 簡易 MRP 8 · **委外加工 5(v2.7 食品加工硬需求)** = 36 | scope 上限 |

### 0.2 站②|相依套件(淺查)

- LLC / 拓撲排序 / 循環偵測:純演算法,無需新相依(站① Tarjan 先例);pg numeric 同 gl/inventory M1 對碼。

### 0.3 站③|競品(2026-08-08 三路;OFBiz=原始碼,ERPNext=只讀官方文件,Odoo=本地文檔庫)

> ✅ **承重句親驗(2026-08-08)**|OFBiz:`ProductAssoc.scrapFactor`/`routingWorkEffortId` L2949/2951 ✓ · **`MrpEvent.quantity` 為 `floating-point` L208(包袱承重句)** ✓ · `BOMHelper.searchDuplicatedAncestor` L104-109(應用層遞迴循環檢查)✓ · `ProposedOrder.java` L307(`INTERNAL_REQUIREMENT`/`PRODUCT_REQUIREMENT` 建議單)✓ · PRUN 狀態 seed `WorkEffortSeedData.xml` L160-162 ✓。ERPNext 原文:"once a BOM is submitted, it cannot be edited" / "Is Phantom BOM" / "WIP Warehouse" / "Raw Materials Supplied" / "Send to Subcontractor" ✓。Odoo 行號:`subcontracting_resupply.rst` L182-184(Subcontracting Location)/ `bill_configuration.rst` L214-215(Flexible Consumption **Blocked** "must adhere strictly")/ `kit_shipping.rst` L6 / `use_mps.rst` L16(manually plan)/ `subcontracting.rst` L64(BoM Type Subcontracting)✓。法條 §58 / 帳簿辦法 §2 / §101-1 / §36 逐字 ✓。**零反轉**。

**OFBiz(Apache-2.0,LICENSE 本文複驗)**:
- BOM = `ProductAssoc(MANUF_COMPONENT)`:`quantity / scrapFactor / fromDate / thruDate / sequenceNum / routingWorkEffortId`([product-entitymodel.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/datamodel/entitydef/product-entitymodel.xml) L2949-2951)—— **版本化=時效區間無版號**;BOM 行可綁工序(該工序領用)
- 工單狀態機**資料驅動**(`StatusItem`+`StatusValidChange`,[WorkEffortSeedData.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/datamodel/data/seed/WorkEffortSeedData.xml) L158-170):CREATED→SCHEDULED→DOC_PRINTED(Confirmed)→RUNNING→COMPLETED→CLOSED —— 與表單引擎狀態欄同構
- MRP:LLC 有實作(`billOfMaterialLevel` 逐階迴圈);產出=**建議需求**(`INTERNAL_REQUIREMENT` 建議工單 / `PRODUCT_REQUIREMENT` 建議採購,[ProposedOrder.java](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/manufacturing/src/main/java/org/apache/ofbiz/manufacturing/mrp/ProposedOrder.java) L307)非直接開單
- **包袱不學**:①`MrpEvent.quantity` 等多欄 `floating-point`([manufacturing-entitymodel.xml](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/datamodel/entitydef/manufacturing-entitymodel.xml) L208)→ 我方一律 numeric;②循環檢查只在應用層服務([BOMHelper.java](https://raw.githubusercontent.com/apache/ofbiz-framework/trunk/applications/manufacturing/src/main/java/org/apache/ofbiz/manufacturing/bom/BOMHelper.java) L104-137),繞過即可寫入循環 → 我方鎖在引擎寫入咽喉;③**委外只有 seed 佔位無實作**(`ROU_SUBCONTRACTING`,服務層 grep 零命中)

**ERPNext(GPL-3.0,只讀 docs.frappe.io)**:
- [BOM](https://docs.frappe.io/erpnext/user/manual/en/bill-of-materials)|"once a BOM is submitted, it cannot be edited. You can only cancel the existing, duplicate it and submit another one"(**不可變+複製再發布**);"Is Phantom BOM…only a logical grouping of raw materials";multi-level = 子件各自有 BOM 成樹
- [Work Order](https://docs.frappe.io/erpnext/user/manual/en/work-order)|**兩段式 + WIP 倉**:發料 Stock Entry → WIP Warehouse;完工 Stock Entry 扣 WIP 入成品倉
- [Manufacturing Settings](https://docs.frappe.io/erpnext/manufacturing-settings)|超產百分比 / "Validate Components Quantities Per BOM" / backflush 依「已發料」或「BOM」
- [Production Plan](https://docs.frappe.io/erpnext/user/manual/en/production-plan)|SO/MR → 抓子件 BOM → 短缺開 Material Request → 使用者選擇性開工單(**人核准鏈**)
- [Subcontracting](https://docs.frappe.io/erpnext/user/manual/en/subcontracting)|**PO 主導**:Is Subcontracted PO(rate=加工費)→ Subcontracting Order(依 BOM 算 "Raw Materials Supplied")→ "Send to Subcontractor" 發料至 **supplier warehouse** → Subcontracting Receipt 收成品;"ERPNext will automatically add the raw material rate for your valuation purpose"(**成品估值=原料+加工費**)
- BOM 循環防護:官方文件未述 → **未查證**(clean-room 不得讀源碼補證)

**Odoo 18(本地 `content/applications/inventory_and_mrp/`)**:
- `subcontracting.rst` L64|BOM 三型(Manufacture / Kit / **Subcontracting**);`subcontracting_resupply.rst` L182-184|**"Odoo first transfers any product components to a dedicated *Subcontracting Location*…the good then moves back…before finally entering the contractor's stock"**(專屬虛擬庫位=委外商手上的我方料);三模式 Basic(對方備料)/ **Resupply**(我方發料)/ Dropship(我方買料直送);成本 P = 原料 C + 加工費 M + 運費 + 其他
- `bill_configuration.rst` L214-215|**超耗管制三檔**:"Choose **Blocked** if operators **must** adhere strictly to the BoM quantity. Otherwise, choose Allowed or Allowed with Warning."
- `kit_shipping.rst` L6|Kit(phantom)= "sets of unassembled components";銷售一行、出貨拆件、**庫存不在 kit 層**
- `use_mps.rst` L16|MPS "used to **manually** plan"(建議不自動開單,與 reordering rules 互斥);MTO route 由 SO 觸發草稿 MO/PO
- 報廢:虛擬 Scrap 位置;副產品:BOM 可列多個 by-products
- BOM 版本歸 PLM/ECO(對標)

**收斂 / 分歧**|收斂:①MRP/計畫產出=建議+人核准(三家)②委外=採購流程主導 + 專屬倉位追蹤在外料 + 成品成本=原料+加工費(ERPNext/Odoo)③工單兩段式(WIP 概念;ERPNext WIP 倉 / Odoo Production 虛擬位)④phantom/kit 展開穿透 ⑤超耗要有管制檔位。分歧:BOM 版本(OFBiz 時效區間 / ERPNext 不可變複製 / Odoo ECO 模組)→ OQ-MFG-2;委外模式範圍 → OQ-MFG-4。

### 0.4 站④|台灣法規一手(law.moj.gov.tw;§58 / 帳簿辦法 §2 / §101-1 / §36 已親驗逐字)

- **查核準則 §58(🔴 本模組最重要法源)**|「製造業已依稅捐稽徵機關管理營利事業會計帳簿憑證辦法設置帳簿,平時對**進料、領料、退料、產品、人工、製造費用**等均作成紀錄,有內部憑證可稽,並編有**生產日報表或生產通知單及成本計算表**,經內部製造及會計部門負責人員簽章者,其製品原料耗用數量,**應根據有關帳證紀錄予以核實認定**。製造業不合前項規定者,其耗用之原料如超過各該業通常水準;**超過部分…應不予減除**。」——**兩級制**:有完整領退料紀錄+法定單據=核實認定;沒有=超耗剔除補稅。**Weyver 工單+領退料系統天然產出第一級全部要件,是對台灣製造業的合規賣點非 nice-to-have**
- **帳簿辦法 §2(pcode=G0340010)**|製造業**應設**:日記簿 / 總分類帳 / 原物料明細帳 / 在製品明細帳 / 製成品明細帳 / **生產日報表**(「記載每日機器運轉時間、直接人工人數、原料領用量、及在製品與製成品之生產數量等資料」)→ **工單回報欄位法定對映**
- **§101-1(商品報廢)**|「應於事實發生後**三十日內**檢具清單報請該管稽徵機關**派員勘查監毀**,或事業主管機關監毀並取具證明文件」;**第二款:生鮮農、魚類**因產品特性或衛生法令過期變質無法久存者,可依會計師簽證+相關資料核實認定(**食品加工客戶直接適用**)→ 報廢單要件(30 日提示 / 監毀證明欄 / 生鮮通道)
- **§36(下腳廢料)**|「銷售下腳及廢料之收入,應列為**收入或成本之減項**…下腳及廢料未出售者,**應盤存列帳**」→ 副產品/下腳須入庫存帳(K),變賣過帳 role
- **委託加工**|查核準則本文**無專條**(全文掃描確認;僅函釋/判決層次)→ 委外成本認定不作法條承重,依 §58 同一領退料紀律(委外領料=領料紀錄)
- §60|製造費用歸屬與轉正分攤 → **N 模組定位句**,此處不涉

出處|[§58](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340051&flno=58) · [§36](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340051&flno=36) · [§101-1](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340051&flno=101-1) · [帳簿辦法 §2](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340010&flno=2)(皆查證 2026-08-08)

---

## 1. 目標與範圍

### 1.1 目標

- BOM(多階 + phantom/kit + 副產品 + 損耗率)· 工單(狀態機 / 領退料 / 完工入庫 / 回報)· 簡易 MRP(LLC + 淨需求 + 前置期 → 建議草稿)· 委外加工(發料 / 在外料追蹤 / 收回 / 加工費入成本)。
- **法定單據原生**:生產日報表(帳簿辦法 §2 欄位)/ 超耗差異報表(§58)/ 報廢單(§101-1 要件)。

### 1.2 不做的事(scope out)

- 產能規劃 / 排程(CRP / APS)|docs/34 已裁 APS 待獨立 M0;MVP 只做前置期回推
- 現場逐站報工 / 工時採集 / SCADA|T 模組(R3;ISA-95 L3)—— L 的完工回報是表單動作,T 之後可自動餵
- 工單成本結轉 / 製造費用分攤 / 標準成本差異|N 模組(消費 L 的量與事實)
- BOM ECO 工程變更流程|對標(Odoo 歸 PLM 的先例);routing / 工序主檔|P1(MVP 工單不分工序)
- 受託加工(我方為受託方)|對標

## 2. 上游 / 既有現況走查(前提快照 2026-08-08)

| 上游 | 狀態 | 關係 |
|---|---|---|
| R2/inventory.md | ✅ M0 APPROVED | 領退料 / 完工入庫 / 委外調撥全走 `inv_move`;負庫存禁止直接約束領料(無料不能領)|
| R2/gl.md · calc-binding | ✅ APPROVED | 工單相關過帳(在製 / 完工)由 N 定義綁定;L 只供事實 |
| M 品保批次追蹤 | ⬜ | 領料 / 完工帶 `batch_ref`(投入批→產出批 = FSMA 204 TransformationEvent 多對多,docs/34)|
| linkload(Tarjan)· Link&Load 快照 | ✅ SHIPPED | 循環偵測範式 + BOM 快照機制,M1 對碼 |
| 簽核 / 事件觸發器 | ✅ SHIPPED | 工單狀態機 + MRP 建議核准 |

## 3. 資料模型(**零新 ledger**;Tier-1 僅計算快取,皆可重建)

```
BOM = 表單(模板):header(成品 / 版次 / 生效日 / 狀態 draft|published|retired)
  + 子表 lines(component_ref · qty_per · scrap_factor% · is_phantom 穿透 · sequence)
  + 子表 by_products(§36:副產品 / 下腳,產出入 K 庫存帳)
工單 = 表單(模板):成品 / 數量 / BOM 版次快照(抓單時複製 BOM 行進工單子表,後改 BOM 不影響在途工單)
  + 狀態機:draft→confirmed→in_progress→completed→closed(+cancelled;資料驅動合法轉移,OFBiz StatusValidChange 範式)
  + 回報欄位(法定生產日報表對映):機器運轉時間 · 直接人工人數 · 原料領用量 · 在製/製成品產量
委外單 = 表單(模板):供應商 / 加工費 / 依 BOM 算應發料;發料=inv_move transfer→委外倉(per 供應商)
  收回=成品 receipt + 耗用委外倉料;加工費由 J.ap-ar 發票 → N 入成品成本
報廢單 = 表單:§101-1 要件(事實日期 · 30 日報備倒數 · 監毀證明附件欄 · 生鮮通道旗標)→ K adjust

Tier-1 計算快取(可重建,對帳 job 斷言):
mfg_llc(item_ref → low_level_code;BOM 發布時增量維護)
mrp_run(run provenance:參數 / 起訖 / 觸發人)+ mrp_event(需求/供給時間軸,numeric)
  → 產出寫「建議採購 / 建議工單」草稿記錄(表單),人核准才轉正式單
```

## 4. 不變量

1. **BOM 無循環**|發布路徑上強制 DAG 檢查(Tarjan 範式)+ LLC 重算;**強制點在引擎寫入咽喉非應用層禮貌**(OFBiz 包袱的修正);並行編輯防護見 §7-bis。
2. **庫存動作單一通道**|L 永不直寫庫存量;領退料 / 完工 / 委外 / 報廢一律 `inv_move`(K 的不變量連帶生效:append-only / 負庫存禁止)。
3. **工單快照**|工單發放後 BOM 行凍結於工單內;BOM 後續改版不回溯影響在途工單。
4. **MRP 建議不自動轉單**|人核准(三家收斂 + calc-binding OQ-CBL-6 同構)。
5. **數量 numeric**|含 mrp_event(OFBiz floating-point 包袱的修正)。
6. **超耗管制**|租戶政策三檔:blocked / allowed_with_warning / allowed(Odoo 逐字範式);超耗一律入差異報表(§58 證據鏈),warning 檔留 audit(誰看過警告仍領,復用 R1 C-6 warning-ack 範式)。
7. **法定保存跟隨 gl**|工單 / 領退料紀錄屬 §38 帳簿憑證體系(生產日報表為法定帳簿),保存政策同 gl 不變量 8。

## 5. MRP(簡易;docs/18 §7 落地形狀)

```
輸入:需求(SO / 預測 / 安全存量)+ 供給(在手 QOH − 已預留 / 在途 PO / 在途工單)
流程:LLC 由 0 逐階 → 每品項時間軸淨需求 → lot(MVP:lot-for-lot + 最小批量)
     → 前置期回推(採購=供應商 lead time;自製=固定 lead time,MVP 不排產能)
     → 自製品需求經 BOM 展開(× qty_per × (1+scrap%))寫入下階
產出:建議採購草稿(→ K 採購單)/ 建議工單草稿(→ 工單);全量重跑(pilot 規模),增量對標
```

## 6. R1 預留對應

gl §6 之 P1–P4 全適用;另:**快照機制對碼**(Link&Load snapshot 是否可承載「抓單複製子表」,M1 驗)· 狀態機合法轉移的資料驅動表達(簽核已有,粒度對碼)。

## 7. 開放問題(OQ-MFG-N)

| OQ | 議題 | 建議(依據)| 裁定 |
|---|---|---|---|
| OQ-MFG-1 | 形態:BOM/工單/委外單=表單;**零新 ledger**;Tier-1 僅計算快取 | 採(docs/35 一切皆表單 + K ledger 單一通道;OFBiz BOM=關聯資料同構)| ✅ 研究錨定 |
| OQ-MFG-2 | BOM 版本:版次欄+生效日;**發布後行凍結,改=新版次**;工單抓單快照;ECO 對標 | 採(ERPNext「submitted 不可編」+ OFBiz 時效區間 的合成;快照使「不可變」不阻塞在途工單)| ✅ 研究錨定 |
| OQ-MFG-3 | MRP 範圍:LLC+淨需求+前置期,產出建議草稿;不做產能/APS/增量 | 採(docs/04「簡易」+ docs/34 APS 獨立 M0 + 三家「建議+人核准」收斂)| ✅ 研究錨定 |
| **OQ-MFG-4** | **委外模式範圍**:MVP 只做 **Resupply(原料我出)**+ 委外倉(per 供應商);Basic(對方備料)=普通採購不另建;Dropship 對標 | **建議採**(ERPNext/Odoo 收斂之 PO 主導 + 專屬倉位;⚠️「台灣食品代工以原料我出為主」屬推定**未查證** —— pilot 客戶實務 M1 前確認)| ✅ 採建議(2026-08-08 裁定)|
| OQ-MFG-5 | 超耗管制三檔 + §58 差異報表 | 採(Odoo Blocked/Allowed 逐字 + §58 兩級制法源親驗)| ✅ 研究錨定 |
| OQ-MFG-6 | **生產日報表 = 工單回報的法定輸出**(帳簿辦法 §2 欄位對映)| 採(法條逐字「應設」+ 欄位點名;合規賣點)| ✅ 研究錨定 |
| **OQ-MFG-7** | **工單庫存流:兩段式(領料→WIP 虛擬倉→完工耗 WIP 入成品)為唯一路徑,「一步完工」=連續執行兩段** | **建議採**(ERPNext WIP 倉 + Odoo Production 虛擬位收斂;在製品明細帳為帳簿辦法 §2 **法定應設帳簿**,WIP 倉正是它的資料源)—— 交裁因它決定 K 倉位模型的複雜度 | ✅ 採建議(2026-08-08 裁定)|
| OQ-MFG-8 | 報廢/下腳:報廢單含 §101-1 要件(30 日倒數/監毀證明/生鮮通道);副產品下腳**應盤存列帳**入 K | 採(§101-1/§36 親驗逐字)| ✅ 研究錨定 |

## 7-bis. 設計難題清單(一手錨定,實測留 M1)

| # | 難題 | 依據 | 姿勢 |
|---|---|---|---|
| 1 | **多階展開效能**:深階 BOM 展開 + 全量 MRP | PG recursive CTE 為候選(官方 [WITH Queries](https://www.postgresql.org/docs/current/queries-with.html):"a recursive query…refer to its own output");OFBiz 用應用層逐階迴圈 | M1 實測 recursive CTE vs app 層 BFS(對照 dynamic-permissions 30 萬列範式);LLC 快取使 MRP 免重複遍歷 |
| 2 | **BOM 並行編輯成環**:兩個各自無環的插入並行提交,合併後成環(check-then-write race) | 站① linkload 同型問題 | 發布走 per-tenant advisory lock(P0-1 DDL 鏈範式)序列化;M1 寫並行負向測試 |
| 3 | **MRP 與現實漂移**:全量重跑期間單據仍在動 | OFBiz MrpEvent 快照式(run 時凍結輸入)| run 開始時以一致性快照讀(單一 tx snapshot);建議單標 run id,過期 run 的建議自動失效 |

## 8. 測試策略(鐵則)

同 gl/inventory(DB 直打負向 / 跨租戶);另:**BOM 生成式測試**(隨機 DAG → 展開量守恆:Σ子件需求 = 成品量×qty_per×(1+scrap))· 循環注入必被拒 · MRP 黃金案例(docs/18 §7 手算例)· 委外全流程(發料→在外→收回)量守恆。

## 9. 落地順序(R2 啟動後;docs/13 P0-7 / P1-D)

M1 對碼(快照/狀態機/numeric)→ M2 BOM+LLC+防循環 → M3 工單+領退料+WIP+回報(生產日報表)→ M4 委外 → M5 MRP → M6 報廢/下腳+超耗報表。FMEA 收尾必填。

## 13. 變更紀錄

- **2026-08-08 v1.0**|OQ-MFG-1..8 全數裁定 → **M0 APPROVED**(4 委外 MVP 只做 Resupply+委外倉、7 兩段式 WIP 為唯一路徑 經徵詢採建議)。
- **2026-08-08 v0.1**|M0 首版(design-ahead,四站+親驗)。四站:OFBiz 原始碼(BOM=時效關聯 / 狀態機資料驅動 / MRP 建議單 / **兩包袱親驗:floating-point 數量、循環檢查僅應用層**;委外只有 seed 佔位)· ERPNext 官方文件(BOM 不可變+複製 / WIP 兩段式 / PO 主導委外+supplier warehouse / 成品估值=原料+加工費)· Odoo 本地文檔(委外三模式+Subcontracting Location / 超耗三檔 / kit / MPS manual)· **站④法規改設計**:§58 兩級制 → 超耗差異報表=證據鏈、帳簿辦法 §2 → **生產日報表欄位法定對映**、§101-1 → 報廢單要件(30 日/監毀/生鮮款)、§36 → 副產品下腳應盤存列帳。落定:零新 ledger(庫存單一通道走 K)· BOM 版次+工單快照 · MRP 建議草稿人核准 · 委外倉範式。OQ-MFG-1..8(六條研究錨定,4/7 交裁)。
