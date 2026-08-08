# 主流 ERP 市場分析報告

> **研究目的**|Weyver 定位為「Ragic 基底 + 結合主流 ERP 的多產業通用企業級平台」,需系統性理解主流 ERP 之完整功能範疇、模組結構、市場區隔,以支援 docs/04 J-Q 模組 spec 撰寫與競爭定位。
> **研究範圍**|12 家主流 ERP:國際 Tier 1(5 家)+ Cloud SME(1 家)+ 中國本土(2 家)+ 台灣本土(3 家,v2 補千奧)+ 開源(1 家)。
> **研究方法**|公開資訊(廠商官網、Product Sheet、ERP Research、TEC、Gartner 摘要)。
> **版本**|2026-08-08 v2(台灣三家深掘 + AI 查證 + ERPNext 授權更正)· 2026-07-16 v1


> 🔴 **2026-08-03 前提更正**|本文件多處以「**Weyver 路線 A = fork Odoo**」為前提撰寫,
> 而該路線已於 **2026-07-16 否決**(docs/04 v2.0 / docs/11 v4:**全自研 TypeScript,不 fork Odoo**,
> domain 學習限純合法來源 A16)。
> **市場分析本體(vendor 能力、功能對照、定價)仍然有效** —— 過期的只是「我方怎麼用它」那一欄,
> 已逐處改正。保留原文脈絡而非刪除,以便日後查得出當時為何那樣判斷。

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
| **台灣本土** | 鼎新 TIPTOP GP / T100 / Workflow ERP / Cosmos / SmartERP / A1 | 通用 + 製造 | On-prem + Cloud(A1 月租) | 台灣 SMB → 中大型 |
| 台灣本土 | 正航 ERP(一號 / T357 / T8 / T9 / NBS) | SMB 通用 | On-prem | 台灣中小企業 |
| 台灣本土(微型) | 千奧資訊(金卡 / ERP6) | 進銷存 / 會計 通用 | On-prem 單機 / 區網 C/S | 微型 / 小型企業(萬元級買斷) |
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

> 🔄 **2026-08-08 v2 深掘更新**|產品線補 Cosmos / SmartERP / A1;AI 全線查證(推翻 v1 矩陣之 🟡 未查證狀態)。

- **定位**|台灣本土 ERP 龍頭,涵蓋微型到大型集團
- **產品線(2026-08-08 官方 ERP 總覽頁查證,五線並存、T100 未取代 GP)**|
  - **T100**|集團型企業
  - **Workflow ERP GP**|中大型製造業(TIPTOP GP 線;跨國多據點、多語言、台灣保稅 + 大陸海關特化)
  - **Cosmos ERP**|中大型流通業
  - **SmartERP**|中小型企業(官方冠名「專為中小企業打造的 AI ERP」)
  - **A1 商務應用雲**|小微型企業,**月租 SaaS**(官方計費頁逐字:「每月600元起」「模組化月租方案,可依需求隨時加租所需模組」)
- **標準模組代碼**|三位字母代碼('a' = 台灣、'g' = 大陸、'c' = 客製化);aap/aar/agl(財會)、aim(進銷存)、apm(採購)、atm(資產)、cbm(專案)等 20+ 主模組(官方公開頁未見此層級,屬實施文件層級)
- **🔴 AI 功能(2026-08-08 查證:已全線鋪開,「鼎新無 AI」不成立)**|
  - **AiGP 全產品線 AI 升級**|官方新聞逐字:「已率先將Smart ERP、Workflow ERP、Cosmos ERP等ERP系統,以及BPM、HRM、BI等系統,全面導入『數智員工』」;Workflow ERP AiGP「搭載**生單、文件總結、報表分析**三大AI助手」
  - **Agent Space**(2026-06-23 官方發布)|「可治理、可協作、可追溯的AI代理運行環境」,接 ERP 數據 + Google Workspace / Gemini Enterprise
  - **METIS ChatFile**|官方逐字:「文件解析技術,結合了微軟OpenAI的GPT生成式AI模型…用對話的方式從文件中快速找到解答」,RAG 建「企業GPT」,可串 BPM / HR / BI
  - **雅典娜 Athena / Indepth AI**|大陸鼎捷主力 PaaS + 多智能體平台;台灣線以 METIS 對應
- **食品業方案(有,官方產業特化頁)**|研發配方管理 / 效期與生產管理 / 品質管理,含批號追蹤、HACCP / 食安認證、清真認證;附案例(四海通食品批號追蹤等);方案依規模落 T100 / GP / SmartERP
- **客製化自助能力**|TIPTOP 線客製須 Genero 4GL 工程師(第三方技轉教材,2010 年資料,現況待驗證);SmartERP 自製報表須**加購**報表產生器模組(第三方問答)。**終端使用者自己加欄位:官方未見此能力陳述(未查證,非確證沒有)**。⚠️ AiGP 生單 / 報表分析 AI 助手已部分繞過此限制 —— 對外措辭不可稱「鼎新改欄位一定要寫程式」
- **市佔**|台灣 / 中國 / 東南亞市佔高、客戶樣本大
- **優勢**|台灣本地化(電子發票 / 勞健保:A1 官方手冊有勞健保記帳教學 + 內建雲端電子發票)、產業方案齊、AI 布局積極
- **劣勢**|TIPTOP/T100 線技術棧偏老(Genero / Informix)、客製化仍走工程師 / 顧問路徑(⚠️ 證據為第三方且偏舊,標中等強度)
- **來源(查證日 2026-08-08)**|[ERP 總覽](https://www.digiwin.com.tw/ERP/erp-all.html) · [A1 計費](https://a1.digiwin.com/product/price.php) · [AiGP 數智員工](https://www.digiwin.com/tw/news/3551.html) · [Workflow ERP AiGP](https://www.digiwin.com.tw/software/WF/WF) · [SmartERP AI ERP](https://www.digiwin.com.tw/dsc/solution/WB002839/AISM) · [Agent Space](https://www.digiwin.com.tw/news/3640.html) · [METIS ChatFile](https://www.digiwin.com.tw/dsc/METIS/ChatFile/index) · [食品業方案](https://www.digiwin.com/tw/dsc/solution/WB002553/WB00255301_produce) · [TIPTOP 4GL 技轉(第三方)](https://magicliao.wordpress.com/2010/12/01/%E9%BC%8E%E6%96%B0-erp-%E6%8A%80%E8%BD%89%E8%AA%B2%E7%A8%8B%E4%B9%8B-tiptop-gp-%E7%A8%8B%E5%BC%8F%E9%96%8B%E7%99%BC/)

### 3.8 正航 ERP(台灣本土 SMB)

> 🔄 **2026-08-08 v2 深掘更新**|v1 當日自記「覆蓋弱需補」,本版補齊;產品梯隊更名 + AI 查證(推翻 v1 矩陣之 🟡 未查證狀態)。

- **定位**|台灣中小企業 ERP,樂高式模組化
- **產品線(2026-08-08 查證;v1 記的「一號/三號/五號/七號/T8」已過時)**|
  - **正航一號**|微型 / 新創,單機版(「單一家公司帳冊、單一倉庫與單一幣別」,經銷商 FAQ)
  - **T357(三號/五號/七號 統稱 T 系列)**|中型製造 / 商貿(三/五/七各自差異官方台灣站未見逐一對照,未查證)
  - **T8**|官方逐字:「正航T8工業ERP系統…萃取兩百多個標準化管理流程,高度適配製造業核心需求」,涵蓋研發 / 供應鏈 / 財務 / 生產製造 / 品質控制 / 人力資源
  - **T9 / NBS**|大中型 / 集團平台(官方「正航雲打卡」App 說明列支援 T、T8、T9、NBS)
  - **雲端**|有雲打卡 App;完整 SaaS 版 ERP 是否存在**未查證**
- **模組級清單(官方頁)**|
  - **財務**|帳款管理 / 應付(「多幣別付款沖帳」)/ 固定資產折舊報廢 / 票據
  - **進銷存**|存貨 / 庫存管理;批號管理官方逐字:「監控每一批的流向與來源…依效期先進先出」
  - **生產**|MRP 生產管理:「產品結構管理(BOM表)、廠內作業管理、**委外作業管理**、多工序生產」,製令產生到訂單完工入庫全程管控
  - **人事薪資**|自動算「底薪、加班、獎金、請假扣款、勞健保、退休金」;「產生勞保局 EDI 格式上傳勞保局」完成加退保
- **🔴 AI 功能(2026-08-08 查證:有兩款具名 AI,「正航無 AI」不成立)**|
  - **正航智能客服助理**|官方逐字:「採用RAG技術,整合了正航系統操作、使用常見問題解答、產品說明等知識庫」
  - **正航系統AI助理**|官方逐字:「利用微軟最新的Semantic Kernel技術,讓企業可以自行設定連接雲端或地端的LLM服務」「使用自然語言提示詞,快速查詢ERP系統中的資料」「**自動產生ERP表單**,例如請假單、費用報銷單等」「利用AI分析ERP資料,產生分析圖表」——⚠️ 與 Weyver 之 NL 查詢 / AI 產表直接重疊
  - **AI 財務管家**|預測下一季營運 / 催收建議 / 需求預測(官方 blog)
- **食品業方案(有,官方成型方案)**|官方逐字:「透過批號管理、生產履歷、食品履歷及品質管理機制…從原料進貨、生產加工到產品出貨的完整追溯體系」「向前追溯原料來源,向後追蹤產品流向」,效期到期預警;經銷商列「食品雲——非追不可 3.0 批號追溯」(對接衛福部非追不可)
- **客製化自助能力**|報表「可依需求自訂格式」(官方);T357 支援銷售訂單等模組之「欄位更名、自訂欄位」+ FastReport 報表編輯器(第三方經銷商)。**終端使用者自建全新表單 / 資料庫:官方未見此宣稱(未查證)**,路徑仍是模組導入 + 經銷商 / 顧問
- **電子發票**|官方:「從ERP轉出銷貨發票內容,上傳財政部電子發票整合服務平台或加值中心」;經銷商稱與財政部 Turnkey 整合
- **定價**|一號買斷制:進銷存 4,280 / 進銷存+帳務 6,200 / 3 合 1 組合 7,980 元含稅(經銷商);T 系列 3–5 使用者約 35–45 萬(社群討論,非官方);官方公開定價頁**未查證**
- **架構**|8 大循環為標準(官方站確認採用;完整 8 項逐字清單未查證)
- **優勢**|SMB 價格 friendly、模組化選配、台灣本地化、食品追溯成型方案
- **劣勢**|大型企業不足、Cloud 較弱、國際化限制
- **來源(查證日 2026-08-08)**|[官網](https://www.chi.com.tw/) · [T8](https://app.chi.com.tw/t8.html) · [MRP 生產管理](https://www.chi.com.tw/production) · [存貨](https://www.chi.com.tw/stock) · [應付/多幣別](https://www.chi.com.tw/accounts-payable/) · [AI 兩助理](https://www.chi.com.tw/blog/chi2aioffer) · [AI 財務管家](https://www.chi.com.tw/blog/chiaisdm) · [食品業方案](https://www.chi.com.tw/blog/poison-spowder) · [批號應用](https://www.chi.com.tw/blog/ferpbnta) · [電子發票](https://www.chi.com.tw/einvoice) · [勞健保 EDI](https://www.chi.com.tw/blog/hrmafc) · [卓爾 欄位自定義(第三方)](http://erp.join2.com.tw/info.asp?id=331) · [futako 定價(第三方)](https://www.futako.com.tw/stock/)

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

- **定位**|印度出身開源 ERP,**GPL-3.0**(⚠️ v1 誤記「MIT」;2026-08-03 AGENTS.md §5-bis 複驗 LICENSE 檔本文為 GPL-3.0 → **只讀公開文件,不得讀原始碼**),Frappe framework 底層
- **主要模組**|Accounting / Sales / Purchase / CRM / Manufacturing / HR / Payroll / Projects / Asset Management / Website / Portal / Wiki
- **技術**|Python + MariaDB / Postgres + JavaScript
- **優勢**|開源、社群成長中、印度市場強
- **劣勢**|台灣使用者少、企業級功能不如 Odoo Enterprise、SI 生態薄
- **來源**|`erpnext.com`(授權查證 2026-08-03,AGENTS.md §5-bis)

### 3.12 千奧資訊(金卡 / ERP6,台灣微型)— 2026-08-08 v2 新增

> **補研究緣由**|首波 pilot 客戶內部三套 ERP 之一(鼎新 / 千奧 / 正航),v1 完全缺席。
> ⚠️ **撞名注意**|做 ERP 的是「千奧資訊有限公司」(kingcard.com.tw,「金卡」系列);公司登記另有「千奧有限公司」(統編 24251907,新北林口)**非同一家**。

- **定位**|**萬元級 Windows 單機 / 區網買斷軟體商**,與鼎新 / 正航差距 1–2 個數量級
- **公司**|台北市大安區;資本額 1,000 萬、員工 32 人(518 徵才頁,第三方);官方簡介逐字:「全心全意投注於『進銷存』、『會計財務』、『進出口貿易』、『電子商務』相關管理軟體的研發與改進」;成立年份查無公開資料
- **產品線**|現行主力 **ERP6** 世代;版本階梯 實用 / 豪華 / 專業 / 企業 / 網路版(經銷商商品標題,第三方);官網有免費試用版 + YouTube 教學 + 每月課程
- **模組(官網 ERP6 企業版功能頁)**|APP-B2B 銷售 / POS 銷售·餐廳 / IFRSs 會計 / 庫存盤點 / 財務分析 / 人資薪資 / 維修服務 / 進出口單據 / 成本管理 / 發票管理 / 雲端庫存查詢;**生產有獨立 MRP 頁**(官方逐字:「物料檔案建檔、工藝路線建檔、製程檔案建檔」「MPS預估、MPS執行、MRP預估、MRP執行」+ BOM / 工單 / 採購建議)
- **電子發票**|官網僅見「發票管理」模組;**財政部電子發票平台整合與否未查證**
- **技術架構**|Windows 桌面軟體、單機或區網 C/S(經銷商:「單機/網路版…win7 win8 win10」);雲端僅「雲端庫存查詢」附加功能,**非雲端 ERP**
- **AI 功能**|**未查證**(已抓取之產品頁均未見;官網多頁 Big5 編碼未能全站確認,依鐵則不得寫「沒有」)
- **定價(第三方比價)**|金卡實用版 NT$8,400 / 視窗企業版一號 NT$8,900 / 網路豪華版一號升 3 人 NT$18,900,**買斷制**
- **對 Weyver 意義**|pilot 客戶用它大概率覆蓋簡單進銷存 / 會計場景;**遷移阻力低**(無雲端黏著、無訂閱綁定),但代表的競爭基準是「便宜、買斷、夠用」—— 取代訴求須勝過「已付清、還能用」的沉沒成本慣性
- **來源(查證日 2026-08-08)**|[官網](https://www.kingcard.com.tw/) · [ERP6 企業版功能](https://www.kingcard.com.tw/index.php?page=product_stkerp6) · [MRP 功能頁](http://www.kingcard.com.tw/index.php?page=mrp_function) · [518 公司簡介(第三方)](https://www.518.com.tw/company-qzkp40.html) · [BigGo 比價(第三方)](https://biggo.com.tw/s/%E5%8D%83%E5%A5%A7%E9%80%B2%E9%8A%B7)

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
| **AI / ML** | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 | **✅**(AiGP / Agent Space / ChatFile,2026-08-08 查證) | **✅**(RAG 客服 + Semantic Kernel 系統助理,2026-08-08 查證) | 🟡 | 🟡 | ❌ |
| **開源 / 可 fork** | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡(LGPL,我方不可 fork / 只讀文件) | ❌ | ❌ | ❌ | ❌ | 🟡(GPL-3.0,我方不可 fork / 只讀文件;v1 誤記 MIT) |
| **Cloud SaaS** | ✅ | ✅(原生) | ✅ | ✅(only) | ✅ | ✅ | 🟡(A1 月租雲為小微線;主力 On-prem) | 🟡(雲打卡 App;SaaS 版 ERP 未查證) | ✅(YonSuite) | ✅(K/3 Cloud) | ✅ |

> **千奧不入本矩陣**|其為萬元級單機 / 區網買斷軟體,與上列 vendor 非同一量級;能力見 §3.12(有 MRP / IFRSs 會計 / POS,無雲端 ERP,AI 未查證)。

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
| **Odoo Enterprise** | **對照基準**(⚠️ 原記「路線 A fork 基礎」已失效)| **不 fork**;J–Q 全自研 TS,Odoo 僅作為功能對照與 domain 學習來源(限公開文件)|
| **鼎新** | **⭐ 主要競爭(被取代對象)** | pilot 客戶現用三套 ERP 之一。⚠️ v2 更新:Q 對接角色已收斂(2026-07-17 決策|客戶放棄原 ERP,至多 onboarding 一次匯入);**AI 已全線鋪開(AiGP / Agent Space / ChatFile),不可再以「傳統 ERP 無 AI」為差異化** |
| **正航 ERP** | **⭐ 主要競爭(被取代對象)** | pilot 客戶現用三套 ERP 之一;同上 Q 收斂。**已有 NL 查詢 / AI 產表單(Semantic Kernel),與 Weyver AI 功能直接重疊**;食品追溯為官方成型方案 |
| **千奧(金卡 / ERP6)** | **被取代對象(低阻力)** | pilot 客戶現用三套 ERP 之一;萬元級單機買斷,無雲端黏著,遷移阻力最低,但須勝過「已付清、還能用」慣性 |
| 用友 Yonyou | **未來擴散市場** | 若台灣客戶跨陸子公司,需支援 |
| 金蝶 Kingdee | **未來擴散市場** | 同上 |
| ERPNext | **參考 open source 模式** | ⚠️ GPL-3.0 只讀公開文件(v1 誤記 MIT);功能對照與 domain 學習來源 |

### 6.2 Weyver 差異化 vs 主流 ERP

| 面向 | 國際 Tier 1 | 台灣本土 | Weyver v1.6 |
|---|---|---|---|
| **定位** | Fortune 500 / 大型 | SMB - 中型 | **通用平台 + 對接多家 ERP** |
| **定價** | 極高(百萬美元起) | 中(數十萬台幣起) | **低(Cloud SaaS 月費)** ⭐ |
| **部署** | Cloud + On-prem | On-prem 為主 | **Cloud + Edge Gateway hybrid** ⭐ |
| **本地化** | 需 add-on | 母語支援 | **原生台灣本地化(電子發票 / 勞健保)** ✅ |
| **多 ERP 對接** | ❌ 綁自家 | ❌ 綁自家 | **N-way pluggable adapter** ⭐(核心差異化) |
| **客製化門檻** | 高(需顧問) | 高(需 4GL) | **Ragic self-service** ⭐(核心差異化) |
| **開源** | ❌ | ❌ | **✅(全自研 TS,OSS-only 技術棧;⚠️ 非 fork Odoo)** |
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

### 6.4 pilot 策略(2026-08-08 v2 對齊現行定位)

> ⚠️ v1 之「保留現有 ERP + 上層 Q 對帳、不推翻現有 ERP」已於 **2026-07-17 被推翻**(CLAUDE.md 架構主張|客戶放棄原 ERP,全面改用 Ragic 範式取代 ERP;Q 收斂為至多 onboarding 一次匯入)。

- **首波|食品 / 團膳 客戶**|現用鼎新 / 千奧 / 正航;R1 先以完整 Ragic 平台 land(遷移既有 Ragic 表單),R2 以計算層補「算」後**全面取代** ERP
- **Q 模組**|多 ERP 對帳角色收斂為 onboarding 一次性匯入(鼎新 DB view / 正航 API / 千奧單機資料檔),非長期並存整合
- **取代論述注意**|三家現用 ERP 中兩家已有 AI(§3.7 / §3.8),對外措辭遵守 docs/30 §6:正面表述,不講「對手做不到」

---

## 7. 待補研究

- [x] ~~鼎新 / 正航 AI 功能查證~~ → 2026-08-08 v2 完成(兩家皆有,見 §3.7 / §3.8;docs/17 教訓之「未查證」欠帳清掉兩家)
- [x] ~~千奧 vendor 分析~~ → 2026-08-08 v2 新增 §3.12
- [ ] 千奧 AI 功能 + 電子發票整合(官網 Big5 編碼未能全站確認,仍未查證)
- [ ] 各廠商實際 pricing 詢價(千奧 / 正航一號已有第三方買斷價;鼎新 A1 有官方月租價;T 系列 / 中大型線仍缺)
- [ ] 訪談既有鼎新 / 千奧 / 正航客戶痛點清單(pilot 客戶內部可直接訪)
- [ ] 鼎新 TIPTOP DB view / 正航 API / 千奧單機資料檔 之 onboarding 一次性匯出格式(Q 收斂後的實際需求)
- [ ] 電子發票 + 勞健保 本地化技術規格(政府 API 對接、大平台認證流程)
- [ ] 鼎新 TIPTOP 客製化現況(4GL 證據為 2010 年第三方,現況待驗證)

---

## 8. 資料來源

- SAP S/4HANA|`erpresearch.com/en-us/sap-s/4-hana-modules`
- Oracle NetSuite|`netsuite.com/portal/resource/articles/erp/netsuite-modules.shtml`
- Microsoft Dynamics 365|`learn.microsoft.com/en-us/dynamics365/business-central`
- Workday|`workday.com`(HCM + Financial Management)
- SAP Business One|`sap.com/products/business-one.html`
- Odoo|`odoo.com`
- 鼎新|`digiwin.com.tw`、`t100.digiwin.com`;v2 深掘來源(含 AiGP / Agent Space / ChatFile / A1 計費 / 食品業方案 官方頁)逐條列於 §3.7,查證日 2026-08-08
- 正航 ERP|`chi.com.tw`、`softwareic.com.tw`;v2 深掘來源(含 AI 兩助理 / 食品業方案 / 電子發票 官方頁)逐條列於 §3.8,查證日 2026-08-08
- 千奧資訊|`kingcard.com.tw`;v2 來源逐條列於 §3.12,查證日 2026-08-08
- 用友 Yonyou|`u8.yonyou.com`、`yonyou.com`
- 金蝶 Kingdee|`kingdee.com`、`m.kingdee.com`
- ERPNext|`erpnext.com`
- ISA-95 標準|International Society of Automation

---

## 版本

- **2026-08-08 v2**|台灣三家深掘 + AI 查證 + 授權更正。(a) **新增 §3.12 千奧資訊**(pilot 客戶三套 ERP 之一,v1 完全缺席;萬元級 Windows 單機買斷,與鼎新/正航不同量級)。(b) **§3.7 鼎新深掘**|產品線五線並存(T100 未取代 GP;補 Cosmos / SmartERP / A1 月租雲);**AI 已全線鋪開**(AiGP 生單·文件總結·報表分析三助手 / Agent Space / METIS ChatFile),清掉 docs/17 教訓之「鼎新 AI 未查證」欠帳;食品業官方特化方案(批號 / 效期 / HACCP)。(c) **§3.8 正航深掘**(v1 當日自記「覆蓋弱需補」)|產品梯隊更名 一號→T357→T8/T9→NBS;**兩款具名 AI**(RAG 客服 + Semantic Kernel 系統助理,可 NL 查詢 / AI 產表單,與 Weyver 直接重疊);食品追溯官方成型方案(含衛福部非追不可對接);委外作業 / 勞保 EDI / 電子發票 Turnkey 模組級補齊。(d) **§3.11 ERPNext 授權更正**|v1 誤記 MIT,實為 **GPL-3.0**(AGENTS.md §5-bis 2026-08-03 複驗)→ 只讀公開文件。(e) §4 矩陣 AI 列鼎新 / 正航 🟡→✅、開源列改標我方可用性;§6.1 / §6.4 對齊 2026-07-17「客戶放棄原 ERP、Q 收斂為 onboarding 一次匯入」定位(v1 之「不推翻現有 ERP、上層 Q 對帳」已推翻)。所有 v2 承重結論附官方逐字引用 + 出處連結 + 查證日 2026-08-08,證據強度(官方一手 / 第三方 / 未查證)逐條標註。
- **2026-07-16 v1**|首版。11 家 ERP(5 國際 Tier 1 + 1 國際 SME + 2 中國 + 2 台灣 + 1 開源)+ 詳細功能對照矩陣 + 台灣市場 + 對 Weyver v1.6 J-Q 模組策略含意。配合 docs/04 v1.6 + docs/08 MES 分析使用。
