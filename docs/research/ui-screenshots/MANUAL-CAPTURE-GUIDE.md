# 手動截圖指南

> 以下畫面需登入才能看到,自動抓取無法取得。
> 請用 macOS `Cmd+Shift+4` 截圖後放入對應資料夾。
> **命名規則**:`{vendor}-{module}-{序號}.png`  例：`odoo-gl-journal-01.png`

---

## 優先度說明

- 🔴 **P0 必抓**|Weyver MVP 直接對應的 UI,開發 Phase 0 sprint 要對照
- 🟡 **P1 應抓**|Phase 1 feature 參考
- 🟢 **P2 選抓**|Phase 2 對標 / nice-to-have

---

## 1. Odoo 18(免費 demo 帳號)

**Demo 入口**|https://demo.odoo.com  (直接建立免費 trial)

### 1.1 財會(J 模組) 🔴

| 截圖畫面 | 說明 | 建議檔名 |
|---|---|---|
| 總帳科目表(Chart of Accounts) | 科目 + level + 類型 | `odoo-gl-chart-of-accounts-01.png` |
| 傳票輸入(Journal Entry) | header + line items 編輯介面 | `odoo-gl-journal-entry-01.png` |
| 期結(Closing entries) | 月結 / 年結畫面 | `odoo-gl-period-closing-01.png` |
| 應付帳款列表(AP) | 發票 + 付款狀態 | `odoo-ap-vendor-bills-01.png` |
| 應收帳款(AR) + aging | aged receivable report | `odoo-ar-aging-01.png` |
| 銀行對帳(Bank Reconciliation) | 雙欄對帳 UI | `odoo-bank-reconcile-01.png` |
| 財務報表(P&L / Balance Sheet) | 樹狀 + 數字 | `odoo-financial-report-01.png` |

### 1.2 進銷存(K 模組) 🔴

| 截圖畫面 | 說明 | 建議檔名 |
|---|---|---|
| 採購單(PO) 編輯 | line items + vendor + state | `odoo-purchase-order-01.png` |
| 庫存移動(Stock Moves) | 倉別 / 數量 / lot | `odoo-inventory-moves-01.png` |
| 庫存報表(Inventory valuation) | FIFO / 加權平均 | `odoo-inventory-valuation-01.png` |
| 儲位管理(Location tree) | zone / bin 樹狀 | `odoo-warehouse-locations-01.png` |

### 1.3 生產(L 模組) 🔴

| 截圖畫面 | 說明 | 建議檔名 |
|---|---|---|
| BOM 多階展開 | tree + component qty | `odoo-bom-tree-01.png` |
| 工單(Manufacturing Order) | 工單 header + 操作 | `odoo-manufacturing-order-01.png` |
| MRP 需求展開結果 | 採購建議 / 生產建議 | `odoo-mrp-scheduler-01.png` |

### 1.4 MES / Quality(T/U 模組) 🟡

| 截圖畫面 | 說明 | 建議檔名 |
|---|---|---|
| 品質檢驗點(Quality Check) | 檢驗結果輸入 | `odoo-quality-check-01.png` |
| NCR / 不合格品管理 | 缺陷 + CAPA | `odoo-quality-alert-01.png` |
| OEE Dashboard | 設備效率 | `odoo-oee-dashboard-01.png` |

### 1.5 HR / 薪資(R 模組) 🟡

| 截圖畫面 | 說明 | 建議檔名 |
|---|---|---|
| 薪資單(Payslip) | 薪資計算明細 | `odoo-payslip-01.png` |
| 出勤紀錄(Attendance) | 打卡 / 加班 | `odoo-attendance-01.png` |

---

## 2. NetSuite(需申請 demo)

**Demo 入口**|https://www.netsuite.com/portal/pages/try-netsuite.shtml

### 🟡 重點截圖

| 截圖畫面 | 建議檔名 |
|---|---|
| GL 傳票列表 | `netsuite-gl-list-01.png` |
| Dashboard / KPI 主頁 | `netsuite-dashboard-01.png` |
| 多幣別財務報表 | `netsuite-multicurrency-report-01.png` |
| 採購核准流程 | `netsuite-po-approval-01.png` |

**存放**|`docs/research/ui-screenshots/netsuite/`

---

## 3. Microsoft Dynamics 365(試用)

**試用入口**|https://dynamics.microsoft.com/en-us/dynamics-365-free-trial/

### 🟡 重點截圖

| 截圖畫面 | 建議檔名 |
|---|---|
| Finance 模組主頁 | `dynamics365-finance-home-01.png` |
| AR / AP 列表 | `dynamics365-ar-list-01.png` |
| HR / Payroll | `dynamics365-hr-payroll-01.png` |
| Power BI 整合 report | `dynamics365-powerbi-report-01.png` |

**存放**|`docs/research/ui-screenshots/dynamics365/`

---

## 4. Workday(HR 對標)

**公開 demo video / help 截圖**|若無 Workday 帳號,改抓 YouTube demo 影片截幀

### 🟡 重點截圖

| 截圖畫面 | 建議檔名 |
|---|---|
| Workday Home(任務卡片式) | `workday-home-01.png` |
| HR 員工主檔 | `workday-worker-profile-01.png` |
| 薪資明細 | `workday-payslip-01.png` |

**存放**|`docs/research/ui-screenshots/workday/`

---

## 5. MasterControl / Intelix(ISO 對標)

**公開資源**|官網 marketing page + YouTube demo

### 🟢 重點截圖

| 截圖畫面 | 建議檔名 |
|---|---|
| Document control 版本管理 | `mastercontrol-document-control-01.png` |
| CAPA workflow | `mastercontrol-capa-01.png` |
| Audit management | `mastercontrol-audit-01.png` |

**存放**|`docs/research/ui-screenshots/mastercontrol/`

---

## 6. 台灣本地 ERP — 千羔(pipeline 客戶使用)

若能訪問千羔系統,優先抓|

| 截圖畫面 | 建議檔名 |
|---|---|
| 主選單 / 首頁 | `chiankao-home-01.png` |
| 採購模組 | `chiankao-purchase-01.png` |
| 庫存模組 | `chiankao-inventory-01.png` |
| 生產模組 | `chiankao-production-01.png` |

**存放**|`docs/research/ui-screenshots/chiankao/`(新建資料夾)

---

## 7. ciMes 資通電腦(台灣 MES 對標)

**入口**|https://www.ares.com.tw/tw/Products/MESIndex

| 截圖畫面 | 建議檔名 |
|---|---|
| 現場執行 UI(WIP tracking) | `cimes-floor-execution-01.png` |
| OEE 儀表板 | `cimes-oee-01.png` |
| 品質管制畫面 | `cimes-quality-01.png` |

**存放**|`docs/research/ui-screenshots/cimes/`(新建資料夾)

---

## 快速截圖 SOP

1. `Cmd+Shift+4` → 選取區域 → 截圖存桌面
2. Rename 依命名規則
3. 拖入對應 vendor 資料夾(`docs/research/ui-screenshots/{vendor}/`)
4. 不用跑 MANIFEST 更新,agents 跑完後自動整合

---

## 法律提醒(對照 CLAUDE.md 紅線)

- ✅ 截圖供 **競品分析 + 設計研究** — 合理使用
- ✅ 僅供 Weyver 開發參考,不對外公開此資料夾
- ❌ 不像素級照抄任何 vendor UI(CLAUDE.md 法律紅線)
- ❌ 不複製任何 vendor 之 icon / 品牌識別元素
