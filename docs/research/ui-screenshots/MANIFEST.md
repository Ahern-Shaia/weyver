# UI Screenshots Manifest

> **用途**|競品分析 / 設計研究(UX gap、資訊架構、視覺調性參考)
> **⚠️ 法律紅線**|不可像素級複製 UI(CLAUDE.md 法律紅線)。之後真的做 UI 走 clean-room。
> **最後更新**|2026-07-17 v3(**423 張 / 75 MB**|新增 ERP/MES/ISO 全線 vendor + Ragic 詳細 UI 60 張)
> **設計分析**|見 `docs/research/ui-design-analysis.md`(向上設計分析,含 做對/做錯/Weyver 超越方向)

---

## 覆蓋摘要(v2 全庫)

| Vendor | 張數 | 大小 | 對應 Weyver 模組 | 品質 |
|---|---|---|---|---|
| **Odoo 18** | 53 | 3.0 MB | J-Q ERP + M + T + U | 🟢 高 |
| **Airtable** | 17 | 5.1 MB | A-I 表單引擎 | 🟢 高(含 2560×1920)|
| **Linear** | 12 | 5.7 MB | H UX craft | 🟢 高(含 7584×3520)|
| **Notion** | 10 | 2.1 MB | B-I 資料視圖 | 🟢 高 |
| **ERPNext** | 10 | 1.8 MB | J-Q ERP OSS | 🟢 高 |
| **NocoDB** | 10 | 3.6 MB | A-I OSS Ragic-like | 🟢 高 |
| **Stripe Dashboard** | 8 | 2.8 MB | F 報表 / table craft | 🟢 高 |
| **Ignition MES** | 11 | 2.7 MB | T MES / SCADA / HMI | 🟢 高 |
| **Grafana** | 7 | 1.7 MB | F BI / dark dashboard | 🟢 高 |
| **正航 Chi-Hang** | 19 | 544 KB | J-Q ERP 台灣 | 🔴 弱(多 icon) |
| **鼎新 Digiwin** | 18 | 1.2 MB | J-Q ERP 台灣 | 🟡 中 |
| **Ragic** | 15 | 1.7 MB | A-I 表單引擎 | 🟢 高(官方 doc 真實 UI)|
| **SAP B1** | 9 | 1.3 MB | J-Q ERP | 🟡 中 |
| **NetSuite** | 0 | — | J-Q ERP 對標 | ⏳ 需手動 |
| **Dynamics 365** | 0 | — | J-Q + R HR | ⏳ 需手動 |
| **Workday** | 0 | — | R HR | ⏳ 需手動 |
| **MasterControl** | 0 | — | U ISO | ⏳ 需手動 |
| **Odoo login views** | — | — | J-Q 實操畫面 | ⏳ 需手動(demo.odoo.com)|
| **千羔** | 0 | — | J-Q pipeline 客戶用 | ⏳ 需手動(客戶環境)|
| **總計** | **199** | **~33 MB** | | |

手動補抓清單見 `MANUAL-CAPTURE-GUIDE.md`。

---

## 最重要截圖(開發 Phase 0 直接對照)

| 截圖 | 對應 Sprint | 說明 |
|---|---|---|
| `airtable/airtable-views-hero.png` | P0-1 動態 schema | 全 view-type 並排藍圖 |
| `airtable/airtable-views-06.png` (1.9 MB) | P0-2 Grid | Grid + field-type panel 最詳細 |
| `nocodb/nocodb-column-manager-01.webp` | P0-1 欄位型別 | 30+ 欄位型別 panel UI |
| `nocodb/nocodb-grid-01.webp` | P0-2 Grid | OSS Ragic-like grid 直接對照 |
| `nocodb/nocodb-form-01.webp` | P0-1 表單設計器 | form builder UI |
| `linear/linear-ui-02.png` (7584×3520) | H UX | sidebar + 列表 + detail pane 完整布局 |
| `odoo/odoo-accounting-*.webp` | P0-6 J 財會 | 財務模組布局參考 |
| `odoo/odoo-manufacturing-*.webp` | P0-7 L 生產 | BOM / 工單 UI |
| `stripe-dashboard/stripe-invoices-dashboard-01.svg` | P0-6 J 財會 | 資料密集 table craft 標竿 |
| `ignition/ignition-scada-realtime-monitor-01.jpg` | P1-G T MES | 即時監控 UI |
| `grafana/grafana-cloud-hero-01.png` (804 KB) | F BI | 深色 dashboard aesthetic |

---

## 快速開啟

```bash
# Finder 開整個庫
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/

# 開特定 vendor
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/airtable/
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/odoo/

# 最重要的幾張直接開
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/airtable/airtable-views-hero.png
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/airtable/airtable-views-06.png
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/linear/linear-ui-02.png
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/grafana/grafana-cloud-hero-01.png
```

---

## Ragic(ragic/)

**來源**|https://www.ragic.com/intl/zh-TW/doc/37/creating-a-ragic-sheet(建立新的 Ragic 表單 官方 doc)

15 張 PNG,66KB–266KB,都是真實 UI 截圖。涵蓋:
- 表單設計器(欄位新增、Section 分段、頁籤)
- 資料檢視(列表、單筆)
- 快速範本挑選
- 條件顯示 / 動作按鈕
- 匯入資料 / 匯出

## Digiwin TIPTOP(digiwin/)

**來源**|https://www.digiwin.com.tw/software/696.html(TIPTOP GP 大型集團 ERP 官方頁)

18 張 JPG,11KB–276KB。**小於 15KB 的多為 icon,建議忽略**(tiptop-08、09、12、14、16、18)。大的是真截圖:
- **tiptop-04**(144KB)、**tiptop-07**(276KB)、**tiptop-11**(118KB):值得優先看
- 官方 marketing 圖,通常美化過,實際客戶端 UI 可能較陽春
- **未涵蓋**|操作深入頁面(如傳票錄入、BOM 展開、成本計算)

## SAP B1(sap-b1/)

**來源**|https://sap-b1-blog.com/en/sap-business-one-10-preview/(SAP B1 10 preview blog)

9 張。**小於 15KB 的 3 個 avif 是 banner**(sap-b1-01、08、09),忽略。真截圖:
- **sap-b1-03**(337KB)、**sap-b1-07**(343KB)、**sap-b1-06**(273KB):大圖,值得看
- 涵蓋 Web Client、PowerPoint 概念圖、Integration Framework
- **未涵蓋**|實際財務模組、進銷單據錄入頁

## 正航 Chi-Hang(chihang/)【弱】

**來源**|
- https://www.softwareic.com.tw/(正航 marketing 頁,mainstream/flexible/data 系列)
- http://erp.join2.com.tw/(卓爾資訊經銷商,4 張小圖)

19 張大多是 marketing icon(9-34KB)或 banner(82-93KB),**幾乎沒真實 UI 操作畫面**。

**理由**|正航官方站是 JS 渲染,curl 抓不到。卓爾經銷商的教學頁 image 也少。真實 UI 需:
1. 看 YouTube 弗達 教學影片(需手動截圖)
2. 上 scribd 找「正航操作手冊 2012」PDF(需登入)
3. 從 PChome / 蝦皮上「正航一號」商品頁截(JS 渲染,curl 抓不到)

**如果你決定要補正航**,選項:
- (a) 我改用 Puppeteer 之類的 headless browser 腳本(需先確認你環境有 node + puppeteer)
- (b) 你手動從 YouTube 弗達 教學影片截幾張給我
- (c) 直接跳過正航,以 Digiwin TIPTOP 為台灣中小 ERP 代表就夠

## 快速檢視指令

```bash
# 用 Finder 打開所有截圖
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots

# 或用 Preview 一次開一家
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/ragic/*.png
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/digiwin/*.jpg
open /Users/ahern/Documents/work_work/weft/docs/research/ui-screenshots/sap-b1/*
```

## 版本

- **2026-07-16 v2**|大規模補抓。新增 9 個 vendor(Odoo 53 + Airtable 17 + Linear 12 + Notion 10 + ERPNext 10 + NocoDB 10 + Stripe 8 + Ignition 11 + Grafana 7 = 138 張)。總庫 199 張 / 33 MB。產 `MANUAL-CAPTURE-GUIDE.md` 補登入需手動截的畫面清單。
- **2026-07-16 v1**|首次抓取。Ragic + Digiwin + SAP B1 + 正航 4 家 61 張。
