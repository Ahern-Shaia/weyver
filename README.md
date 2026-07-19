# Weyver(織雲)|規劃期

> **產品代號**|Weyver(2026-07-16 從 Weft 換案 — 見 `docs/02-產品命名候選.md`)
> **產品定位**|以 Ragic 為基底,自研整合 ERP(鼎新 / 正航 / SAP B1)全功能的多租戶 SaaS。
> **首個客戶**|鮮勇(既有 Ragic 用戶,內部有 3 家 ERP)
> **現況**|規劃 / 可行性評估階段,尚未動工程。

---

## 文件索引

| 編號 | 標題 | 狀態 |
|---|---|---|
| 01 | [Ragic 側核心功能工程量估算](docs/01-核心功能工程量估算.md) | ✅ 完成(保留作 Ragic 側詳表) |
| 02 | [產品命名候選](docs/02-產品命名候選.md) | ✅ 主選 **Weyver(織雲)** — 2026-07-16 換案 |
| **04** | **[完整產品功能表](docs/04-完整產品功能表.md)** | ✅ **2026-07-16 v2.1 定稿**(**一體 offering 缺一不可**;**429 MVP OSS-only**;Weyver 自建全套 ERP CORE;省 NT$70-100K/年授權)|
| — | [策略簡報](docs/strategy-slides.html) | ✅ 2026-07-18 重刷(對齊 v2.3 / solo 時程 / 全自研 TS / OSS / 13 張)|
| **07** | **[產品開發時程規劃書](docs/07-產品開發時程規劃.md)** | ✅ **2026-07-18 v2.8**(新增 § 1.4 Vernova AI 實測產能校準|僅計 ahern 本人 commit;solo 完整 MVP 加速 ~2 年 / 務實 ~3-4 年)|
| **08** | **[MES 市場分析報告](docs/08-MES-市場分析.md)** | ✅ **2026-07-16 v1**(11 家 vendor + 功能矩陣 + Weyver T 策略)|
| **09** | **[ERP 市場分析報告](docs/09-ERP-市場分析.md)** | ✅ **2026-07-16 v1**(11 家 vendor + 功能矩陣 + Weyver J-Q 策略)|
| **10** | **[Ragic 完整功能分析](docs/10-Ragic-完整功能分析.md)** | ✅ **2026-07-16 v1**(11 大類功能地圖 + Weyver A-I 借鑑分類)|
| **11** | **[技術棧規劃書](docs/11-技術棧規劃書.md)** | ✅ **2026-07-18 v9**(OSS-only stack + Modular Monolith;**§ 7.10 AI 輔助設計工具鏈(Skills + MCP)**;§ 16.5-16.11 Prod 雲端部署架構 AWS/GCP + 全服務成本|主推 GCP 台灣區 + Cloud Run;Tier E ~NT$14-22K/月)|
| **12** | **[TypeScript 7 與後端框架企業級評估](docs/12-TypeScript-7-與後端框架企業級評估.md)** | ✅ **2026-07-16 v1**(TS 7 Native + 5 框架對照)|
| **⭐ 13** | **[產品開發功能順序表](docs/13-產品開發功能順序表.md)** | ✅ **2026-07-16 v1**(**buildable sprint 順序**|Foundation + Phase 0 + Phase 1;dependency + solo M18 + risk gates)|
| **⭐ 14** | **[前端設計規則與技術棧](docs/14-前端設計規則與技術棧.md)** | ✅ **2026-07-18 v1.1**(開發前定案|tech stack + design token + 設計規則 + Do&Don't;企業級基準;**v1.1 § 1.5 記錄 Vite 8 / Storybook 10 / Vitest 4**)|
| — | [設計系統 / 首頁 v6 / 表單引擎](docs/mockups/) | ✅ 2026-07-17 mockups(企業級,深海青)|
| **⭐ 15** | **[表單引擎技術設計](docs/15-表單引擎技術設計.md)** | ✅ **2026-07-18 v2**(命門地基|兩層資料模型 + 真實表 + ORM 雙軌 + 公式 + 權限 + 計算層 + P0-1 spike)|
| **⭐ 16** | **[OSS 表單引擎技術拆解](docs/16-OSS表單引擎技術拆解.md)** | ✅ **2026-07-18 v1**(Baserow/NocoDB/Teable|真實表驗證 + Prisma+Knex 雙軌 + MIT 可復用地圖)|
| **⭐ 17** | **[AI-native 向上設計](docs/17-AI-native-向上設計.md)** | ✅ **2026-07-18 v1**(向上軸|架構天生 AI-friendly;旗艦 AI 遷移建表助手 = GTM 楔子;企業 guardrails)|
| **⭐ 18** | **[ERP 計算層演算法](docs/18-ERP計算層演算法.md)** | ✅ **2026-07-18 v1**(命門之二|GL/估值/成本/FX/折舊/MRP 演算法蒸餾成可實作規格,純合法來源)|
| **⭐ 19** | **[兩層解耦出貨策略](docs/19-兩層解耦出貨策略.md)** | ✅ **2026-07-18 v1**(Track A 先出可賣 ERP / Track B 平行補動態引擎;P0-1 風險移出營收關鍵路徑)|
| **⭐ 20** | **[領域引擎 build-on 分析](docs/20-領域引擎build-on分析.md)** | ✅ **2026-07-18 v1**(巨人肩膀|規則→GoRules ZEN / workflow→DBOS+BullMQ / 帳務→自研 ERPNext-OFBiz 藍圖+TigerBeetle escape hatch)|
| **⭐ 21** | **[多租戶架構](docs/21-多租戶架構.md)** | ✅ **2026-07-18 v1**(五層巨人|RLS+SET LOCAL / nestjs-cls / Caddy 自訂網域 / JWT 為真實來源 / Better Auth orgs + authz in-app→Cerbos)|
| **⭐ 22** | **[資安規範與威脅模型](docs/22-資安規範與威脅模型.md)** | ✅ **2026-07-18 v2**(OWASP Top10/API/LLM + 威脅模型 + AI 安全載重不變量 + 供應鏈/secrets/容器 + 四軸反思→AGENTS.md ⚙️)|
| **⭐ 23** | **[產品功能發布藍圖(客戶版)](docs/23-產品功能發布藍圖.md)** | ✅ **2026-07-18 v5**(對客戶功能時程|R1→R2→R3(完整 MVP)→R4(持續);模組×階段矩陣;**時程基準改 solo(單一開發者 AI 輔助)非 8 人團隊**,務實(承諾底線)R1 ~2-2.5 年 / R2 ~3.5 年 / R3 ~4-4.5 年,加速(努力目標)R1 ~1.5 年 / R2 ~2 年 / R3 ~3 年,據 docs/07 §1.4;若擴編則後段加速;pilot subset 先行;每階段可用不半殘)|
| **⭐⭐ 24** | **[用戶心智模型與設計原點](docs/24-用戶心智模型與設計原點.md)** | ✅ **2026-07-19 v1.1**(視覺之上游依據|Weyver 用戶=Ragic 範式思考者,**主要畫面=「自己建自己填」的表單資料庫非 KPI 儀表板**;客戶校準:ERP/MES/ISO **織入同一 Ragic 工作區、非每系統一 tab**;反面教材=為 SaaS 而 SaaS + 分立模組 tab)|
| **12** | **[TypeScript 7 與後端框架企業級評估](docs/12-TypeScript-7-與後端框架企業級評估.md)** | ✅ **2026-07-16 v1**(TS 7 Native + 5 框架對照 + Weyver 選型 update)|
| PDF | [`docs/pdf/`](docs/pdf/) 04 + 07 兩份 PDF | ✅ 2026-07-16,`bash docs/pdf/build.sh` 重生 |
| 03 | 鮮勇當前表單分析(Ragic 已滿足 vs 需 ERP 補強) | ⏳ 待做 |
| **05** | **[商業模式驗證](docs/05-商業模式驗證.md)** | ✅ **2026-07-18 v1**(定價 / ARR / 回本財務模型|三情境;Pro ~NT$336K/年;Y3~11M ARR;OSS 高毛利;breakeven Y2-3)|
| 06 | 法律風險與 Clean Room SOP | ⏳ 待做 |

---

## 關鍵決策待定

- [x] ~~路線 A vs 路線 B~~ → 2026-07-16 定案|**路線 A 通用 SaaS + Odoo fork**(多產業通用平台)
- [ ] 是否採 Odoo fork 作為 ERP 底層
- [ ] Grid 引擎採自研 vs AG Grid Enterprise 授權
- [ ] 團隊規模(5 / 8 / 12 人)
- [x] ~~Weft 商標檢索~~ → 2026-07-16 完成初步自查,主選改 **Weyver(織雲)**
- [ ] TIPO / USPTO 正式檢索 Weyver + 織雲(Class 09/42)
- [ ] 戰略決策|是否進大陸?(影響「織雲」中文品牌 — 撞 Tencent 织云)
- [x] ~~資料夾 `weft/` 是否改名 `weyver/`~~ → 2026-07-18 完成(folder + memory path 改名 + `git init`)

---

## 品牌備選

**主選 Weyver(織雲)** 若 TIPO/USPTO 正式檢索卡關,依序啟用:
1. **Formora**(國際 SaaS 定位,已知 `formora.design` 為 Class 41 小 startup)
2. **Weft(織緯)** — 2026-07-16 降備選(SaaS 空間飽和,letsweft.com 撞敘事)
