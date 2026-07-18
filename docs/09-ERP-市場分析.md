# 主流 ERP 市場分析報告

> **研究目的**|Weyver 定位為「Ragic 基底 + 結合主流 ERP 的多產業通用企業級平台」,需系統性理解主流 ERP 之完整功能範疇、模組結構、市場區隔,以支援 docs/04 J-Q 模組 spec 撰寫與競爭定位。
> **研究範圍**|11 家主流 ERP:國際 Tier 1(5 家)+ Cloud SME(1 家)+ 中國本土(2 家)+ 台灣本土(2 家)+ 開源(1 家)。
> **研究方法**|公開資訊(廠商官網、Product Sheet、ERP Research、TEC、Gartner 摘要)。
> **版本**|2026-07-16 v1

---

## 1. ERP 定義 & 演進

### 1.1 定義

**ERP(Enterprise Resource Planning)= 整合企業各部門(財務 / 進銷存 / 生產 / HR / CRM)之資訊系統,以單一資料模型與流程貫串**,提供:
- 財務會計與管理報告
- 訂單到現金(O2C)+ 採購到付款(P2P)全流程
- 生產計畫、庫存、供應鏈可視化
- 人力資源與薪資
- 客戶關係與商機管理

### 1.2 演進世代

| 世代 | 特徵 | 代表 |
|---|---|---|
| MRP(1970s) | 物料需求計畫 | 早期 IBM |
| MRP II(1980s) | + 產能規劃 | SAP R/2、Oracle |
| **ERP I(1990s)** | 整合各部門 | SAP R/3、Oracle EBS、鼎新 TIPTOP |
| **ERP II(2000s)** | + Web、跨企業 | SAP ECC、Dynamics、NetSuite |
| **後 ERP / Cloud ERP(2010s-)** | Cloud-native、AI、行動、開放 API | SAP S/4HANA、Workday、Odoo、Weyver |

### 1.3 ISA-95 位階

ERP 於 ISA-95 之 **Level 4(Business Planning & Logistics)**,對接 Level 3(MES,見 docs/08)向下整合現場。

---

## 2. 主流 ERP 廠商分類

### 2.1 分類總覽

| 分類 | 廠商 | 產業聚焦 | 部署 | 目標客戶 |
|---|---|---|---|---|
| **國際 Tier 1(大型集團)** | SAP S/4HANA | 通用 + 製造 / 化工 / 零售 | Cloud / On-prem | Fortune 500 |
| 國際 Tier 1 | Oracle NetSuite | 通用中大型 | Cloud only | 中大型 SME、成長型企業 |
| 國際 Tier 1 | Microsoft Dynamics 365(BC + F&O) | 通用 | Cloud + Hybrid | SMB(BC)+ 大型(F&O) |
| 國際 Tier 1 | Workday | 通用(強項 HCM + Fin) | Cloud only | 中大型服務業 / 專業服務 |
| 國際 SME | SAP Business One(B1) | SMB 通用 | Cloud + On-prem | 中小企業(10-500 人) |
| **Cloud SME** | Zoho ERP / Katana / Cin7 | SMB / 小型製造 | Cloud only | 小型 SME |
| **中國本土** | 用友 Yonyou(U8 / U9 / NC / YonSuite) | 通用 + 集團 | On-prem / Cloud | 中國 SMB → 大型集團 |
| 中國本土 | 金蝶 Kingdee(K/3 Cloud / EAS / 星空) | 通用 + 集團 | Cloud + On-prem | 中國 SMB → 大型 |
| **台灣本土** | 鼎新 TIPTOP GP / T100 / Workflow ERP | 通用 + 製造 | On-prem | 台灣 SMB → 中大型 |
| 台灣本土 | 正航 ERP(T8 系列 / 一號 / 三號 / 五號 / 七號) | SMB 通用 | On-prem | 台灣中小企業 |
| **開源 / Mid-market** | Odoo(Community + Enterprise) | 通用 + 製造 | Cloud + On-prem | SMB → 中型 |
| 開源(次要) | ERPNext(Frappe) | SMB 通用 | Cloud + On-prem | 小型 SME、印度為主 |

---

## 3. 各廠商詳細分析

### 3.1 SAP S/4HANA(國際 Tier 1 龍頭)

- **定位**|SAP 新一代 ERP,以 HANA in-memory DB 為底,替代舊 ECC
- **~12 個核心模組**|
  - **FI**(Finance)|GL / AP / AR / Bank / Fixed Asset / Travel / Funds
  - **CO**(Controlling)|成本會計 / 利潤中心
  - **SD**(Sales & Distribution)|O2C 全流程(訂單 / 定價 / 出貨 / 開票 / 客服)
  - **MM**(Materials Management)|採購 / 庫存
  - **PP**(Production Planning)|生產排程 / 物料規劃 / 產能
  - **QM**(Quality Management)|品質檢驗 / 供應鏈品質
  - **PM**(Plant Maintenance)|設備保養(preventive + condition-based)
  - **PS**(Project System)|專案管理(時程 / 成本 / 資源)
  - **HCM**(Human Capital Management)|HR + 薪資 + 績效 + 訓練
  - **EWM**(Extended Warehouse Management)|進階倉儲(WM+)
  - **EHS**(Environmental Health & Safety)|法規合規(事件 / 危險物料)
- **優勢**|完整、大型集團標配、AI/ML 內建、SAP 生態
- **劣勢**|貴(百萬美元起)、複雜、需大量顧問導入
- **來源**|`erpresearch.com/en-us/sap-s/4-hana-modules`

### 3.2 Oracle NetSuite(Cloud Tier 1)

- **定位**|Oracle 之 Cloud-native ERP,強項 SaaS + 統一資料模型
- **基本授權含**|Financial Management + Order Management + Inventory + CRM + Platform Tools(~$999/月起)
- **主要模組**|
  - **Financials**|GL / AP / AR / 財報 / 現金管理 / **多幣別 + Multi-book Accounting**(平行會計準則)
  - Fixed Assets + 折舊
  - **Planning and Budgeting(PBCS)**|企業績效管理
  - **Advanced Financials**|Recurring journal + Amortization
  - **Revenue Management**|ASC 606 / IFRS 15 自動化
  - Credit and Collections
  - **Procurement**|採購全流程
  - **Manufacturing** / **Supply Chain** / **Warehouse Management(WMS)**
  - **CRM**|銷售 / 行銷 / 客服 / 夥伴
  - **HR** / **Payroll**|薪資自動化(US)
  - **SuiteCommerce**(電商平台)
  - **Professional Services Automation(PSA)**|服務業導向
- **優勢**|Cloud 原生、模組化 add-on、電商整合、AI/ML 積極
- **劣勢**|每 user 授權費不便宜、客製化需 SuiteScript 開發
- **來源**|`netsuite.com/portal/resource/articles/erp/netsuite-modules.shtml`

### 3.3 Microsoft Dynamics 365(BC + F&O)

- **兩個層次**|
  - **Business Central(BC)**|SMB 目標(< 500 人),Essentials + Premium 授權層
  - **Finance & Operations(F&O)**|大型 + 複雜製造 目標
- **Business Central Essentials**|Financial Management + Sales & Marketing + Purchasing & Payables + Inventory + Project Management + Warehouse Management + Human Resources
- **Premium 加**|Service Order Management + Manufacturing
- **核心功能**|
  - GL / AP / AR / Budgeting / Financial Reporting / Bank / Fixed Assets / 多幣別 / 多公司合併
  - WMS|multi-location、pick-pack-ship、barcode、bins、directed put-away、wave / batch picking
  - Project Management|timesheets、budget-to-actuals、WIP、Milestone billing
- **優勢**|Microsoft 生態零摩擦(Office / Teams / Azure)、Power Platform 整合、Cloud 原生
- **劣勢**|SMB 版 BC 深度不如 F&O、台灣客戶較少
- **來源**|`learn.microsoft.com/en-us/dynamics365/business-central/finance`

### 3.4 Workday(Cloud Tier 1,強項 HCM + Fin)

- **定位**|Cloud-only,原生 HCM 龍頭 + 進 Financial Management 市場
- **HCM 模組**|Human Resource Management、Talent Management、Recruiting & Onboarding、Payroll、Time Tracking、Learning & Development、Benefits、Performance
- **Financial 模組**|
  - Core Financials|GL / AP / AR / Cash Management
  - Asset Management(有形 + 無形)
  - Expense Management(mobile + AI 反舞弊)
  - Revenue Management、Financial Reporting、Budgeting、Spend Management
  - **Workday Prism**|即時分析 + ML 異常偵測
- **優勢**|HCM 業界頂尖、Cloud 原生 / 零維運、AI/ML 內建
- **劣勢**|**製造 / 供應鏈 弱**(不是強項)、貴、台灣不如美國主流
- **來源**|`workday.com`

### 3.5 SAP Business One(B1,SMB)

- **定位**|SAP 為 SMB(10-500 人)設計的 ERP,對接 S/4HANA 集團 vision
- **主要模組**|Financials(GL/AP/AR/Bank/Fixed Assets)+ Sales & CRM + Purchasing + Inventory + Production(Simple)+ Service(Warranty & Support)+ Analytics + HR
- **技術**|**SAP Service Layer(SLD)**|Odata REST API(這正是 Weyver Q 模組 pluggable adapter 對接 SAP B1 的入口)
- **部署**|On-prem + Cloud + Partner 託管
- **優勢**|SAP 品牌認可、SMB 完整、SLD 開放
- **劣勢**|中國 / 台灣 SMB 市場鼎新 / 正航 佔優,SAP B1 客戶多為國際企業台灣分公司
- **來源**|`sap.com/products/business-one.html`

### 3.6 Odoo(Community + Enterprise,開源)

- **定位**|開源 ERP + 商業 SaaS 雙軌,**> 15,000 模組**(官方 + 3rd party)
- **主要模組類別**|
  - Finance|Accounting / Invoicing / Expenses / Documents / Spreadsheet
  - Sales|CRM / Sales / Point of Sale / Subscription / Rental
  - **Supply Chain**|Inventory / Purchase / Manufacturing(MRP)/ Quality / PLM / Maintenance
  - Human Resources|Employees / Recruitment / Time Off / Attendances / Appraisal / Fleet
  - Marketing|Email / SMS / Social / Marketing Automation / Events
  - Services|Project / Timesheets / Field Service / Helpdesk
  - Productivity|Discuss / Approvals / Knowledge / Sign / Planning
  - Website & eCommerce|Website Builder / eCommerce / Blog / Forum
  - Customization|Studio(low-code)
- **雙授權模式**|Community(免費開源)+ Enterprise(訂閱付費,含官方 support + hosting + 進階 apps)
- **架構**|Python + PostgreSQL + JavaScript,ORM 特殊(遞迴繼承)
- **優勢**|**開源可 fork**(Weyver 路線 A 基礎)、模組化極致、國際社群活躍
- **劣勢**|ORM 學習曲線陡、Enterprise 訂閱按 user、SCADA / MES 深度弱
- **來源**|`odoo.com`

### 3.7 鼎新 TIPTOP GP / T100(台灣本土龍頭)

- **定位**|台灣本土 ERP 龍頭,涵蓋 SMB 到大型集團
- **產品線**|
  - **TIPTOP GP**|大型集團(跨國多據點、多語言、台灣保稅 + 大陸海關 特化)
  - **T100**|next-gen 企業智慧雲平台,取代 GP
  - **Workflow ERP**|中小型
- **標準模組代碼**|三位字母代碼('a' = 台灣、'g' = 大陸、'c' = 客製化)
- **主要模組**(部分)|
  - **aap**(Accounts Payable)、**aar**(AR)、**agl**(GL)|財會
  - **aim**(Inventory Management)|進銷存
  - **apm**(Purchasing / Procurement)
  - **atm**(Asset Management)
  - **cbm**(Project Management)
  - 其他:BOM / MRP / MPS / 品保 / 成本 / HR / 薪資 等 20+ 主模組
- **TIPTOP GP 5.1+**|新增進階排程(可日 / 時級物料需求)
- **市佔**|台灣 / 中國 / 東南亞市佔高、客戶滿意度高
- **優勢**|台灣本地化(統一發票 / 電子發票 / 勞健保)、大量客戶樣本
- **劣勢**|**技術棧偏老**(Genero / Informix 為主)、Cloud 轉型較慢、客製化需 4GL 工程師
- **來源**|`digiwin.com.tw`

### 3.8 正航 ERP(台灣本土 SMB)

- **定位**|台灣中小企業 ERP,樂高式模組化
- **產品線**|正航一號 / 三號 / 五號 / 七號 / T8(從 SMB 微型到中型階梯)
- **模組**|
  - **財務管理**|多樣化財報、即時資金流向
  - **進銷存管理**|採購 / 銷售 / 庫存 / 存貨積壓避免
  - **生產管理**|製令 / 排程 / BOM / 製程回報
  - **人事薪資**|自動計算薪資 + 考勤整合
  - **電子發票與報稅**|台灣特化
- **架構**|8 大循環為標準,依企業屬性由實務領域導入
- **優勢**|SMB 價格 friendly、模組化選配、台灣本地化
- **劣勢**|大型企業不足、Cloud 較弱、國際化限制
- **來源**|`chi.com.tw`、`softwareic.com.tw`

### 3.9 用友 Yonyou(U8 / NC / YonSuite,中國本土)

- **定位**|中國最大 ERP 廠商,涵蓋 SMB 到大型集團(> 1000 集團客戶)
- **產品線階梯**|
  - **U8**|SMB(集中管理)
  - **U8 Cloud / U8C**|SMB Cloud 版
  - **NC**|大型集團(J2EE 架構、集中管理、協同商務)
  - **YonSuite**|next-gen cloud native
- **U8 覆蓋領域**|財務會計 / 供應鏈 / 生產製造 / 管理會計 / 人力資源 / 協同辦公 / CRM / PLM / 分銷 / 零售 / 電商 / BI / 移動
- **供應鏈細分**|合約 / 售前分析 / 銷售 / 出口 / 採購 / 委外 / 庫存 / 存貨 / 品質 / WEB 業務 / 進口
- **NC 特色**|J2EE、跨國、多語言、多稅制、多會計準則、1000+ 集團客戶
- **優勢**|中國市佔第一、集團功能強、多書帳 / 多會計準則、多稅制、行業方案
- **劣勢**|中國本地化為主、台灣客戶少、開放性中
- **來源**|`u8.yonyou.com`、`yonyou.com`

### 3.10 金蝶 Kingdee(K/3 Cloud / EAS / 星空,中國本土)

- **定位**|中國前二大 ERP,B/S 架構、動態領域模型
- **產品線**|
  - **K/3 WISE**|SMB 傳統版
  - **K/3 Cloud(星空)**|Cloud native,支援 HTML5、Oracle DB
  - **EAS**|大型集團版
  - **雲之家**|移動協同(K/3 Cloud 高度整合)
- **K/3 Cloud 覆蓋**|銷售 / 產品研發設計 / 供應協同 / 智能製造 / 財務(利潤中心 + 全成本精細化 + 經營會計)
- **6 大價值**|開放雲協同平台、國際化(多語言 / 多稅制 / 多會計準則)、社交化、移動化、生態整合、成本精細化
- **架構**|B/S、HTML5、Oracle 支援、開放平台
- **優勢**|中國第二市佔、雲原生轉型積極、經營會計獨特
- **劣勢**|同用友,台灣客戶少;Oracle DB 授權費追加
- **來源**|`kingdee.com`

### 3.11 ERPNext(Frappe,開源)

- **定位**|印度出身開源 ERP,MIT license,Frappe framework 底層
- **主要模組**|Accounting / Sales / Purchase / CRM / Manufacturing / HR / Payroll / Projects / Asset Management / Website / Portal / Wiki
- **技術**|Python + MariaDB / Postgres + JavaScript
- **優勢**|真正 MIT 開源、社群成長中、印度市場強
- **劣勢**|台灣使用者少、企業級功能不如 Odoo Enterprise、SI 生態薄
- **來源**|`erpnext.com`

---

## 4. 詳細功能對照矩陣

> ✅ 完整 / 🟡 部分 / ❌ 無 or 需外掛

| 功能 / 廠商 | SAP S/4HANA | NetSuite | Dynamics 365 | Workday | SAP B1 | Odoo | 鼎新 TIPTOP | 正航 | 用友 | 金蝶 | ERPNext |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **GL / 總帳** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **AP / AR** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **多幣別 + 匯兌** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ |
| **多書帳(Multi-book)** | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ❌ | ✅ | ✅ | 🟡 |
| **合併報表(多子公司)** | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 |
| **預算控管** | ✅ | ✅(PBCS) | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ |
| **固定資產 + 折舊** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **收入認列(ASC 606)** | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 | ❌ | ❌ | 🟡 | 🟡 | ❌ |
| **採購(Procurement)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **銷售(O2C)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **庫存管理** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **WMS(進階倉儲)** | ✅(EWM) | ✅ | ✅(WMS) | 🟡 | 🟡 | ✅ | 🟡 | 🟡 | ✅ | ✅ | 🟡 |
| **BOM + 工單** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **MRP** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **APS 進階排程** | ✅ | 🟡 | 🟡 | ❌ | 🟡 | 🟡 | ✅(5.1+) | 🟡 | ✅ | ✅ | 🟡 |
| **品質管理(QM)** | ✅ | 🟡 | ✅ | ❌ | 🟡 | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 |
| **維修(PM / Maintenance)** | ✅ | 🟡 | 🟡 | ❌ | 🟡 | ✅ | 🟡 | 🟡 | ✅ | ✅ | ✅ |
| **專案管理(PS)** | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ❌ | 🟡 | 🟡 | ✅ |
| **CRM** | 🟡 | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟡 | ❌ | ✅ | ✅ | ✅ |
| **HR + 薪資** | ✅(HCM) | ✅ | ✅ | ✅(核心) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Recruiting / 招募 / Onboarding** | ✅ | 🟡 | 🟡 | ✅(強項) | 🟡 | ✅ | 🟡 | ❌ | ✅ | ✅ | 🟡 |
| **Talent / Performance / Learning** | ✅ | 🟡 | 🟡 | ✅(強項) | 🟡 | ✅ | 🟡 | ❌ | ✅ | ✅ | 🟡 |
| **電子發票(台灣)** | 🟡(需 add-on) | 🟡 | 🟡 | ❌ | 🟡 | 🟡 | ✅(母語) | ✅(母語) | ❌ | ❌ | ❌ |
| **勞健保(台灣)** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅(母語) | ✅(母語) | ❌ | ❌ | ❌ |
| **BI / 分析(內建)** | ✅ | ✅ | ✅ | ✅(Prism) | ✅ | ✅ | 🟡 | 🟡 | ✅ | ✅ | 🟡 |
| **AI / ML** | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | ❌ |
| **開源 / 可 fork** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅(Community) | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Cloud SaaS** | ✅ | ✅(原生) | ✅ | ✅(only) | ✅ | ✅ | 🟡(T100) | 🟡 | ✅(YonSuite) | ✅(K/3 Cloud) | ✅ |

---

## 5. 台灣市場現況

### 5.1 客戶產業 vs ERP 選擇

| 產業段 | 常見 ERP 選擇 |
|---|---|
| **大型集團 / 上市櫃** | SAP S/4HANA、Oracle NetSuite、SAP ECC(舊)、鼎新 TIPTOP GP、Workday(HR) |
| **中大型製造(500-5000 人)** | 鼎新 TIPTOP GP / T100、SAP B1、Dynamics 365、Odoo Enterprise |
| **中小型製造(< 500 人)** | 鼎新 Workflow / 正航、Odoo、SAP B1、金蝶(有陸資背景時) |
| **貿易 / 服務業** | NetSuite、Dynamics 365 BC、Odoo、正航 |
| **食品 / 團膳 / 傳產** | **鼎新 TIPTOP / 正航 為主**、部分 Odoo、極少國際大廠 |
| **零售連鎖** | NetSuite SuiteCommerce、Dynamics 365 Commerce |
| **專業服務 / 顧問** | Workday、NetSuite PSA |

### 5.2 台灣 ERP 採購邏輯

- **規模驅動**|上市櫃 → SAP / Oracle;中大型 → 鼎新;SMB → 正航 / 鼎新 Workflow
- **產業別 fit**|製造業偏鼎新;貿易 / 服務業偏 NetSuite / Odoo
- **本地化剛需**|**電子發票 + 勞健保** 是台灣客戶必需,國際大廠需 add-on 或第三方
- **供應商生態**|已有鼎新 → 續用鼎新新版;已有 SAP → 續用 S/4HANA

### 5.3 台灣 ERP 市場空缺

1. **Cloud-native + 本地化(電子發票 / 勞健保)完整**|國際大廠本地化弱,台灣本土 Cloud 化弱
2. **多 ERP 對帳整合**|集團客戶用不同 ERP,對帳靠人工 → **Weyver Q 模組差異化**
3. **Ragic-like self-service 客製**|傳統 ERP 客製化需 4GL / SuiteScript 顧問,SMB 客戶負擔重
4. **中大型 SMB(500-2000 人)Cloud SaaS**|太小不用 SAP,鼎新在此區塊 Cloud 版仍發展中

---

## 6. 對 Weyver 的策略意義

### 6.1 競爭 / 對接 / 借鑑 分類

| 廠商 | 對 Weyver 之關係 | 說明 |
|---|---|---|
| SAP S/4HANA | **不直接競爭** | Fortune 500 客群,Weyver 打不進 |
| Oracle NetSuite | **參考架構(Cloud SaaS 模範)** | Cloud-native SaaS 商業模式與模組化 add-on 值得學習 |
| Microsoft Dynamics 365 | **參考架構(生態整合)** | Power Platform low-code 值得學習 |
| Workday | **不直接競爭** | HCM/Fin 專業服務業客群 |
| **SAP B1** | **⭐ 對接目標(Q 模組)** | v1.6 A1 假設之 3 家 pilot ERP 之一,SLD REST API 對接 |
| **Odoo Enterprise** | **⭐ 對接夥伴 + 路線 A fork 基礎** | Weyver 路線 A 直接 fork Odoo ERP + Manufacturing 為 J-Q 基礎 |
| **鼎新 TIPTOP GP / T100** | **⭐ 主要競爭 + Q 模組對接目標** | pipeline 17 家原客群、v1.6 Q 模組 pilot ERP 之一,DB view 對接 |
| **正航 ERP** | **⭐ Q 模組對接目標** | v1.6 Q 模組 pilot ERP 之一,API 對接 |
| 用友 Yonyou | **未來擴散市場** | 若台灣客戶跨陸子公司,需支援 |
| 金蝶 Kingdee | **未來擴散市場** | 同上 |
| ERPNext | **參考 open source 模式** | Frappe framework 值得參考(比 Odoo 輕) |

### 6.2 Weyver 差異化 vs 主流 ERP

| 面向 | 國際 Tier 1 | 台灣本土 | Weyver v1.6 |
|---|---|---|---|
| **定位** | Fortune 500 / 大型 | SMB - 中型 | **通用平台 + 對接多家 ERP** |
| **定價** | 極高(百萬美元起) | 中(數十萬台幣起) | **低(Cloud SaaS 月費)** ⭐ |
| **部署** | Cloud + On-prem | On-prem 為主 | **Cloud + Edge Gateway hybrid** ⭐ |
| **本地化** | 需 add-on | 母語支援 | **原生台灣本地化(電子發票 / 勞健保)** ✅ |
| **多 ERP 對接** | ❌ 綁自家 | ❌ 綁自家 | **N-way pluggable adapter** ⭐(核心差異化) |
| **客製化門檻** | 高(需顧問) | 高(需 4GL) | **Ragic self-service** ⭐(核心差異化) |
| **開源 / 可 fork** | ❌ | ❌ | **✅(fork Odoo)** |
| **Cloud 原生** | 部分 | 弱 | **✅ 原生** ⭐ |

### 6.3 對 v1.6 J-Q 模組 spec 撰寫之具體借鑑

**J 財會**|
- 參 SAP FI 分項(GL/AP/AR/Bank/Fixed Asset)為完整度基準
- 參 NetSuite Multi-book Accounting、Advanced Financials 為進階功能參考
- 參 Workday Prism 為 BI 進階方向
- 現況|v1.6 J 覆蓋標準 8 項,收入認列 ASC 606 / 進階功能延 Phase 2

**K 進銷存**|
- 參 SAP EWM 為進階 WMS 標準,v1.6 K 涵蓋庫存基本 + 儲位,進階 wave picking / directed put-away 待補
- 參 Odoo Inventory 為模組化參考

**L 生產**|
- 參 SAP PP + Odoo Manufacturing 為完整度基準
- APS 進階排程 v1.6 標暫緩,參 鼎新 TIPTOP 5.1 之進階排程(可作為對接 3rd-party APS)

**M 品保**|
- 參 SAP QM + Siemens Opcenter Quality
- v1.6 覆蓋 IQC/IPQC/OQC + 批次追蹤 + FEFO

**N 成本**|
- 參 SAP CO(Controlling)
- v1.6 標準成本 + 分批成本入 MVP,分步成本延 Phase 2

**O 電子發票 + 台灣特化**|
- **鼎新 + 正航是最強對手**(母語支援)
- Weyver 必須做到 parity 才能取代

**P 進出口**|
- SAP GTS(Global Trade Services)為進階參考
- v1.6 覆蓋進 / 出口報單 + HS Code + 關稅 + 三角貿易

**Q 多 ERP 對帳(Weyver 核心差異化)**|
- **無同業對照**|市場獨有位置
- pluggable adapter 框架設計參考|
  - SAP SLD REST API(B1 對接)
  - 鼎新 TIPTOP DB view / API(TIPTOP 對接)
  - 正航 API
  - Odoo XML-RPC / REST(對接 self-hosted Odoo)
  - Oracle NetSuite SuiteTalk REST(次要)

**R HR**|
- 參 Workday HCM(業界頂尖)為對標
- v1.6 覆蓋員工主檔 + 排班 + 打卡 + 薪資 + 勞健保,進階 Recruiting / Talent / Learning 延 Phase 2

### 6.4 建議 pilot 策略(呼應 v1.6 pipeline 17 家)

- **首波|食品 / 團膳 客戶**|多用鼎新 TIPTOP / 正航,Weyver 走「保留現有 ERP + Weyver 上層 Q 對帳 + Ragic 表單」漸進 upsell 路徑
- **不推翻現有 ERP**|Q 模組定位為「上層整合而非取代」,降低導入摩擦
- **中期 Odoo 自建 ERP 替代**|若客戶願意換 ERP,提供 Weyver 基於 Odoo fork 的自研 ERP(路線 A 目標)

---

## 7. 待補研究

- [ ] 各廠商實際 pricing 詢價
- [ ] 訪談既有鼎新 / 正航客戶痛點清單
- [ ] Odoo Enterprise 授權模式 + 台灣 partner 生態(fork 時的授權疑慮)
- [ ] SAP B1 SLD REST API 對接 spike(Weyver Q 模組 adapter 開發)
- [ ] 鼎新 TIPTOP DB view / API 對接可行性(是否需鼎新授權)
- [ ] 電子發票 + 勞健保 本地化技術規格(政府 API 對接、大平台認證流程)

---

## 8. 資料來源

- SAP S/4HANA|`erpresearch.com/en-us/sap-s/4-hana-modules`
- Oracle NetSuite|`netsuite.com/portal/resource/articles/erp/netsuite-modules.shtml`
- Microsoft Dynamics 365|`learn.microsoft.com/en-us/dynamics365/business-central`
- Workday|`workday.com`(HCM + Financial Management)
- SAP Business One|`sap.com/products/business-one.html`
- Odoo|`odoo.com`
- 鼎新 TIPTOP|`digiwin.com.tw`、`t100.digiwin.com`
- 正航 ERP|`chi.com.tw`、`softwareic.com.tw`
- 用友 Yonyou|`u8.yonyou.com`、`yonyou.com`
- 金蝶 Kingdee|`kingdee.com`、`m.kingdee.com`
- ERPNext|`erpnext.com`
- ISA-95 標準|International Society of Automation

---

## 版本

- **2026-07-16 v1**|首版。11 家 ERP(5 國際 Tier 1 + 1 國際 SME + 2 中國 + 2 台灣 + 1 開源)+ 詳細功能對照矩陣 + 台灣市場 + 對 Weyver v1.6 J-Q 模組策略含意。配合 docs/04 v1.6 + docs/08 MES 分析使用。
