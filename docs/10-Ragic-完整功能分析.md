# Ragic 完整功能分析報告

> **研究目的**|Weyver 定位「Ragic 功能為基底 + 主流 ERP + MES + ISO 之多產業通用企業級平台」,需**完整、無遺漏**掌握 Ragic 所有功能與定價結構,以支援 Weyver A-I 模組 spec 撰寫、避免遺漏基底功能、識別 Ragic 局限而 Weyver 需增強之處。
> **研究方法**|Ragic 官方 doc-kb 15 張截圖對照校準(docs/research/ui-screenshots/ragic/)+ Ragic 官網 features + Enterprise Plan doc + 定價頁 + 台灣客戶案例。
> **版本**|2026-07-16 v1

---

## 1. Ragic 產品與公司背景

### 1.1 公司

**Ragic Inc.**|Excel-like 雲端資料庫平台廠商,總部台灣,SaaS 訂閱模式為主。

- **產品定位**|「Excel 式企業雲端資料庫」/「無程式碼(no-code)平台 + 表單為中心」
- **主要競爭定位**|Airtable / Notion Database / Zoho Creator / Microsoft PowerApps 對照
- **創立**|2010 年代早期,台灣本土(海外市佔擴散中)

### 1.2 市場地位

- **使用者國家分佈**|美國 22.71%、**台灣 21.66%**(第二大)、日本、東南亞、歐洲
- **產業覆蓋**|政府 / 迷你倉 / 動物醫療 / 會計師 / 不動產 / 電商 / 製造業 (Ragic 補洞 ERP)
- **合作夥伴**|富士軟片 商業創新(台灣代理)
- **Meta**|Ragic 自己的網站、表單、blog 都是用 Ragic 建的(dogfooding)

---

## 2. Ragic 定價方案

### 2.1 方案結構(2026)

| 方案 | 每位使用者 / 月費 | 最低使用者 | 起價 | 主要限制 / 特色 |
|---|---|---|---|---|
| **免費版** | US$0 | 無 | 免費 | 表單筆數 / 存儲有限,個人 / 學習用 |
| **Starter Plan** | ~US$9 | 3 | ~US$27/月 | 小團隊入門 |
| **Standard Plan** | ~US$19 | 5 | ~US$95/月 | 中小企業標準功能 |
| **Professional Plan** | ~US$39 | 5 | ~US$195/月 | 進階報表 / API / SSO |
| **Enterprise Plan** | **US$55** | **10** | **US$550/月** | **AD SSO / 專屬伺服器 / 測試環境 / SLA** |
| **Enterprise 並行使用者版** | US$139.9(每並行 user) | 10(含在起價) | US$1399/月 起 | 大量非同時在線使用者 |
| **私有主機版** | 自訂 | — | 洽詢 | Weyver 級 on-prem 部署 |

Enterprise Plan **按年付費**(至少 1 年承諾)。

### 2.2 授權基本原則

- **按 user 訂閱**(非 record / storage 定價)
- **上不封頂**(user 越多越貴,無 volume discount 標配)
- **並行使用者版**|適合 shift-based 或間歇使用場景(食品工廠早晚班共用帳號)
- **私有主機**|Enterprise 才有選項,綁至少 1 年

---

## 3. Ragic 完整功能地圖

> 基於 15 張官方 doc 截圖 + 官網 features + doc-kb + 使用者反饋 校準。分 11 大類。

### 3.1 平台 & 帳號管理(基礎)

- **多帳號切換**|同一登入,跨組織 / 帳號切換(ragic-04 截圖確認)
- **管理使用者 + 群組**|Admin 建帳號、加入群組
- **外部使用者**|給客戶 / 供應商填單,不佔 seat
- **應用商店(App Store)**|預裝模板庫(CRM / 進銷存 / HR / 專案 等 100+ 產業範本)
- **付款管理**|訂閱升級 / 使用者增減
- **備份**|自助備份下載
- **資源回收桶**|刪除記錄暫存,可還原
- **個人設定**|使用者偏好、介面語言(多語切換)
- **主題設定**|表單主題色 / 品牌客製

### 3.2 表單設計(Ragic 招牌)

- **Excel-like 網格編輯器**|直接在表格上設計欄位(vs 表單 designer 拖拉)
- **30+ 欄位型別**(ragic-10 截圖確認)|
  - 基本|自由輸入 / 數值 / 日期 / 循環日期 / 百分比
  - 選單|從選單選擇 / 從選單多選 / 打勾選項
  - 關聯|從其它表單選擇(Link & Load)
  - 檔案|檔案上傳 / 圖片上傳
  - 使用者|選擇使用者 / 選擇群組
  - 進階|自動產生(格式化)/ 簽名 / 文字編輯器 / 條碼 / 文字遮罩
- **自動編號 pattern**(ragic-14 截圖確認)|`{0,number,00000}` / `PO-{1,date,yyyyMMdd}-{0,number,000}` 等
- **子表(Subtable / Line items)**|訂單品項、發票明細等一對多結構
- **表單分段(Section)**|同一列可放多個 tab,視覺減壓
- **表單設定**(ragic-01 截圖確認)|存取權限、提醒、簽核流程設定、動作按鈕、條件式格式、主題設定、App 排版顯示順序、快速範本
- **用既有 Excel 建立表單**(ragic-07/08 截圖確認)|**Ragic 差異化 onboarding 神器**|上傳 Excel 自動生成表單 schema
- **快速範本**|從範本庫 clone 表單
- **表單版本 / schema migration**|欄位變更後歷史記錄相容

### 3.3 資料檢視

- **列表視圖**(list view)|預設篩選 / 排序 / 分組
- **Kanban 看板視圖**|依欄位值分組成 board
- **Calendar 行事曆視圖**|依日期欄位視覺化
- **Map 地圖視圖**|依地址欄位放在地圖上
- **樞紐分析(Pivot Table)**|多維度交叉分析
- **單筆表單視圖**|傳統表單 CRUD
- **儲存篩選條件**(saved views)|每人可存自訂視圖(ragic-13 截圖確認)
- **個人化列表欄位選擇**|每人自訂看哪些欄位(ragic-14 截圖確認)
- **左側 quick-filter sidebar**|依欄位值快速篩選 group
- **標星號(star / favorite)**|快速訪問常用資料

### 3.4 公式與自動化

- **公式引擎**|200+ 函式(Excel-like)、跨欄位、跨表計算
- **觸發器(Triggers)**|新增 / 修改 / 刪除 / 條件變化觸發
- **動作(Actions)**|自動更新其它表單 / 寄信 / 呼叫外部 API
- **條件式格式**|欄位值符合條件時改色 / 顯示 icon
- **簽核流程(Approval workflow)**|多層審核 + 委派 + 平行分支
- **提醒(Reminders)**|定時 / 條件觸發通知
- **排程任務**|每日 / 每週 / cron 定時作業

### 3.5 關聯(Link & Load — Ragic 招牌命名)

- **Link & Load**|連結別表 + 自動帶入欄位值
- **Reference 欄位**|純參照(read-only)
- **反向查詢(Reverse lookup)**|從被關聯的表看到誰引用了
- **一對多、多對多**|cascade 規則
- **子表 Link**|訂單明細連結到商品主檔

### 3.6 權限系統(三層)

- **表單級**|哪些人可看 / 編輯 / 刪除該張表單
- **欄位級**|哪些人可看 / 編輯特定欄位
- **記錄級**|哪些人可看 / 編輯特定記錄(依 owner / 業務區域 / 部門)
- **動態權限**|依欄位值判斷(例:業務只看自己客戶)
- **群組管理**|角色 / 部門 / 群組

### 3.7 報表與 BI

- **列表視圖 + 篩選 + 排序 + 分組**
- **樞紐分析(Pivot)**
- **圖表**|Bar / Line / Pie / Gantt / 儀表板
- **儀表板(Dashboard)**|⚠️ **2026-07-30 更正**:原記「拖拉排版 + 多圖表組合」與官方文件不符。Ragic 的[資料儀表板](https://www.ragic.com/intl/zh-TW/doc/7/dashboard-report)是**自動生成、單表單、不可拖拉** —— 官方逐字「各欄位統計數據會**依據表單中的位置,從左到右、從上到下依序排列**顯示」。**真正可拖曳的是[小圖表 widgets](https://www.ragic.com/intl/zh-TW/doc/122/widgets)**(可插在表單頁/列表頁任意位置、可設可見群組);[首頁](https://www.ragic.com/intl/zh-TW/doc/90/customizing-your-database-home)則為**受限直欄版面**(「區塊只能在各自的直欄內調整位置」)。詳見 [F-2 pivot-and-charts](modules/R1/pivot-and-charts.md) §1.2
- **SQL 客製報表**|進階客戶可寫 SQL 客製查詢
- **匯出**|Excel / PDF / CSV / 列印模板

### 3.8 匯入 / 匯出 / API / 整合

- **Excel 匯入**|欄位對映 + 錯誤處理
- **REST API**|**每張表單自動生成 REST endpoint + 文件**(Ragic 差異化)
- **Webhook + Event bus**|新增 / 修改 / 刪除觸發外部 URL
- **OAuth / SSO / SCIM**|企業客戶必要(Standard+ 支援)
- **Public Form(公共表單)**|對外收件 / 客戶自助填單(不佔 seat)
- **API access log**|誰打了什麼 API、多少次
- **網站內嵌(Web embed)**|嵌入自家網站作 lead form
- **寄自訂 E-mail**|從 Ragic 觸發 email 通知

### 3.9 UX / 非功能

- **全文搜尋**|跨所有表單 / 欄位
- **通知系統**|站內 + Email + LINE(台灣)
- **稽核記錄(Audit log)**|完整變更歷史 + 誰改的 + 何時改
- **版本歷史 + 還原**|還原到任意歷史版本
- **PDF / 列印模板編輯器**|自訂列印格式(發票 / 出貨單常用)
- **電子簽章**|Ragic 內建簽名欄位(基本)
- **表單主題色 / 品牌客製**
- **i18n(多語)**|繁中 / 簡中 / 英 / 日 等,線上切換

### 3.10 行動裝置

- **iOS / Android 原生 App**|Ragic Mobile
- **App 排版順序**(ragic-01 截圖確認)|針對行動裝置調整欄位順序
- **離線編輯**|部分支援(有限)
- **平板 + 手機**|RWD Web 也支援

### 3.11 Ops / 後台

- **監控 + 日誌**|Ragic 平台方負責
- **備份**|Enterprise 每日快照 + 使用者可下載
- **災難恢復**|Enterprise SLA 99.99%
- **訂閱計費**|按 user 月費 / 年費
- **客服後台**|Enterprise 客服信件優先處理

---

## 4. Ragic Enterprise Plan 特殊功能

### 4.1 專屬伺服器

- 可選 **AWS / GCP 專屬管理實例**
- **完全控制更新時程**(不會被 Ragic 自動升級中斷)
- 選了專屬伺服器就**必須訂閱 Enterprise**,不可降級

### 4.2 Active Directory 整合(AD SSO)

- 透過 **SAML 通訊協定**設定 AD 單一登入
- Cloud 版或私有主機版均可用
- 對企業級客戶為必要

### 4.3 測試環境

- 除正式資料庫外,**額外提供與正式環境同樣授權人數的測試帳號**
- 適合大改前先測試

### 4.4 服務水準保障(SLA)

- **99.99% 以上可用性**
- 客服信件**優先處理**

### 4.5 私有主機版(Enterprise 才有)

- 部署到客戶自有 infra
- 適合資安嚴格 / 政府 / 金融客戶

---

## 5. Ragic 產業應用案例(台灣)

| 客戶 | 產業 | Ragic 應用 | 效益 |
|---|---|---|---|
| **臺北市政府** | 政府 | 防疫派工系統(3 天內建)+ 跨 27 局處稽查 e 化系統 | **省 > NT$6000 萬公帑** |
| **臺北迷你倉** | 迷你倉儲 | 各表單間資料連結 + 歷史編輯記錄 + 各分店營運 | 統一多分店營運 |
| **杜博動物血庫** | 動物醫療 | 自建適身資訊系統 | **查資料 10 分鐘 → 1 秒** |
| **勤信會計師事務所** | 專業服務 | 帳單發送自動化 | **一週 → 十幾分鐘** |
| **義鼎不動產** | 不動產 | 客戶 / 案件管理 | (未詳述) |
| **富士軟片商業創新** | 代理 | 台灣 Ragic 合作夥伴 | 通路擴散 |

**產業覆蓋**|政府、迷你倉、醫療、專業服務、不動產、電商、製造業(補洞 ERP)、教育。

---

## 5b. Ragic 實務上已被拿來取代 ERP —— 需求驗證與「那道牆」

> **這是 Weyver 整個立論的市場驗證。** 需求端不是猜的,是**觀察到的客戶行為**:客戶已經主動在 Ragic 上重建 ERP 內容,只是撞到一道明確的牆。Weyver 補的正是那道牆。

### 5b.1 客戶已經做到的(Ragic 自由度高,~80% ERP 內容可重建)

Ragic 的**連結與載入 + 子表格 + 公式 + 工作流簽核 + 三層權限 + API**,讓中小廠把大量 ERP 內容原封不動搬進來,用得不錯:

| 已被重建的 ERP 內容 | 為什麼 Ragic 做得到 |
|---|---|
| 進銷存(採購單 / 銷貨單 / 訂單 / 報價) | header + line items 是 Ragic 甜蜜區(子表格)|
| 主檔(客戶 / 供應商 / 商品) | 表單 + Link&Load 關聯 |
| 簡易庫存(進出、數量加減) | 公式 + 關聯累加 |
| 簡易生產(工單追蹤、BOM 存放、領料記錄) | 表單 + 子表 |
| 品質 / ISO(檢驗表、不合格記錄、文件表單) | 表單 + 工作流 |
| HR 基礎(員工 / 請假 / 打卡) | 表單 + 簽核 |
| 單據流程(各式簽核) | 工作流編排 |

對很多中小廠,這「**幾乎就取代 ERP 了**」—— 這是真的,也是 pilot 客戶主動來找開發者做這套系統的原因。

### 5b.2 撞到的牆 —— 「算」不是「填」

Ragic 是**表單資料庫**,不是**計算引擎**。重建到約 80% 後,以下做不到:

| 撞牆處 | 為什麼 Ragic 過不去 |
|---|---|
| **正式會計 / 總帳 GL** | 沒有複式簿記引擎:自動借貸平衡、期末結轉、試算表 / 資產負債 / 損益表。能做「記帳表單」,但不是總帳 |
| **成本會計** | 標準 / 分批 / 分步成本結轉、差異分析 —— 純表單算不出來 |
| **MRP** | 能存 BOM,不會自動需求展開 / 淨需求 / 採購生產建議 |
| **庫存估值** | 加減數量可以,但 FIFO / 加權平均**成本**自動結轉算不了 |
| **稅務 / 電子發票合規** | 需專門整合 |
| **高頻交易 + 嚴格稽核** | 表單資料庫非為此設計 |

### 5b.3 這道牆完美對應 Weyver 的兩層架構

牆的位置,1:1 對應 `docs/15 表單引擎技術設計` 的**兩層資料模型**:

- **Tier 2(使用者自建表單)= Ragic 已擅長、客戶已在做的那 80%**
- **Tier 1(系統實體真實表)+ 計算層 = 那道牆,Ragic 過不去的 20%**

**Weyver = Ragic 範式(彈性)+ 計算層(補牆)+ MES + ISO**。需求端已被客戶行為驗證,缺口端(計算層)清楚可定義。

### 5b.4 一句話 pitch

> **「你已經在拿 Ragic 取代 ERP 了,只是撞到會計、成本、MRP 那道牆。Weyver 把那道牆(計算層)補上,讓你真正 100% 取代 ERP,還順帶加上 MES + ISO —— 全部在同一個 Ragic 範式裡。」**

---

## 6. Ragic 缺點 / 局限(Weyver 需增強之處)

### 6.1 ERP 深度不足

- **沒有 GL / 總帳 合規會計**|需另接 ERP
- **沒有台灣電子發票 API**|需另接 電子發票 vendor
- **沒有 BOM / 工單 / MRP**|製造業客戶只能自建 workaround
- **沒有勞健保 合規薪資**|HR 只能 basic
- **沒有多幣別 匯兌損益 合規邏輯**
- Weyver v1.6 J-R 補足這些

### 6.2 SCADA / MES 現場整合完全無

- Ragic 純 SaaS,無 edge / OT / hardware 對接概念
- Weyver v1.6 T 模組(Cloud + Edge Gateway hybrid)補足

### 6.3 多 ERP 整合概念無

- Ragic 是**單一資料庫**,無跨系統 pluggable adapter 概念
- Weyver v1.6 Q 模組是 Ragic 沒有的差異化

### 6.4 進階 BI / AI 弱

- Ragic 基本 pivot + 圖表足夠,但 **AI/ML / predictive** 幾乎無
- 對比 Workday Prism / SAP DMC 進階分析弱

### 6.5 定價相對貴 for 大 team

- Enterprise US$55/user/月 × 100 user = US$5500/月 = **NT$16.5 萬/月**
- 中大型製造業 200 人用戶,一年 NT$400 萬,不如 SAP B1 / Odoo 一次性授權

### 6.6 客製化到 code 層有限

- Trigger + Action 可設,但**不能直接寫 code 邏輯**(不像 Odoo 可 Python 客製)
- 進階邏輯需外部 API 呼叫

### 6.7 行動 App 深度中等

- 有原生 App,但**離線編輯 / 現場作業(掃碼 workflow)較弱**
- Weyver T 模組要補平板 + 掃碼 現場 UI

---

## 7. Weyver 借鑑點

### 7.1 直接借鑑(Weyver A-I 模組要 parity)

| Ragic 功能 | Weyver 對應模組 | 借鑑原則 |
|---|---|---|
| Excel-like 網格編輯器 | B 表單引擎 | ✅ 直接對應(AG Grid 授權) |
| 30+ 欄位型別 | B 欄位型別 | ✅ 直接對應,加 ERP-specific 型別(科目 / 幣別 / 批號) |
| **用既有 Excel 建立表單** | B(v1.4 補入) | ✅ **Weyver 差異化 onboarding**,必抄 |
| Link & Load 關聯 | D 關聯設計 | ✅ 直接對應,命名可保留 |
| 三層權限(表單 / 欄位 / 記錄) | E 權限系統 | ✅ 直接對應 |
| 動態權限(依欄位值) | E 動態權限 | ✅ 直接對應 |
| 200+ 公式函式 | C 公式引擎 | ✅ 直接對應(第二護城河) |
| Kanban / Calendar / Map / Pivot 視圖 | F 報表 BI | ✅ 直接對應 |
| REST API 每表單自動生成 | G API 整合 | ✅ 差異化,直接抄 |
| Public Form 公共表單 | G Public Form | ✅ 直接對應 |
| SQL 客製報表 | F SQL 客製 | ✅ 直接對應 |
| 電子簽章 | H | 🟡 Weyver 補強合規版(自然人憑證 / TWCA) |
| App Store 範本庫 | B 快速範本 | ✅ 直接對應 |
| AD SSO(Enterprise) | E + G | ✅ 直接對應 |

### 7.2 Weyver 補強(Ragic 弱或無)

| Ragic 弱點 | Weyver 補強 |
|---|---|
| ERP 深度不足(GL/AP/AR/BOM/MRP)| **J-N 完整 ERP 模組**(Odoo fork borrow) |
| 台灣電子發票 API | **O 電子發票**(自研 + 財政部 API) |
| 勞健保合規 | **R 勞健保**(自研 + 政府 API) |
| SCADA / MES 現場 | **T MES Cloud + Edge Gateway hybrid** |
| 多 ERP 整合 | **Q pluggable N-way ERP adapter**(Weyver 差異化) |
| 進階 BI / AI | 對標階段補(Phase 2) |
| 定價 for 大 team | **企業級平台包 base + add-on 定價策略** |
| 現場掃碼 / 平板 UI | **T MES 現場執行 UI 精簡版**(平板 + 掃碼) |
| Odoo-level code 客製 | **開放 Python / JS hook / plugin 架構**(對進階客戶) |

### 7.3 不做(Ragic 有但 Weyver 不追)

- **Ragic 免費版 for 個人**|Weyver 為企業級,不做免費個人版
- **Airtable-style 通用資料庫社群**|Weyver 專注企業 ERP+MES,不追無限制彈性 no-code 定位

---

## 8. 資料來源

- Ragic 官網 features 頁|`www.ragic.com/intl/zh-TW/features`
- Ragic 定價|`www.ragic.com/intl/en/pricing`
- Ragic Enterprise Plan doc|`www.ragic.com/intl/zh-TW/doc-kb/154/whats-included-in-enterprise-plan`
- Ragic 使用者國家分佈|`www.ragic.com/intl/zh-TW/blog/153/`
- Ragic 案例故事|`www.ragic.com/intl/zh-TW/blog/majorType/案例故事`
- 台北市政府案例|`www.ragic.com/intl/zh-TW/blog/`
- 富士軟片合作|`www.fujifilm.com/fbtw/zh-tw/solutions/categories/business-solution/ragic`
- Ragic doc-kb 15 張截圖|`docs/research/ui-screenshots/ragic/`(2026-07-16 抓取)
- Ragic 建立新表單 doc|`www.ragic.com/intl/zh-TW/doc/37/creating-a-ragic-sheet`
- Ragic 表單分段 doc|`www.ragic.com/intl/zh-TW/doc/121/sheet-sections`

---

## 版本

- **2026-07-16 v1**|首版。11 大類功能地圖(平台/表單設計/資料檢視/公式自動化/關聯/權限/報表 BI/API 整合/UX/行動/Ops)+ Enterprise Plan 特殊功能 + 台灣客戶案例 + Ragic 局限分析 + Weyver 借鑑點分類(直接借鑑 / 補強 / 不做)。配合 docs/04 v1.6 之 A-I 模組 spec + Weyver A-U 完整 vision 使用。
- **2026-07-18 v2**|新增 **§ 5b|Ragic 實務上已被拿來取代 ERP —— 需求驗證與「那道牆」**|客戶已在 Ragic 重建 ~80% ERP 內容(觀察到的行為 = 市場驗證),撞牆於「算」(GL/成本/MRP/估值);牆的位置 1:1 對應 docs/15 兩層架構(Tier 2 = Ragic 已擅長 / Tier 1 + 計算層 = Weyver 補的牆)+ 一句話 pitch。同步 docs/04 加 Talking Point 0。
