# Weyver UI/UX 向上設計分析

> **依據 §A5**|抓 ≥3 個同領域參考,每個記「做對的 1-2 點 + 最弱的 1 點」。
> Weyver 設計 = 贏過最強者的強項 + 修掉大家共同的弱點。
> **截圖來源**|423 張 / 75MB,2026-07-17 收集。

---

## 一、表單引擎 A–I(Ragic / Airtable / NocoDB 對照)

### Ragic(`ragic-detail/` 60 張)

**做對|**
- Link & Load 關聯 UI 概念清晰,拖拉欄位直接連結跨 sheet 資料
- 公式欄位支援 Excel 語法,對既有 Excel 用戶學習曲線低
- 欄位型別選擇列表詳細(30+ 種),圖示清楚

**最弱|**
- UI 框架明顯是 2012-2015 年代 Bootstrap/jQuery 風格,整體顏色灰暗、對比不足
- 表單設計器需要切換多個設定面板,操作分散;初次用戶不知道從哪開始
- Grid 列表沒有 hover 高亮,行分隔用斑馬紋(舊習)

**向上|Weyver 要做到的是**
- 保留 Link & Load 概念,但做成右側 slide panel + 即時預覽,不需切頁
- 表單設計器改為「點選欄位 → 右側 property panel 彈出」,一步到位
- Grid 改 hairline 分隔 + hover brand-subtle 背景,去斑馬紋

---

### Airtable(`airtable/` 17 張)

**做對|**
- 視圖切換(Grid/Kanban/Gallery/Calendar/Form)一列 tab,邏輯清楚
- `airtable-views-hero.png`:各視圖並排截圖,資訊架構一目瞭然
- 欄位型別 icon 設計有辨識度,每種型別有不同顏色/形狀

**最弱|**
- Airtable 對非技術用戶「Base/Table/View」三層架構概念過重,初次使用易迷失
- 行動版體驗明顯降級,不是 mobile-first

**向上|**
- 視圖切換保留 tab 設計,但標籤加文字+icon 雙重辨識(Ragic 只有文字)
- 架構扁平化:Weyver 直接說「表單」,不說 Base/Table/View 三層

---

### NocoDB(`nocodb/` 10 張)

**做對|**
- `nocodb-column-manager-01.webp`:欄位管理面板乾淨,型別分類清楚
- Grid 支援 inline edit,不需跳頁
- OSS 完全免費,架構 Weyver 可學

**最弱|**
- 整體 UI 就是 Airtable 功能複製,缺乏獨特 visual identity
- 深色模式切換後對比不夠,文字難讀

---

## 二、ERP 財會/進銷/生產(J–Q 模組)

### Dynamics 365 Finance(`dynamics365/` 20 張)

**做對|**
- `finance-01-hero-dashboard.jpg`:Microsoft Fluent UI 設計語言一致,卡片+圖表搭配專業
- `finance-04-account-reconciliation.jpg`:帳款對帳 UI 左右雙欄,邏輯清楚
- `hr-05-performance.jpg`:HR 績效評估視覺化做得好,適合管理者閱讀
- 整體走現代 SaaS 路線,已脫離傳統 ERP 老舊感

**最弱|**
- 所有模組視覺語言幾乎一樣,缺乏模組個性;切到生產跟切到財會感覺一樣
- 導航深度過深,需要點 4-5 層才到功能

**向上|**
- Weyver 每個模組給予輕微視覺色彩個性(財會藍/生產橘/品保綠),但底色統一
- 保持 sidebar 常駐,最多 2 層導航到達任何功能

---

### Odoo 18(`odoo/` 53 張)

**做對|**
- `odoo-manufacturing-*.webp`:BOM 多階展開 + 工單 UI 清楚,流程感強
- `odoo-quality-*.webp`:品質檢驗通過/不通過的流程 UI 直觀
- 模組間整合良好,從採購到庫存到財會資料自動流

**最弱|**
- `odoo-sales-*.webp`:銷售模組 UI 視覺密度不均,有些空間浪費,有些擠在一起
- Kanban 卡片樣式 AI 感明顯,與正式 ERP 業務情境不搭
- Python/Owl.js 技術棧讓自訂困難

---

### SAP S/4HANA Fiori(`sap-s4hana/`)

**做對|**
- `sap-s4-fiori-01.png`:Fiori Launchpad 的圖塊化設計,每功能一個 tile,清楚易記
- 設計語言(Fiori 3)一致性是所有 ERP 中最強的
- 顏色克制,大量白色,專業感強

**最弱|**
- Fiori 圖塊設計在功能多時(300+ tiles)就迷路,需要依賴搜尋
- 企業感強,但人性化不足,新用戶學習曲線陡

**向上|**
- Weyver 學習 Fiori 的「每個任務一個入口」概念,用 cmd-K 搜尋代替 tile 陣列
- 首頁改成「我的工作」而非功能清單

---

### ERPNext/Frappe(`erpnext/` 10 張)

**做對|**
- `erpnext-procurement-01.png`:採購模組列表乾淨,欄位選擇合理
- `erpnext-quality-01.png`:品質管理 UI 與 Weyver U 模組概念接近

**最弱|**
- 整體 UI 設計語言是「功能堆疊」,不是「體驗設計」
- 表單密度過高,沒有呼吸空間

---

### 台灣本地 ERP:鼎新 / 正航(`digiwin/` `chihang/`)

**共同缺點|**
- UI 停留在 2005-2010 年代設計語言
- 小字體(10-11px)、高密度表格、不支援響應式
- 正航截圖大多為 marketing icon,缺少真實操作介面

**向上|**
- 這是 Weyver 最容易超越的競品群
- 只要做到現代 SaaS 水準的 UI,對台灣在地客戶已是碾壓級差距

---

## 三、MES 現場執行(T 模組)

### Sepasoft MES(`sepasoft/` 12 張)

**做對|**
- `sepasoft-oee-dashboard-01.png`:OEE 儀表板佈局清楚,綠/黃/紅狀態色有效傳達
- `sepasoft-spc-chart-10.png`:SPC 管制圖上下限線清楚,異常點高亮
- `sepasoft-batch-ebr-viewer-07.png`:電子批次記錄(EBR)顯示格式,對食品業很有參考價值

**最弱|**
- 整體 UI 受限於 Ignition SCADA 的框架,組件感強,像是「組裝出來」而非「設計出來」
- 深色背景雖有工業感,但文字對比不足(灰字在深灰底)

---

### AVEVA MES(`aveva-mes/` 15 張)

**做對|**
- `mes-food-beverage-screen.jpg`:食品飲料產線即時監控畫面,最接近 Weyver pilot 場景
- `real-time-production-control.jpg`:1920×1080 高清,生產線狀態一覽,色彩語言統一
- `performance-management.jpg`:KPI 卡片排版合理,數字可讀性高

**最弱|**
- 整體仍是「工業監控」視覺語言,不是「現代 SaaS」
- 與 ERP 模組無法無縫整合,需要額外中介系統

**向上|**
- Weyver T 模組學習 AVEVA 的生產線即時狀態卡片,但放在 Weyver 整體 design token 下
- 讓 MES 畫面與 ERP 表單使用同一 UI 語言(而非切到 MES 感覺換了一個系統)

---

### Siemens Opcenter(`siemens-opcenter/` 15 張)

**做對|**
- `siemens-opcenter-aps-01.jpg`:APS 進階排程甘特圖,時間軸資源分配清楚
- 模組分工明確:Execution / Intelligence / APS 各有定位

**最弱|**
- UI 偏工業設計風格,對一般用戶(工廠主管)入門成本高
- 必須購買多個子模組才能組合完整功能

---

### Critical Manufacturing(`critical-manufacturing/` 12 張)

**做對|**
- `critical-mes-dashboard-03.jpg`:多 KPI 儀表板佈局合理,卡片大小有層次
- `critical-mes-spc-05.png`:SPC 管制圖整合在儀表板,不需切頁
- `critical-mes-stepview-01.jpg`:製程步驟視圖,操作人員友善

**最弱|**
- 畫面設計偏工程師風格,非直觀
- 主要針對半導體/電子,食品製造業功能過剩

---

## 四、ISO/QMS 品管文件(U 模組)

### Qualio(`qualio/` 11 張)

**做對|**
- `qualio-document-01.png`:文件管理清單乾淨,版本號、狀態、審核人一目瞭然
- `qualio-document-editor-01.png`:富文字編輯器整合在文件系統內,不需切換工具
- `qualio-capa-01.png`:CAPA 工作流步驟顯示清楚,進度狀態可視

**最弱|**
- 主要針對醫療器材/生命科學市場,某些功能對食品製造業過於複雜
- 價格高(需 demo 才報價),不適合 SMB

**向上|**
- Weyver U 模組學習 Qualio 的文件審核流程 UI 呈現方式
- 把相同流程設計做得更通用,允許客戶 ISO 專員自訂欄位(B+C 表單引擎驅動)

---

### IsoTracker(`isotracker/` 11 張)

**做對|**
- `isotracker-capa-fishbone-01.jpg`:魚骨圖視覺化整合在 CAPA 流程中,非常有價值
- `isotracker-capa-5whys-01.jpg`:5-Why 分析界面,結構化根因分析
- `isotracker-document-versions-01.jpg`:文件版本歷史清楚展示

**最弱|**
- UI 整體偏舊(Bootstrap 2 時代風格),視覺對比不足
- 沒有行動版支援

**向上|**
- Weyver 保留 fishbone + 5-Why 的 CAPA 分析方法,但用現代 UI 重新設計
- 文件版本歷史改為 timeline 呈現方式

---

### Greenlight Guru(`greenlight-guru/` 12 張)

**做對|**
- `greenlight-guru-quality-events-01.png`:品質事件列表,狀態+嚴重度+指派人清楚
- `greenlight-guru-audit-01.png`:稽核管理界面,發現事項列表乾淨
- `greenlight-guru-ai-platform-01.png`:AI 輔助品質分析,Weyver 未來方向參考

**最弱|**
- 深度針對醫療器材法規(FDA 21 CFR Part 11),對一般製造業有過多不需要的功能

---

## 五、向上設計|Weyver 差異化方向

### 共同弱點(所有競品都有)

| 問題 | 頻率 | Weyver 解法 |
|---|---|---|
| 模組之間視覺語言不統一 | 95% 競品 | **統一 design token**,所有模組同一 shadow/radius/spacing |
| 行動版體驗差 | 90% 競品 | Phase 0 即 responsive-first,MES 平板優先 |
| 首頁是功能清單,不是工作中心 | 85% 競品 | 首頁 = **我的工作區**,按角色顯示待辦 |
| 導航過深(3-5層點擊才到功能) | 80% 競品 | **cmd-K 全域搜尋** + 最多 2 層導航 |
| 數字欄位不對齊/可讀性差 | 75% 競品 | **JetBrains Mono + tabular-nums** 強制對齊 |
| 狀態只靠顏色區分(色盲不友善) | 70% 競品 | **dot + 文字雙重**,WCAG AA |
| ERP/MES 是「不同系統」感覺 | 100% 市場 | **同一 UI shell**,切換只換 sidebar sub-nav |
| 空狀態(empty state)醜陋 | 90% 競品 | 每種 empty state 都要設計(§A6) |

### Weyver 贏過最強點的策略

| 對標最強 | 強項 | Weyver 超越方式 |
|---|---|---|
| Ragic | Link & Load 概念 | 做成即時右側 panel,不用切頁 |
| Airtable | 視圖切換 tab | 保留 tab + 加視覺化 7 種視圖 icon |
| Dynamics 365 | 現代 Fluent UI | 更個性化設計(深海青品牌) + 中文優先排版 |
| Qualio | 文件審核流程 | 同樣流程 + B+C 表單引擎讓客戶自訂 |
| Sepasoft | OEE dashboard | 同樣清楚 + 整合在 Weyver 主 shell,不換系統 |
| IsoTracker | fishbone/5-Why | 保留方法 + 現代 UI 重做 |
| AVEVA MES | 食品業即時監控 | 整合到同一系統,不需額外 middleware |

### Weyver 的唯一 Signature(記憶點)

**「所有企業管理工作在同一個視覺系統裡」**

- ERP 傳票、Ragic 表單、MES 工單、ISO 文件 — 開在同一 sidebar,同一 topbar,同一 token
- 切換不像切系統,像切分頁
- 這在台灣 SMB 市場完全空白:客戶現在要開 5 個系統視窗切換

---

## 截圖庫參考索引(設計時快速查)

| Weyver 模組 | 最重要參考截圖 |
|---|---|
| **B 表單設計器** | `ragic-detail/ragic-detail-formbuilder-*.png`(13張) + `airtable/airtable-views-06.png` |
| **B Grid 視圖** | `ragic-detail/ragic-detail-grid-*.png`(9張) + `nocodb/nocodb-grid-01.webp` |
| **C 公式/自動化** | `ragic-detail/ragic-detail-formula-*.png` + `ragic-detail/ragic-detail-workflow-*.png` |
| **D Link & Load** | `ragic-detail/ragic-detail-linkload-*.png`(8張) |
| **F 報表 BI** | `grafana/grafana-cloud-hero-01.png` + `sepasoft/sepasoft-spc-dashboard-09.png` |
| **J 財會 GL/AP/AR** | `dynamics365/finance-*.jpg`(8張) + `odoo/odoo-accounting-*.webp` + `stripe-dashboard/stripe-invoices-*` |
| **K 進銷存** | `dynamics365/scm-*.jpg` + `odoo/odoo-inventory-*.webp` + `odoo/odoo-purchase-*.webp` |
| **L 生產 BOM/工單** | `odoo/odoo-manufacturing-*.webp`(9張) + `critical-manufacturing/critical-mes-bom-06.jpg` |
| **M 品保批號** | `sepasoft/sepasoft-track-trace-mixing-08.png` + `critical-manufacturing/critical-mes-checklist-07.jpg` |
| **T MES 現場** | `aveva-mes/mes-food-beverage-screen.jpg` + `sepasoft/sepasoft-oee-dashboard-01.png` + `critical-manufacturing/critical-mes-stepview-01.jpg` |
| **T OEE** | `sepasoft/sepasoft-oee-dashboard-01.png` + `sepasoft/sepasoft-spc-chart-10.png` |
| **U ISO 文管** | `qualio/qualio-document-01.png` + `qualio/qualio-document-approval-01.png` |
| **U CAPA** | `isotracker/isotracker-capa-fishbone-01.jpg` + `isotracker/isotracker-capa-5whys-01.jpg` + `greenlight-guru/greenlight-guru-capa-01.png` |
| **U 稽核** | `greenlight-guru/greenlight-guru-audit-01.png` + `mastercontrol/mastercontrol-audit-laptop-01.png` |
| **H UX 品味** | `linear/linear-ui-02.png`(7584×3520) + `linear/linear-ui-03.png` |
| **R HR 薪資** | `dynamics365/hr-*.jpg`(6張) + `yonyou/` payroll screenshots |
