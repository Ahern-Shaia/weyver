# MES(製造執行系統)市場分析報告

> **研究目的**|Weyver v1.6 已將 MES(T 模組)納入 MVP 核心(Cloud SaaS + On-premise Edge Gateway hybrid),需系統性理解競爭生態、對接夥伴、功能參考基準,以支援 T 模組 spec 撰寫與競爭定位。
> **研究範圍**|11 家主流 MES:國際 Tier 1(6 家)+ 台灣本土(3 家)+ 平台型 / 開源(2 家)。
> **研究方法**|公開資訊(廠商官網、Fact Sheet、Gartner Peer Insights、產業分析報導、SAP 台灣資源頁)。
> **版本**|2026-07-16 v1


> 🔴 **2026-08-03 前提更正**|本文件多處以「**Weyver 路線 A = fork Odoo**」為前提撰寫,
> 而該路線已於 **2026-07-16 否決**(docs/04 v2.0 / docs/11 v4:**全自研 TypeScript,不 fork Odoo**,
> domain 學習限純合法來源 A16)。
> **市場分析本體(vendor 能力、功能對照、定價)仍然有效** —— 過期的只是「我方怎麼用它」那一欄,
> 已逐處改正。保留原文脈絡而非刪除,以便日後查得出當時為何那樣判斷。

---

## 1. MES 定義 & 標準

### 1.1 MES 定義(SAP 台灣資源頁 + MESA 標準)

> **MES(Manufacturing Execution System)是全方位的動態軟體系統,用於監控、追蹤、文件和控制製造商品的流程,從原料到成品,在企業資源規劃(ERP)與程序控制系統之間提供功能層。**
> —— SAP 台灣 `www.sap.com/taiwan/resources/what-is-mes`

> 🔵 **2026-08-03 補註(承 `docs/34 §2`)**|本節的 MESA-11 清單**仍然有效**,但作為**功能對照矩陣的座標軸已降為次軸**。主軸改用 **ISA-95 Part 3 的 4 domain × 8 activity 正交模型**(生產 / 維護 / 品質 / 庫存 × detailed scheduling / dispatching / execution management / resource management / definition management / tracking / data collection / analysis)—— 理由不只是它更嚴謹,而是「同一組活動語意套用在四個領域」與 Weyver「一個 substrate 承載多領域表單 app」**在結構上同構**。MESA-11 保留用於補 ISA-95 沒有的 **Document Control**(且 MESA WP#6 逐字把 ISO 文管與 CAPA 歸入該項,是「MES + ISO 織入同一 substrate」的一手依據)。
> ⚠️ **並更正一則常見誤傳**|坊間所稱「c-MES 把 11 項壓成 8 項」**是錯的** —— MESA 官網從未宣告刪除功能;該「8 項」實為 **VDI 5600 的分組**,兩者被混為一談。

MES 於 1997 年由 MESA(Manufacturing Enterprise Solutions Association)定義 **11 個核心功能**|

1. 資源分配與狀態管理
2. 生產排程 / 詳細排程
3. 派工(生產單位分派)
4. 文件控制(工單 / 作業指示書)
5. 資料收集與擷取
6. 人力管理(操作員 / 工時)
7. 品質管理(SPC / 品保單)
8. 製程管理(現場控制)
9. 維修管理(設備 / 保養)
10. 產品追蹤與族譜(traceability / genealogy)
11. 效能分析(OEE / 生產指標)

### 1.2 ISA-95 分層架構(業界標準)

| Level | 名稱 | 代表系統 |
|---|---|---|
| 4 | Business Planning & Logistics | ERP、SCM |
| **3** | **Manufacturing Operations Management(MOM / MES)** | **MES 所在層** |
| 2 | Monitoring & Supervisory Control | SCADA、HMI |
| 1 | Sensing & Manipulating | PLC、DCS、Sensors |
| 0 | Physical Process | 機台、產線、實體設備 |

MES 位於 Level 3,**負責 Level 4(ERP)與 Level 2(SCADA)之間的資料橋接與作業控制**。

### 1.3 MES 與 ERP 關係

- **ERP(Level 4)**|建立與管理排程、財務、採購、庫存邏輯
- **MES(Level 3)**|執行 ERP 派下的工單、監控現場實際狀況、即時回報生產進度
- **SCADA(Level 2)**|直接與機台通訊,採集溫度 / 轉速 / 壓力等即時參數
- 三者需**雙向資料同步**|工單向下派、實際數據向上回

---

## 2. 主流 MES 廠商分類與定位

### 2.1 分類總覽

| 分類 | 廠商 | 產業聚焦 | 部署 | 定價段 |
|---|---|---|---|---|
| **國際 Tier 1** | SAP DMC(SAP Digital Manufacturing) | 通用 + 汽車 / 醫藥 / 半導體 | Cloud SaaS + Hybrid | 高($100K+/site) |
| 國際 Tier 1 | **Siemens Opcenter** | 汽車 / 醫藥 / 半導體 / 電子 | On-prem / Cloud / SaaS(Opcenter X) | 高 |
| 國際 Tier 1 | **Rockwell FactoryTalk ProductionCentre** | 通用製造 | On-prem + Cloud(FactoryTalk Cloud) | 高 |
| 國際 Tier 1 | **GE Proficy Smart Factory MES** | 通用 + 流程業 | Cloud + On-prem(AWS Marketplace)| 高 |
| 國際 Tier 1 | **Aveva MES(前 Wonderware)** | Batch / Hybrid Process | On-prem | 高 |
| 專業型 | **Critical Manufacturing MES** | 半導體專門 | On-prem | 高(封閉市場) |
| **台灣本土** | **資通 ciMes(ARES)** | LED / 金屬 / 光電 / 電子 / 半導體 | Web(.NET Framework) | 中 |
| 台灣本土 | **鼎新 TIPTOP MES** | 通用(ERP-integrated) | On-prem | 中 |
| 台灣本土 | **工研院 iMES(via 鼎華 Digi-Hua)** | 通用中小型製造 | On-prem | 中-低 |
| **平台型** | **Ignition(Inductive Automation)+ Sepasoft MES** | 通用(SCADA-first) | On-prem / Edge | 中(模組授權) |
| 開源整合 | **Odoo Manufacturing + Shop Floor** | 通用中小型 | On-prem / Cloud | 低(Community 免費 / Enterprise 訂閱) |

---

## 3. 各廠商詳細分析

### 3.1 SAP DMC(SAP Digital Manufacturing)

- **定位**|SAP 之 Cloud-based MES,連接 shop floor 與 SAP ECC / S/4HANA(對 SAP 客戶零阻礙)
- **主要組件**|DMCe(執行)/ DMCi(洞察)/ DMCn(製造網路)/ REO(資源編排)
- **核心功能**|即時分析與智慧、雲端可擴展、Real-time visibility、Paperless manufacturing、Work instructions、Quality management、Performance metrics、Product traceability、Workforce management、IoT connection
- **前身**|SAP MII / SAP ME 整合為 SAP Digital Manufacturing
- **優勢**|SAP 生態零摩擦、Cloud 快速部署、IoT + AI/ML 內建
- **劣勢**|定價高(業界頂端)、綁 SAP、非 SAP 客戶導入摩擦大
- **來源**|`sap.com/products/scm/digital-manufacturing.html`

### 3.2 Siemens Opcenter

- **定位**|Siemens 之 MOM(Manufacturing Operations Management)平台,前身 Camstar / Simatic IT 整合
- **模組化 portfolio**|Opcenter Execution(Discrete / Process / Pharma / Electronics / Semiconductor 5 種變體)+ APS(Advanced Planning & Scheduling)+ Quality + Manufacturing Data Analytics
- **核心功能**|Work orders、BOMs、Recipes、Routing、Confirmations、Traceability & Genealogy、Inspection plans、SPC、Non-conformance、CAPA、Digital Work Instructions、OEE、Advanced Scheduling
- **擴展平台**|Mendix + 開放 API,可實作 plant-specific workflows
- **部署**|On-prem / Cloud / VPC / **Opcenter X SaaS**
- **2026 亮點**|Pharma 2605 版聚焦 web-first operator experience、資料完整性控制
- **優勢**|MOM 業界龍頭、產業別 variant 齊全、AI 導入積極(Gartner 2026 認可)
- **劣勢**|定價高、複雜、需深度顧問導入
- **來源**|`siemens.com/en-us/products/opcenter`

### 3.3 Rockwell FactoryTalk ProductionCentre

- **定位**|Rockwell 之 MES 平台,對接 Rockwell 自有 PLC / SCADA(Allen-Bradley 生態)
- **模組**|FactoryTalk Production / Performance / Quality / Warehouse(即將推出)
- **核心功能**|即時可視化、工單追蹤、設備效能監控、產品 traceability、深度機台整合、產業別 templates
- **整合**|Enterprise Integration Hub(EIHub)—— 企業應用 / 外部 IT 共用連接方法
- **部署**|On-prem + Cloud(私有 / 公有 / hybrid)、Infrastructure-as-a-Service、即將推出 FactoryTalk Cloud SaaS
- **優勢**|Rockwell PLC 生態整合最深、SaaS 轉型中
- **劣勢**|綁 Rockwell 硬體最有價值、非 Rockwell 客戶 marginal 價值有限
- **來源**|`rockwellautomation.com/en-us/products/software/factorytalk/operationsuite/mes`

### 3.4 GE Proficy Smart Factory MES

- **定位**|GE Digital(現 GE Vernova)之 MES 平台,強調 low-code 配置
- **核心功能**|OEE 即時追蹤 + 自動設備資料收集 + downtime 分析、Material / Inventory / WIP tracking + Genealogy、Quality management + SPC/SQC、Electronic Work Instructions + eSOPs、Predictive analytics + AI/ML anomaly detection、ERP/SCADA/PLM/IIoT/BI 深度整合
- **部署**|Cloud-native + On-prem + AWS Marketplace 可 provision
- **架構**|Composable low-code / no-code 配置、Enterprise system management、zero-downtime upgrades
- **產業覆蓋**|唯一同時支援 process / discrete / diverse mixed 的 MES(自稱)
- **優勢**|Cloud-native 現代化、低程式碼、AWS 生態整合
- **劣勢**|GE Digital 幾經分拆(GE Vernova),長期承諾性需觀察
- **來源**|`gevernova.com/software/products/manufacturing-execution-systems`

### 3.5 Aveva MES(前 Wonderware)

- **定位**|Aveva(現 Schneider Electric 集團)之 MES,強項在 batch / hybrid process 產業
- **三大模組**|
  - **Operations**|工單執行標準化、規格對照、即時 material flow 記錄
  - **Performance**|生產與設備事件監控、operating efficiency 分析
  - **Quality**|品質流程自動化、sample plan、trend 與 rule-violation warnings
- **核心價值**|Order flow 與 production execution 效率、raw material 到 finished goods 追蹤、yield / quality / plant resource 分析
- **架構**|Composable frontline operator interface、Modular deployment
- **優勢**|Process industry(化工、食品飲料、製藥)深度、Schneider Electric 硬體生態
- **劣勢**|Discrete manufacturing 不如 Siemens/Rockwell、Cloud 轉型較慢
- **來源**|`aveva.com/en/products/manufacturing-execution-system`

### 3.6 Critical Manufacturing MES(半導體專門)

- **定位**|**半導體專門 MES**(Portugal 出身,ASMPT 集團),Nikon / TSMC / IQE 等使用
- **核心特色**|
  - **Run-to-run control**|即時 performance data 調整,製程穩定性
  - **Chamber-dependent recipe**|精密設備 recipe 依 chamber 差異化
  - **Tasks & Checklists**|複雜作業引導 + factory 級 action items
  - **Master Data Management**|flexible context resolution
  - **c-Alice AI**|即時圖像分析偵測缺陷 + 連結 MES workflow
- **架構**|DevOps 導向、multi-site 易升級
- **優勢**|半導體 domain 頂尖、AI 整合(圖像 defect detection)
- **劣勢**|**非半導體產業幾乎不 fit**、生態封閉
- **來源**|`criticalmanufacturing.com`

### 3.7 資通 ciMes(ARES,台灣本土)

- **定位**|台灣本土 MES 龍頭,連續 3 年 Gartner Peer Insights 列名(**台灣唯一**),2018 台灣精品獎
- **核心模組**|在製管理 / 品質管理 / 零配件管理 / 機台預修保養 / 物料管理 / 載具管理 / 報表 / 標籤管理 / 警示管理
- **11 大功能**|對應 MESA 11 核心(資源配置與狀態、製造流程、分派、工作指示、資料收集、人力、品質、製程、維修、產品追蹤 / 歷史、效能分析)
- **技術架構**|微軟 .NET Framework、Web 遠端管理、**多語言線上切換**(跨國智慧工廠)
- **產業覆蓋**|LED、金屬加工、射出成型、光電、電子組裝、機械加工、半導體
- **優勢**|台灣客戶 support 到位、Gartner 認可、多語言跨國支援
- **劣勢**|.NET 技術棧偏老、Cloud SaaS 版本待觀察、UI 現代化程度中
- **來源**|`cimes.ares.com.tw`

### 3.8 鼎新 TIPTOP MES(台灣本土)

- **定位**|鼎新 TIPTOP GP ERP 之 MES 整合模組(**ERP-first 而非 MES-first**)
- **核心方法**|TIPTOP + 系統整合服務|對接 IoT / MES / WMS / SCM,打通資訊孤島 + 即時可視化
- **TIPTOP GP 5.1**|新增進階排程系統,可在單一 ERP 平台上完成物料需求 + 生產排程,並可估算日 / 時級物料需求
- **市佔優勢**|鼎新在台灣、中國、東南亞市佔高、客戶滿意度高
- **優勢**|對既有 TIPTOP 客戶零阻礙、進階排程內建
- **劣勢**|**主要為 ERP + MES 整合,非獨立深度 MES**;對非 TIPTOP 客戶無吸引力
- **來源**|`digiwin.com.tw/software/696.html`

### 3.9 工研院 iMES / 鼎華 Digi-Hua(台灣本土)

- **定位**|工研院技轉 → 鼎華智能商品化,面向台灣中小型製造業
- **三大核心功能**|
  - **製程管理**|生產流程 / 設備 / 製程參數控制、即時記錄
  - **品質控制**|即時品質資訊 + SPC 管制、異常趨勢偵測、即時改進
  - **資源管理**|人員 / 原物料 / 設備 / 組件 全面管理
- **效益**|工廠運作效率提升、交期縮短、成本降、即時生產管制、智慧預警、品質改進
- **解決方案覆蓋**|MES + 設備整合 + 檢測數據收集 + 參數管理 + 生產管制 + 品質管理 + 生產管理指揮中心
- **產業覆蓋**|LED、半導體、電子製造
- **優勢**|工研院背書、政府補助專案友善、中小型客戶負擔得起
- **劣勢**|技轉商品化能量分散(有多家 iMES vendor)、大型 enterprise 不足
- **來源**|`digihua.com.tw/en/imes`、`flowring.com/imes`

### 3.10 Ignition + Sepasoft MES(平台型)

- **定位**|Ignition(Inductive Automation)為 **SCADA-first 平台**,Sepasoft 為策略夥伴提供 MES 模組
- **Sepasoft MES 核心模組**|
  - **OEE Downtime**|停機原因識別、效能優化、品質改進
  - **Track & Trace**|全製程 traceability + 品質 / 法規標準
  - **SPC(Statistical Process Control)**|統計品管
  - **Recipe / Changeover**|配方管理與換線
- **標準對齊**|**ISA-95 aligned**(Industry 4.0 標準)
- **平台優勢**|Ignition 本身即 SCADA + IIoT + HMI,無限授權 tag(一次授權)
- **架構**|On-prem / Edge,支援自建 Cloud 部署
- **優勢**|SCADA + MES 一體、授權模式友善(vs Tier 1 per-seat / per-tag)、Node-RED style 開發彈性、活躍社群
- **劣勢**|MES 模組相對 Tier 1 淺(高階排程 / APS 弱)、需開發者能力
- **來源**|`inductiveautomation.com/ignition/modules`、`sepasoft.com`

### 3.11 Odoo Manufacturing + Shop Floor(開源 / 整合平台)

- **定位**|Odoo ERP 之製造模組(MRP + MES 一體),開源 Community + Enterprise 商用版
- **核心模組**|
  - **MRP I**|BOMs、Routings、Work Orders、MRP Runs
  - **MRP II**|Capacity Planning、MPS(Master Production Schedule)、Quality Control、Maintenance、**MES integration**
  - **Shop Floor(MES)**|Barcode terminals + 觸控 kiosks + Work Center Control Panel
  - **PLM**|Product Lifecycle Management
  - **Quality**|Quality Control Points(QCPs)+ ISO 9001 相容
- **IoT 整合**|IoT Box|對接 barcode 印表機、自動化 quality 量測、機台設定
- **架構優勢**|MRP + MES + PLM + Quality + Shop Floor + Maintenance **一個平台**
- **優勢**|開源、Community 版免費、模組化擴充、國際社群活躍(⚠️ 原記「Weyver 路線 A 之 Odoo fork 直接受益」已失效 —— 不 fork,僅作為**功能對照基準**)
- **劣勢**|SCADA / OPC-UA 深度整合弱(需自建 gateway 或整合 3rd-party)、Enterprise 版仍是每 user 訂閱
- **來源**|`odoo.com/app/manufacturing`

---

## 4. 詳細功能對照矩陣

> ✅ 完整 / 🟡 部分 / ❌ 無 or 需額外模組

| 功能 / 廠商 | SAP DMC | Siemens Opcenter | Rockwell FT | GE Proficy | Aveva | Critical Mfg | 資通 ciMes | 鼎新 TIPTOP | 工研院 iMES | Ignition+Sepasoft | Odoo Mfg |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 資源分配與狀態 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| 詳細排程 / APS | ✅ | ✅(專門模組) | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅(5.1+) | 🟡 | ❌ | 🟡 |
| 派工(工單分派) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 文件控制 / 電子作業指示 | ✅ | ✅(Digital WI) | ✅(eWI) | ✅(eSOP) | ✅ | ✅ | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| 資料收集(手動+自動) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅(Ignition 強項) | 🟡(IoT Box) |
| 人力 / 工時管理 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| 品質管理 / SPC | ✅ | ✅ | ✅ | ✅(SQC) | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅(SPC 模組) | ✅(QCP) |
| 製程控制 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 |
| 維修管理 | 🟡 | ✅ | ✅ | ✅(predictive) | 🟡 | ✅ | ✅(預修保養) | 🟡 | 🟡 | 🟡 | ✅ |
| 產品追蹤 / 族譜 | ✅(Traceability) | ✅(Genealogy) | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅(Track&Trace) | ✅(Lot/Serial) |
| OEE / 效能分析 | ✅ | ✅ | ✅ | ✅(核心) | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅(OEE Downtime) | 🟡 |
| **SCADA / OPC-UA 整合** | 🟡(Kepware) | ✅(原生 + Industrial Edge) | ✅(自家 PLC) | ✅(IIoT) | ✅ | ✅(IoT Platform) | 🟡(需整合) | ❌(需第三方) | 🟡(設備整合) | **✅(Ignition 核心)** | 🟡(IoT Box) |
| **ERP 整合** | ✅(SAP zero-friction) | ✅(SAP / 其他) | ✅(EIHub) | ✅ | ✅ | ✅ | ✅ | ✅(TIPTOP zero) | ✅ | 🟡 | ✅(Odoo 一體) |
| **AI / ML 分析** | ✅ | ✅(2026 focus) | 🟡 | ✅(predictive) | 🟡 | ✅(c-Alice 圖像) | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| **Cloud SaaS 版** | ✅(原生) | ✅(Opcenter X) | 🟡(FactoryTalk Cloud 即將) | ✅(AWS) | 🟡 | 🟡 | 🟡 | ❌ | ❌ | 🟡(自建) | ✅(Odoo Cloud) |
| **多語言(繁中)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅(強項) | ✅(母語) | ✅(母語) | 🟡 | ✅ |
| **開源 / 可 fork** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡(Ignition 社群強) | ✅(Community 免費) |
| **產業別 variant** | ✅(多) | ✅(5 種) | 🟡(templates) | ✅(3 種) | ✅(process 為主) | ❌(僅半導體) | 🟡 | 🟡 | 🟡 | ❌ | 🟡 |

---

## 5. 台灣市場現況

### 5.1 客戶產業分佈

| 產業段 | 常見 MES 選擇 |
|---|---|
| **半導體 / 面板 / IC 封測** | Critical Manufacturing、Siemens Opcenter Semiconductor、資通 ciMes、自研 |
| **汽車 / 電子 EMS** | Siemens Opcenter、Rockwell FactoryTalk、SAP DMC、資通 ciMes |
| **中大型製造(化工 / 醫藥)** | Aveva、SAP DMC、Siemens Opcenter Process/Pharma |
| **中小型製造(金屬 / 機械 / LED)** | 資通 ciMes、鼎新 TIPTOP MES、工研院 iMES / 鼎華 |
| **食品 / 傳產** | **市場空缺**|多數用 Excel + Ragic / Airtable 補洞,少數用 鼎新/正航 ERP 附掛簡易 MES |
| **中小企業(工廠 < 500 人)** | 工研院 iMES 系列、Odoo Manufacturing、自建 |

### 5.2 客戶採購邏輯

- **鎖 ERP 生態**|已用 SAP → SAP DMC;已用 Rockwell PLC → FactoryTalk;已用 TIPTOP → 鼎新 MES
- **產業特殊性**|半導體必挑 Critical Manufacturing / Siemens Semiconductor 級
- **政府補助**|中小企業智慧製造補助多對接工研院 iMES 系列
- **對 Cloud SaaS 之接受度**|台灣製造業普遍**保守**,多數仍偏好 On-prem;食品 / 中小企業對 SaaS 接受度上升(尤其 Ragic 用戶)

### 5.3 市場空缺(Weyver 潛在切入點)

1. **中小型製造 Cloud SaaS MES**|國際 Tier 1 太貴、台灣本土偏 On-prem
2. **食品 / 傳產 通用 MES**|完全空缺
3. **多 ERP 客戶的 pluggable MES**|多數 MES 綁定單一 ERP,Weyver Q 模組 N-way pluggable adapter 為差異化
4. **Ragic-like self-service 表單**|MES 業界普遍需 SI 顧問客製,Weyver 之表單引擎可讓客戶自訂 workflow

---

## 6. 對 Weyver 的策略意義

### 6.1 競爭 / 對接 / 借鑑 分類

| 廠商 | 對 Weyver 之關係 | 說明 |
|---|---|---|
| SAP DMC | **競爭(高端)** | 大型製造客戶會考慮,Weyver 打不進(價位差 10-100x) |
| Siemens Opcenter | **競爭(高端)** | 同上 |
| Rockwell FactoryTalk | **不直接競爭** | 綁 Rockwell PLC,不同市場 |
| GE Proficy | **參考架構** | Cloud-native + low-code 值得學習 |
| Aveva MES | **參考架構** | Composable frontline operator interface 值得學習 |
| Critical Manufacturing | **不競爭** | 半導體專門,Weyver 不進 |
| **資通 ciMes** | **主要競爭** | 台灣本土龍頭,同客群(製造中小型 - 中型),需正面對打 |
| **鼎新 TIPTOP MES** | **主要競爭(pipeline 17 家原本客群)** | 現存 pipeline 中已用 TIPTOP 的客戶,Weyver 是要**取代 vendor** |
| 工研院 iMES / 鼎華 | **半競爭 / 半對接** | 若客戶已導入 iMES,Weyver Q 模組可對接;新客戶直接與 Weyver 選擇一 |
| **Ignition + Sepasoft** | **⭐ 對接夥伴(Edge Gateway 選項)** | v1.6 A11 假設之 Edge Gateway 替代方案 |
| **Odoo Manufacturing** | **對照基準**(⚠️ 原記「路線 A fork 基礎」已失效)| **不 fork**;T 模組全自研 TS,Odoo 僅作為 MES/MRP 的功能對照與 domain 學習來源(限公開文件,CC BY-SA)|

### 6.2 Weyver 差異化路徑

| 面向 | 國際 Tier 1 | 台灣本土 | Weyver v1.6 |
|---|---|---|---|
| 定價 | 高($100K+/site) | 中 | **低(SaaS 月費)** ⭐ |
| 部署 | On-prem 為主(SaaS 選項增加中) | On-prem | **Cloud SaaS + Edge Gateway hybrid** ⭐ |
| 產業別 | 汽車 / 半導體 / 醫藥 深度 | 電子 / 半導體為主 | **通用平台 + pilot 食品 / 團膳** |
| ERP 整合 | **綁自家 ERP** | **綁自家 ERP** | **N-way pluggable adapter** ⭐(核心差異化) |
| 表單客製 | 需 SI 顧問 | 需 SI 顧問 | **Ragic-like self-service 表單引擎** ⭐(核心差異化) |
| Cloud 原生度 | 部分(轉型中) | 弱 | **原生 Cloud + Edge hybrid** ⭐ |
| 開源 | ❌ | ❌ | **✅(全自研 TS,OSS-only 技術棧;⚠️ 非 fork Odoo)** |

### 6.3 對 v1.6 T 模組 spec 撰寫之具體借鑑

**現場執行 UI**|
- 參 GE Proficy Composable low-code 概念,Weyver T 之現場 UI 用 Ragic 表單引擎可自訂
- 參 Aveva 之 Composable frontline operator interface,平板 / 掃碼優先
- 參 Odoo Shop Floor barcode terminals + 觸控 kiosks 之簡潔設計

**Edge Gateway**|
- 首選 **Node-RED base + docker 部署**(自研,主要控制權)
- 替代方案 **Ignition 授權**(A11 假設,授權 $500-2000/site/年,適合有 SI 資源客戶)
- 學 Siemens Industrial Edge 之邊緣運算模式

**OEE / 稼動率**|
- 參 Sepasoft OEE Downtime 模組之停機原因分類法
- 參 GE Proficy 之自動 downtime 分析

**排程 vs 實績**|
- 目前不做進階 APS(參 Siemens Opcenter Advanced Scheduling 級複雜,超 Weyver MVP scope)
- 用 Odoo Manufacturing MPS 12-week 排程之簡單版

**Traceability**|
- 對照 Siemens Genealogy 概念、Sepasoft Track & Trace、Odoo Lot/Serial
- Weyver M 模組(泛產業批次追蹤)+ T 現場執行 資料串聯

**AI / ML 進階**|
- Phase 2 才碰(參 SAP DMC / GE Proficy predictive analytics)
- Critical Manufacturing c-Alice 圖像 AI 為長期參考,Weyver 短期不做

### 6.4 建議 pilot 策略

- **不追 Tier 1 客戶**(SAP / Siemens 用戶)—— 定位錯位
- **鎖定中小型製造 300-2000 人廠**|多數用資通 ciMes / TIPTOP MES / 工研院 iMES,Weyver 差異化明顯(價位 + Cloud + 表單客製)
- **首波食品 / 團膳客戶**|MES 市場空缺,泛產業批次追蹤 + 現場執行 UI 精簡版即滿足 80% 需求
- **Edge Gateway 起點**|Node-RED base + docker,先支援 OPC-UA + Modbus + MQTT 三種主流協定,涵蓋 80% 台灣中小廠機台

---

## 7. 待補研究

- [ ] 各廠商實際 pricing 詢價(Tier 1 每 site 授權費、Cloud SaaS 每月)
- [ ] 訪談既有 MES 用戶(鼎新 / 資通)痛點清單,反映在 Weyver T 模組 spec
- [ ] Ignition + Sepasoft 授權模式深度評估(vs 自研 Node-RED gateway 成本 / 風險比較)
- [ ] Odoo Manufacturing / Shop Floor 模組實際 fork PoC(路線 A 假設驗證)
- [ ] 台灣 SCADA / OPC-UA gateway 主流廠(Kepware / Ignition / Aveva Historian)實際客戶 penetration
- [ ] 半導體 MES(Critical Manufacturing)是否為 pluggable adapter 對接對象(若 pilot 客戶擴散至半導體 supply chain 之上游中小廠)

---

## 8. 資料來源

- SAP 台灣資源頁|`www.sap.com/taiwan/resources/what-is-mes`
- SAP Digital Manufacturing|`www.sap.com/products/scm/digital-manufacturing.html`
- Siemens Opcenter|`www.siemens.com/en-us/products/opcenter/`、`resources.sw.siemens.com`
- Rockwell FactoryTalk|`www.rockwellautomation.com/en-us/products/software/factorytalk/operationsuite/mes/`
- GE Proficy Smart Factory|`www.gevernova.com/software/products/manufacturing-execution-systems`
- Aveva MES|`www.aveva.com/en/products/manufacturing-execution-system/`
- Critical Manufacturing|`www.criticalmanufacturing.com`
- 資通 ciMes|`cimes.ares.com.tw`
- 鼎新 TIPTOP|`www.digiwin.com.tw/software/696.html`
- 工研院 iMES(鼎華)|`digihua.com.tw/en/imes`
- Ignition|`inductiveautomation.com/ignition/modules`
- Odoo Manufacturing|`www.odoo.com/app/manufacturing`
- ISA-95 標準|International Society of Automation
- MESA 11 核心功能|Manufacturing Enterprise Solutions Association(1997)
- Gartner 2026 Market Guide for MES(次級引用)

---

## 版本

- **2026-07-16 v1**|首版。11 家廠商(6 國際 Tier 1 + 3 台灣本土 + 2 平台開源)+ 詳細功能對照矩陣 + 台灣市場分析 + 對 Weyver v1.6 T 模組之策略含意。配合 `docs/04-完整產品功能表.md` v1.6 之 T 模組 spec 使用。
