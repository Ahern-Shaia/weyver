# Weyver ERP 計算層演算法蒸餾

> **文件性質**|命門地基設計之二 —— 表單引擎(docs/15)是 substrate,**計算層**是 Ragic 過不去的那道牆(docs/10 §5b「算不是填」)。本文把 ERP 深層計算蒸餾成**可實作演算法規格**。
> **法律**|純合法蒸餾(A16)—— 來源 IFRS / 台灣 GAAP + 會計 / 成本 / MRP 教科書 + Odoo **文檔**(CC-BY-SA)+ 通用會計原理(原理不受著作權保護)。**不 clone Odoo source code**。
> **配套**|docs/15 §10(計算層掛勾表單引擎)+ docs/04 J/K/L/N(財會/進銷/生產/成本)+ docs/13 P0-6/P0-7。
> **版本**|2026-07-18 v1

---

## 0. 計算層總則

- **這是「算」不是「填」**|表單引擎存單據(Tier 1 真實表);計算層 = 引擎之上的 NestJS services,對真實表做原生 SQL + 演算法,結果寫回引擎(帶 audit/權限,docs/15 §10)。
- **build-on vs 自研(2026-07-18,見 docs/20)**|帳務 GL **自研於 Postgres**(風險在 ERP 語意非借貸原語,無引擎可代;藍圖研讀 **ERPNext `GL Entry` + OFBiz OMG-GL**,GPL/Apache 合法可讀作參考,不 embed,呼應 A16;**TigerBeetle** Apache-2.0 為高交易量 escape hatch)。**規則運算(稅 / 定價 / 核准 / 政策門檻)交 GoRules ZEN**(MIT 決策引擎,per-tenant JDM)。**長流程(期末結轉 / 對帳 / 電子發票 submit-poll / 長簽核)交 DBOS**(Postgres durable execution)。
- **鐵律(所有演算法共用)**|
  1. **精度**|金額一律 `numeric`(DECIMAL),**禁 float**;每幣別小數位數(TWD 0、USD 2);明確捨入規則(四捨五入 / 銀行家捨入,依科目)。
  2. **原子性**|過帳 / 沖帳 / 結轉在**單一 DB transaction**;失敗全 rollback。
  3. **期間鎖**|已結期間不得過帳;需調整走「後期沖轉」。
  4. **不可變 + 沖轉**|傳票**不刪不改**,錯了開反向傳票(reversal);全留 audit。
  5. **可重算 / 可追溯**|每筆計算可回推來源(drill-down)。

---

## 1. 總帳 GL(複式簿記)—— 最合規敏感命門

### 1.1 科目與正常餘額

| 科目類別 | 正常餘額方向 | 增加 | 財報歸屬 |
|---|---|---|---|
| 資產 Asset | 借 Debit | 借 | 資產負債表 |
| 負債 Liability | 貸 Credit | 貸 | 資產負債表 |
| 權益 Equity | 貸 | 貸 | 資產負債表 |
| 收入 Revenue | 貸 | 貸 | 損益表 |
| 費用 Expense | 借 | 借 | 損益表 |

`科目餘額 = Σ借方 − Σ貸方`(借方正常科目為正;貸方正常科目取負或反向解讀)。台灣科目表用財政部 / GAAP 標準科目編碼。

### 1.2 過帳(posting)

```
post(journal_entry):
  assert Σ(line.debit) == Σ(line.credit)        # 借貸平衡,否則拒絕
  assert period_open(entry.date)                 # 期間未鎖
  for line in entry.lines:
    ledger.append(account=line.account, debit=line.debit,
                  credit=line.credit, ref=entry.id, date=entry.date)
  entry.status = POSTED                           # 不可變
  # 全程單一 transaction
```

### 1.3 期末結轉(period close)

```
close_period(period):
  net_income = Σ(revenue.balance) − Σ(expense.balance)
  # 結轉損益類科目歸零 → 本期損益
  for acc in revenue ∪ expense:
    post_closing(acc → 本期損益, acc.balance)
  # 本期損益 → 保留盈餘
  post_closing(本期損益 → 保留盈餘, net_income)
  # 資產/負債/權益科目餘額結轉下期(carry forward)
  period.status = CLOSED
```

### 1.4 試算表 + 財務報表

- **試算表**|列所有科目借 / 貸餘額,驗 `Σ借 == Σ貸`(不平 = 有錯)。
- **資產負債表**|`資產 = 負債 + 權益`(恆等式,不成立即錯)。
- **損益表**|`收入 − 費用 = 淨利`。
- **現金流量表**|直接法(現金科目分類)或間接法(淨利 + 非現金調整 ± 營運資金變動)。

---

## 2. AP / AR(應付 / 應收)

### 2.1 沖帳(settlement / matching)

```
settle(payment, [invoices]):
  remaining = payment.amount
  for inv in invoices (依到期日 / FIFO):
    applied = min(remaining, inv.open_amount)
    inv.open_amount −= applied
    remaining −= applied
    record_application(payment, inv, applied)
  if remaining > 0: → 預收 / 預付 或 溢付
  # 過對應 GL 傳票(收款:借現金 貸應收)
```

支援部分沖、一付多銷、一銷多付。

### 2.2 帳齡分析(aging)

```
aging_bucket(invoice, as_of):
  days = as_of − invoice.due_date
  return 未到期 if days<=0
       , "1-30"  if days<=30
       , "31-60" if days<=60
       , "61-90" if days<=90
       , "90+"
```

### 2.3 三方比對(3-way match，採購)

`採購單(PO) ↔ 收貨單(GRN) ↔ 供應商發票` 三者數量 / 單價一致(容差內)才放行付款:

```
match(po, grn, invoice, tol):
  assert |invoice.qty − grn.qty| <= tol.qty
  assert |invoice.price − po.price| <= tol.price
  assert invoice.qty <= po.qty − already_invoiced
```

---

## 3. 庫存估值(inventory valuation)

三法擇一(依科目 / 品項設定):

### 3.1 加權平均(periodic weighted average)

```
avg_cost = 期初金額 + Σ進貨金額
         ─────────────────────────
           期初數量 + Σ進貨數量
出庫成本 = 出庫數量 × avg_cost         # 期末統一計
```

### 3.2 移動平均(perpetual moving average)—— 每次進貨即重算

```
on_receipt(qty, cost):
  new_avg = (on_hand_qty*avg + qty*cost) / (on_hand_qty + qty)
  on_hand_qty += qty;  avg = new_avg
on_issue(qty):
  cogs = qty * avg                       # 以當下均價出
  on_hand_qty −= qty
```

### 3.3 先進先出(FIFO)—— 維護成本層 queue

```
layers = deque[(qty, unit_cost)]         # 依進貨序
on_receipt(qty, cost): layers.push_back((qty, cost))
on_issue(need):
  cogs = 0
  while need>0:
    (lqty, lcost) = layers.front()
    take = min(need, lqty)
    cogs += take*lcost;  need −= take
    lqty −= take;  if lqty==0: layers.pop_front()
  return cogs
```

> **實作**|估值與 GL 連動(出庫 → 借銷貨成本 貸存貨);移動平均 / FIFO 需 perpetual 逐筆維護,是計算層典型職責(表單存不了)。

---

## 4. 多幣別 · 匯兌損益(FX)

- **入帳**|交易時以**交易匯率**記本位幣金額 + 保留外幣金額 + 匯率。
- **期末重估(revaluation)**|開放的貨幣性項目(AR/AP/銀行)以**期末匯率**重估:

```
未實現匯兌損益 = 外幣餘額 × (期末匯率 − 入帳匯率)     # 記入損益,下期迴轉
```

- **沖銷時**|

```
已實現匯兌損益 = 外幣金額 × (結算匯率 − 入帳匯率)
```

---

## 5. 成本會計

### 5.1 標準成本 + 差異分析(variance)

`標準成本 = 標準材料 + 標準人工 + 標準製造費用`

```
材料價差 = (實際單價 − 標準單價) × 實際用量
材料量差 = (實際用量 − 標準用量) × 標準單價
人工工資率差 = (實際工資率 − 標準工資率) × 實際工時
人工效率差 = (實際工時 − 標準工時) × 標準工資率
製費差異 = 實際製費 − 已分攤製費(標準)
# 差異入差異科目,期末結轉銷貨成本 / 存貨
```

### 5.2 BOM 成本結轉(cost roll-up)—— 需低階碼

```
rollup_cost(item):                        # 依低階碼由底層往上算
  if item.is_purchased: return item.std_price
  cost = Σ(rollup_cost(c.item) × c.qty for c in BOM(item))   # 材料
       + Σ(op.rate × op.time for op in routing(item))         # 加工
  return cost
```

- **分批成本(job costing)**|成本歸集到工單 / 批。
- **分步成本(process costing)**|成本逐製程結轉(約當產量)。

---

## 6. 折舊(depreciation)

```
直線法      : 年折舊 = (成本 − 殘值) / 耐用年限
餘額遞減法  : 年折舊 = 期初帳面淨值 × 折舊率
年數合計法  : 年折舊 = (成本−殘值) × (剩餘年數 / 年數合計)
生產數量法  : 折舊 = (成本−殘值) × (當期產量 / 總估計產量)
# 每期過帳:借折舊費用 貸累計折舊
```

---

## 7. MRP(物料需求規劃)—— 最演算法密集

### 7.1 低階碼(Low-Level Code, LLC)

每品項在所有 BOM 中出現的**最低層級** → 依 LLC 由低到高處理,確保子件的需求在算父件前已彙總完。

### 7.2 多階展開 + 淨需求

```
mrp_run():
  compute_LLC(all_items)                          # 拓撲
  for item in items sorted by LLC asc:
    gross_req[item] = 銷售訂單 + 預測 + Σ父件計畫工單帶下的需求
    for bucket in time_buckets:                   # 時間分桶
      projected = on_hand + scheduled_receipts − gross_req
      net_req = max(0, safety_stock − projected)  # 淨需求
      if net_req > 0:
        lot = lot_sizing(net_req)                 # 批量法:逐批/固定/最小
        planned_order = lot
        release_date = need_date − lead_time      # 前置期偏移
        if item.is_manufactured:
          explode(item, planned_order) → 子件 gross_req  # 往下展開
        else:
          → 採購建議
```

- **批量法**|逐批(lot-for-lot)/ 固定量 / 最小 - 最大 / 經濟訂購量(EOQ)。
- **產出**|計畫採購單 + 計畫工單(建議,人審轉正式)。

---

## 8. 合併報表(consolidation,Phase 2 對標)

```
consolidate([entities]):
  combined = Σ entity.trial_balance
  eliminate 內部應收/應付                    # IC receivable/payable
  eliminate 內部銷售/進貨                    # IC sales/purchase
  eliminate 存貨中未實現利益                 # unrealized profit in inventory
  compute 少數股權(<100% 持股)             # minority interest
```

---

## 9. 各演算法掛勾表單引擎(docs/15 §10)

| 計算 | 讀(真實表)| 寫(引擎 API)| 觸發 |
|---|---|---|---|
| GL 過帳 | 傳票子表 | 分錄 / 科目餘額 | 單據核准工作流 |
| 庫存估值 | 庫存異動 | 成本 / COGS 傳票 | 收 / 出庫事件 |
| 成本結轉 | BOM / 工時 | 工單成本 | 工單完工 |
| MRP | 訂單 / 庫存 / BOM | 計畫單(草稿)| 排程 / 手動 run |
| FX 重估 | AR/AP/銀行 | 匯兌損益傳票 | 期末批次 |

- **熱點(大量 MRP 展開 / 期末批次)**|走背景 worker(BullMQ,docs/11 §2.2 抽出 process),非同步 + 事後 recalc。
- **一致性**|計算層不繞過引擎直接改資料(除熱點),保 audit / 權限 / 公式一致。

---

## 10. 開發優先序(對照 docs/13)

| 階段 | 計算層 |
|---|---|
| **Phase 0(P0-6/7)** | GL 複式過帳 + 期結 + 試算表、AP/AR 沖帳 + 帳齡、庫存估值(加權 / 移動平均先)、FIFO |
| **Phase 1** | 多幣別 FX 重估、標準成本 + 差異、BOM 成本結轉、折舊、簡易 MRP(淨需求展開)|
| **Phase 2 對標** | 分步成本、完整 MRP II(產能 / 途程)、合併報表、Multi-book |

> **人才**|Phase 0 之 GL / 估值合規敏感 → 對照 docs/04 人才風險之「ERP 財會領域顧問(兼職)」驗證科目表 / 期結 / 稅務正確性。

---

## 版本

- **2026-07-18 v1**|首版。蒸餾 ERP 計算層核心演算法為可實作規格:GL 複式簿記 + 期結 + 財報、AP/AR 沖帳 + 帳齡 + 三方比對、庫存估值(加權 / 移動平均 / FIFO)、多幣別匯兌損益、標準成本 + 差異 + BOM 成本結轉、折舊四法、MRP(低階碼 + 多階展開 + 淨需求 + 前置期偏移)、合併沖銷。含共用鐵律(精度 / 原子性 / 期間鎖 / 不可變沖轉)+ 表單引擎掛勾 + 開發優先序。純合法蒸餾(A16),不 clone Odoo source。
