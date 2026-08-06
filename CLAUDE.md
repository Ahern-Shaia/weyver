@AGENTS.md

# Weyver(織雲)專案|Claude Code 專案記憶

> **這份文件會在 Claude Code 進入本目錄時自動載入。**
> 目的:讓新對話立即掌握專案脈絡,不用重講背景。
> **註**|資料夾已於 2026-07-18 從 `weft/` 改名 `weyver/`(memory path 同步改名;同日 `git init` 首次 commit)。

---

## 一句話定位

**Weyver(織雲)** —— **以 Ragic 表單引擎為基底,取代 ERP,融合 MES + ISO 的一站式企業平台**(Cloud SaaS + On-premise Edge Gateway hybrid,**統一 TypeScript 全棧**,全 OSS,不 fork Odoo)。**廠商放棄原有 ERP(鼎新 / 千奧 / 正航),全面改用 Ragic 範式取代 ERP**,並在同一基底開展 MES + ISO。**架構主張(2026-07-17)**|表單引擎是 substrate(平台底層),不是模組之一 —— 採購單 / 銷貨單 / 工單 / BOM / 品檢 / ISO 文件皆為引擎上的表單 app;深層計算(GL 過帳期結 / MRP / 成本 / 估值)由引擎之上的計算層補齊(「算」不是「填」)。Q 多 ERP 對帳角色收斂(客戶放棄原 ERP,至多 onboarding 一次匯入)。

- 首波 pilot|鮮勇 為首波客戶(食品加工,既有 Ragic 用戶,內部有 3 家 ERP);pipeline 17 家集中食品/團膳,但平台不限產業
- 現況|**2026-07-19 起進入 Phase 1 工程**(規劃已完成)。**✅ Gate P0-1(docs/13 最大 risk gate)全數達成**:後端 **form-engine-core v1.0 SHIPPED**(`apps/api` NestJS+Fastify;動態 schema/型別/DDL 安全鏈/記錄 DML/子表/RLS 隔離/REST API)+ UI **form-designer-ui v1.0 SHIPPED**(`apps/web/app/builder`;設計器雙模式 + 15 型別填單 + 子表 saveWithLines + 記錄檢視;Playwright golden path 固化)。瀏覽器可建表→加欄→填單→子表→檢視,引擎生成真實 PG 表。兩模組 doc 見 `docs/modules/R1/`。工程紀律|新 non-trivial 模組必先 M0 design doc + OQ 裁定(`docs/modules/_template.md`),模組索引 `docs/modules/MODULES.md`
- 對外上 prod 前提|**✅ F-2 auth SHIPPED v1.0(2026-07-19)**(Better Auth + Argon2id + org↔tenant 對映 + AuthGuard session→tenant + 跨租戶隔離 e2e + 前端登入/註冊 + rateLimit/安全標頭/throttler 硬化;dev `x-dev-tenant`→真實認證,prod 生效)+ form-engine-core §12.7 可靠性 checklist(idempotency key / quota / throttler / helmet)

## 品牌故事(業務簡報第一頁用)

> 客戶散落的三套 ERP、五份 Excel、十個 Ragic 表單 —— 都是**線頭**;**Weyver(織雲)** 是把它們**織成一整朵雲**的織者。

---

## ⚠️ 對話行為準則

1. **一律用「Weyver(織雲)」稱呼產品**,不要說「Ragic clone / 複製 Ragic」等字眼(有法律風險,可能被主張仿冒)。舊名 Weft(織緯)已於 2026-07-16 降為備選,見 `docs/02-產品命名候選.md`。
2. **【強制】一律以繁體中文回覆** —— 所有對話、說明、進度更新、總結、commit 回報一律繁體中文,**無例外**;程式碼、識別字與技術術語可保留英文。此為硬規則,不因對話語境或內容語言而改變。
3. **法律紅線**(參考 [讀 05-法律風險 待補])
   - 不能碰 Ragic 源代碼
   - 不能像素級複製 UI
   - 不能用近似商標(Ragix / Ragik 都不行)
   - 需做專利檢索(力誠資訊在 TIPO / USPTO 的專利)
4. **技術傾向(已估算,v2.0 定案)**
   - Grid 引擎建議採 AG Grid Enterprise 授權,不要自研(可省 8–10 人月)
   - **ERP CORE|Weyver 自建全套 TypeScript**(v2.0 決策|不 fork Odoo,不看 Odoo source;domain 學習純合法來源)
   - 技術棧|TS 7 Native + NestJS 10 + Fastify adapter(docs/11 v4)
   - 2026-07-16 定案|走「路線 A|Ragic + ERP + MES + ISO 一體 offering,缺一不可」,詳見 docs/04 v2.0

## 已估算結論(快速查詢)—— 2026-07-16 docs/04 v2.0 定稿

**產品定位(v2.0)**|**Ragic + ERP + MES + ISO 一體 offering 之多產業通用企業級平台,缺一不可**。全自研 TypeScript,不 fork Odoo。

| 項目 | 數字 | 來源 |
|---|---|---|
| **完整 MVP 總人月(路線 A + 全自研 TS + OSS-only + 通訊平台 + 審計補遺)** | **503** | docs/04 **v2.7**(2026-07-19 ERP-parity 缺口:+委外/票據/信用/營業稅/SoD/連接器 19,全 R2;v2.6 設定頁 +4;v2.5 通用功能 +8;v2.4 審計 +32)|
| ├── Ragic 側(A–I 9 模組;含設定/管理類 + v2.7 E SoD 3 + G 連接器 4 均 R2-release) | **248** | v2.7 +7 vs v2.6 |
| ├── ERP 側(J–Q 8 模組,全 Weyver 自建)| 200 | J 53 + K 33 + L 36 + M 13 + N 15 + O 13 + P 17 + Q 20(v2.7 +委外/票據/信用/營業稅)|
| ├── HR / 薪資(R) | 15 | 台灣班別 / 加班 / 薪資合規 |
| ├── MES(T,Cloud + Edge hybrid)| 22 | Cloud + Edge Gateway |
| ├── ISO / 品管(U,通用工具 + v2.4 AI CAPA) | 18 | 產業特化客戶自建 |
| └── CRM(S) MVP | 0 | 明確範圍外,對標 12 人月 |
| 完整對標人月(路線 A)| ~944 | docs/04 v2.7 |
| 對照組|若採 Odoo fork(拒絕全自研 TS) | ~361 MVP | v2.1 全自研 TS 比 Odoo fork +68 |
| **Solo|完整 MVP(路線 A)** | **務實 ~4-4.5 年 / 加速 ~3 年** | docs/07 §1.4 + docs/23 v5(8 人團隊對照 ~5.6 年;solo 主基準因實際資源為單人 AI 輔助)|
| **Solo|R1 完整 Ragic 平台**(~240 人月 v2.7,Ragic-parity-first,既有客戶遷移 land)| **務實 ~2-2.5 年 / 加速 ~1.5 年** | docs/23 v6.5 + docs/07 §1.4(8 人團隊對照 ~2.2 年)|
| **Solo M18 milestone 交付**(Ragic-first)| 表單引擎核心(動態 schema + Glide Data Grid basic + 基本公式)+ 關聯 + 基本權限 + 匯入匯出 + 1 家 pilot 遷移最常用 Ragic 表單上線(不碰 ERP/Q,ERP 於 Phase 2)| ~25 人月(佔 MVP 5.8%) |
| **v2.1 OSS-only|省 商業授權年費** | **NT$70-100K/年** | AG Grid + Sentry Cloud + Doppler + Chromatic + Vercel Pro 全砍 |
| ⚠️ 訂閱計費從 MVP 移 Phase 2 | 2026-07-16 決策(A7 假設) | docs/04 v1.1 |
| ⚠️ Domain 學習純合法來源(不 clone Odoo source) | A16 假設 | docs/04 v2.0 |
| **Odoo docs 參考庫**|`~/Documents/work_work/reference-materials/odoo-docs-18/`(**Weyver 專案外**;CC BY-SA 4.0;18.0 shallow clone;842 RST 文檔;不看 `content/developer/`)| 2026-07-16 下載 |

---

## 文件索引

| 編號 | 標題 | 狀態 |
|---|---|---|
| 01 | [Ragic 側核心功能工程量估算](docs/01-核心功能工程量估算.md) | ✅ 完成(保留作 Ragic 側詳表)|
| 02 | [產品命名候選](docs/02-產品命名候選.md) | ✅ **主選 Weyver(織雲)** — 2026-07-16 從 Weft 換案 |
| **04** | **[完整產品功能表](docs/04-完整產品功能表.md)** | ✅ **2026-07-19 v2.7**(**一體 offering 缺一不可**;**503 MVP**(v2.7 ERP-parity 缺口 +19:委外/票據/信用/營業稅/SoD/連接器,全 R2;v2.6 設定頁 +4;v2.5 通用功能 +8;v2.4 審計 +32);OSS-only;solo 時程 band 不變 務實 ~4-4.5 年 / 加速 ~3 年)|
| — | [策略簡報](docs/strategy-slides.html) | ✅ **2026-07-18 重刷**(對齊 docs/04 v2.3 + docs/07 v2.9 + docs/23 v5|13 張:Ragic substrate 取代 ERP+MES+ISO 定位 / 21 模組 / 440 MVP / **全自研 TS 拋 Odoo fork** / OSS-only / solo 時程 + Vernova 校準 / 計算層差異化 / 商業模式;品牌 token 對齊 深海青 #0C5F73 + IBM Plex。reveal.js,可直接開啟)|
| **07** | **[產品開發時程規劃書](docs/07-產品開發時程規劃.md)** | ✅ **2026-07-19 v2.14**(v2.7 ERP-parity 缺口對齊|503 / Phase 2 +~223 / Phase 1 ~240,**時程結論不變**;v2.11 §4 逐月排程由舊 Odoo-fork/Q-first 完整重編為 Ragic-first|月段 A-E 改表單引擎核心→關聯/權限→pilot Ragic 遷移,移除 Odoo/AG Grid/Q read/GL/電子發票 stub(排 Phase 2);§5 成本砍商業授權+Odoo 顧問(~800K-1.45M→~150K-400K);前 v2.9 calendar 稀釋校正|主導因子為穩定期 ~30% 維運拖累非 coding 速度)|
| **08** | **[MES 市場分析報告](docs/08-MES-市場分析.md)** | ✅ **2026-07-16 v1**(11 家 MES vendor 分析 + 功能對照矩陣 + Weyver T 模組策略)|
| **09** | **[ERP 市場分析報告](docs/09-ERP-市場分析.md)** | ✅ **2026-07-16 v1**(11 家 ERP vendor 分析 + 功能對照矩陣 + Weyver J-Q 策略)|
| **10** | **[Ragic 完整功能分析](docs/10-Ragic-完整功能分析.md)** | ✅ **2026-07-16 v1**(11 大類功能地圖 + Enterprise 特殊功能 + Weyver A-I 借鑑分類)|
| **11** | **[技術棧規劃書](docs/11-技術棧規劃書.md)** | ✅ **2026-07-19 v10**(**Ragic substrate + Modular Monolith**;**v10 § 7–8 視覺數值對齊 docs/14 v2.1**|清除 v1 軟 SaaS 殘留:字型 Inter→IBM Plex、色彩 warm+dark→冷中性三配色、陰影→框線深度、圓角 6/12/9999→方角 2-3px 禁 pill、動效收斂近乎無;§ 7.1 強化「rationale 不用 vibe」;架構概念(3-layer token / 元件清單 / 7 視圖 / § 7.10 AI 工具鏈)保留;**v8** § 16.5-16.11 Prod 雲端部署架構(AWS/GCP),主推 GCP asia-east1 台灣 + Cloud Run,OSS-only)|
| **12** | **[TypeScript 7 與後端框架企業級評估](docs/12-TypeScript-7-與後端框架企業級評估.md)** | ✅ **2026-07-16 v1**(TS 7 Native 10x + Fastify/NestJS/Encore.ts/Hono 對照 + Weyver 選型 update 建議)|
| **⭐ 13** | **[產品開發功能順序表](docs/13-產品開發功能順序表.md)** | ✅ **2026-07-19 v1.8**(503 MVP 拆 sprint;v1.8 v2.7 ERP-parity cascade|Phase 2 +~223;v1.7 v2.6 Phase 1 ~240 / P1-I ~91;v1.5 §3.1 P0-1 後端核心 SHIPPED)|
| **⭐ 14** | **[前端設計規則與技術棧](docs/14-前端設計規則與技術棧.md)** | ✅ **2026-08-01 v6.0**(§0.4 對照 Metabase 之 token 架構裁定;禁 hex 升級 CI)· 舊述 v2.1(**嚴謹企業級定案,全文改寫**|上游=docs/24 form-first;全框線欄位表 / 方角 2-3px / **禁陰影禁 pill** / 扁平主色分段條 / 帶框狀態章 / 12.5px 密度 / 信任訊號鐵則(時間戳/版本/稽核/借貸平衡/記錄導航/狀態列)/ 動效近乎無;§1.2 套件×surface S1–S21 對映;權威稿=`workspace-form-first-v2.html`,v1 mockups SUPERSEDED;**v2.1 品牌色定案=一套系統三配色主題可切換**(深藍預設/深海青/石墨,`[data-theme]` 語意 token))|
| **⭐⭐ 24** | **[用戶心智模型與設計原點](docs/24-用戶心智模型與設計原點.md)** | ✅ **2026-07-19 v1.3**(**視覺之上游依據**|Weyver 用戶=Ragic 範式思考者,**主要畫面=「自己建自己填」的表單資料庫非 KPI 儀表板**;客戶校準:ERP/MES/ISO 織入同一 Ragic 工作區、**非每系統一個 tab**;§6 前端 surface 地圖 **S1–S22**(v1.4 S22 擴充 AI 設定/通道連接/API 金鑰;Phase 1 = S1–S13+S22 / J–U 織入 Phase 2+);反面教材=為 SaaS 而 SaaS + 分立模組 tab)|
| **⭐ 25** | **[功能完整對照清單](docs/25-功能完整對照清單.md)** | ✅ **2026-07-19 v1.4**(**開發對照權威 checklist**|A–U 全子功能 × R1–R4 × S1–S22;v1.4 v2.7 ERP-parity 缺口(E 17 / G 21 / J 53 / K 33 / L 36 / O 13 = 503);v1.1 審計 8 缺口 + 5 衝突已全數拍板併入 docs/04 v2.4;§3 補遺人月定案:AI MVP 16 + ZEN 3 + 明文化 2 + 白牌/配額 3 + 可靠性 8)|
| **⭐ 27** | **[R1 功能向上設計規格](docs/27-R1-功能向上設計規格.md)** | ✅ **2026-07-24 v1**(**R1 表單平台 parity「怎麼做」權威**|四路研究本地參照庫(Ragic 582 頁+2809 截圖+生產實照 / Airtable 391 篇 / Teable / Baserow)→ 四大分歧點裁定:**D1 2D 表單畫布(版面=metadata,DDL 不動)/ D2 視圖混合「Ragic 語意、Airtable 骨架」(view_def+預設檢視=列表頁+儲存檢視三態)/ D3 首頁=分類目錄(復用 form_categories)/ D4 隱藏疊權限之上**;四軸 P0/P1/P2(設計器/欄位型別/視圖/IA+記錄頁)+ 模組歸屬順序(workspace-ia→views-list→form-designer-2d→field-types-parity);OQ-UP-1..6;人月不變)|
| **28** | **[Metabase 設計分析](docs/28-Metabase-設計分析.md)** | ✅ **2026-08-01 v1.1**(視覺 × 互動,**Metabase 原始碼直讀**非二手;逐項給 Weyver 裁定並已 cascade 進 docs/14 §0.4。採用:色彩兩層制 / 色階由 base `color-mix` 推導 / `--icon-*` 對齊文字階 / **禁 raw hex 升級為 CI**;不搬:圓角 8px、靜態陰影、字階重排、儀表板式 IA。⚠️ v1.1 自我更正:12.5px 非外部佐證而是已被 §2.5 否決的殘留)|
| **⭐ 26** | **[品牌識別手冊](docs/26-品牌識別手冊.md)** | ✅ **2026-07-19 v1**(**品牌是誰**,與 docs/14 配對|策略(本質/定位/支柱 一體·嚴謹·自助·可信)+ 織雲故事與隱喻邊界(存於敘事**非介面裝飾**)+ 命名(Weyver/織雲/商標紅線)+ W 方塊標誌 + 三配色主題品牌策略(對外代表色建議深藍)+ IBM Plex 理由 + 視覺簽名=全框線非雲朵 + 聲音語氣(sober,文案 Do&Don't)+ 應用/白牌;色彩字型 token 引 docs/14 不重複)|
| — | [表單記錄 v2 權威稿](docs/mockups/workspace-form-first-v2.html)(嚴謹企業級)· ~~design-system / homepage-v6~~(v1 軟 SaaS,SUPERSEDED)| ✅ 2026-07-19(可瀏覽器直開)|
| **⭐ 15** | **[表單引擎技術設計](docs/15-表單引擎技術設計.md)** | ✅ **2026-07-18 v2**(命門地基|**兩層資料模型**:Tier1 固定真實表 + Tier2 動態真實表(共享 schema + tenant_id);ORM 雙軌 Drizzle+Knex;公式 fork Teable MIT;canvas grid;經 docs/16 實證校正)|
| **⭐ 16** | **[OSS 表單引擎技術拆解](docs/16-OSS表單引擎技術拆解.md)** | ✅ **2026-07-18 v1**(Baserow/NocoDB/Teable 拆解|三家皆真實表非 EAV/JSONB;**Teable Prisma+Knex 雙軌解難題**;可復用地圖:Baserow core + Teable formula/grid packages MIT 可 fork 省數月;canvas grid 勝)|
| **17** | **[AI-native 設計](docs/17-AI-native-向上設計.md)** | ⚠️ **2026-08-02 v2 重大更正**(**AI 不是向上軸,是 table stakes**)。v1 的核心前提「Ragic/傳統 ERP=0 AI」**經一手查證為錯**——Ragic 實有 AI 建資料庫(需求→自動生成一系列表單+關係圖)/ NL 查詢 / 公式助手 / 單據抽取(拍發票自動填單)/ **AI Agent(6 觸發 × **10** 動作〔2026-08-06 開檔覆查更正:原記 11,把 HTML 表頭列算進去了〕,含 `CREATE_RECORD`/`MODIFY_RECORD`)** / MCP(唯讀繼承權限)/ 私有主機本地模型+BYO key;我方列為「槓桿最高」的四項它全部已有。Ragic 明文空缺僅「無法產出報表」一項。**向上軸移交 docs/18 計算層**(Ragic 沒有「算」→ 不可能有「AI 綁算」;AI 是自助綁定的手段不是目的)。docs/17 功能清單與人月不變(降為 parity),ROI 論述需重估。⚠️ 鼎新/正航/千奧是否有 AI **未查證**。教訓入 AGENTS.md〈向上設計三條〉 |
| **⭐⭐ 18** | **[ERP 計算層演算法](docs/18-ERP計算層演算法.md)** | ✅ **2026-07-18 v1** · 🔴 **2026-08-02 升為唯一向上軸**(承 docs/17 v2:AI 降為 table stakes 後,「超越 Ragic 的類別差異」只剩**算 + 算的自助化綁定** —— Ragic 沒有計算層,所以也不可能有 AI 綁算;差異來源是這份文件,不是 AI)。命門之二|Ragic 過不去的「算」蒸餾成規格:GL 複式簿記+期結+財報、AP/AR 沖帳+帳齡+三方比對、庫存估值 FIFO/加權/移動、FX 匯兌、標準成本+差異+BOM 結轉、折舊、MRP 低階碼+淨需求;純合法蒸餾 A16)|
| **⭐ 19** | **[兩層解耦出貨策略](docs/19-兩層解耦出貨策略.md)** | ⚠️ **排序主張 SUPERSEDED**(2026-07-18 改 Ragic-parity-first,docs/23 v6)|原「Track A 先出固定 schema ERP / Track B 動態引擎後補」與新策略**相反**(表單引擎回到 R1 最前);**降為 R2 ERP 建構技法**——Tier-1 固定 schema 不需三硬骨頭之技術洞見仍有效,套用於 R2 落地 ERP 時|
| **⭐ 20** | **[領域引擎 build-on 分析](docs/20-領域引擎build-on分析.md)** | ✅ **2026-07-18 v1**(巨人肩膀|整套 ERP 拒絕 / 領域引擎採用:**規則→GoRules ZEN**(MIT 視覺編輯器 no-code+AI 綜效)、**durable workflow→DBOS**(PG library 官方 NestJS 近零 ops)+BullMQ、**帳務 GL→自研**(ERPNext/OFBiz 藍圖 + TigerBeetle escape hatch);全塞表單範式底下不破定位)|
| **⭐ 21** | **[多租戶架構](docs/21-多租戶架構.md)** | ✅ **2026-07-18 v1**(五層巨人|RLS FORCE+SET LOCAL+PgBouncer tx / nestjs-cls+transactional(背景工作 payload 帶租戶)/ Caddy on-demand TLS 自訂白牌網域 / JWT tenant_id 為真實來源防洩漏 / Better Auth orgs 足夠+authz MVP in-app,Cerbos 為 outgrow)|
| **⭐ 22** | **[資安規範與威脅模型](docs/22-資安規範與威脅模型.md)** | ✅ **2026-07-18 v2**(OWASP Top10/API/**LLM Top10** + 威脅模型 6 面 + P0 同步 AGENTS.md 🔒;**AI 載重不變量**:模型結構化 intent→確定性驗證→人核准→audit;動態 identifier 安全鏈;供應鏈/secrets/容器;**四軸反思擴充**補冪等性/優雅降級+circuit breaker/N+1 → AGENTS.md ⚙️ 鐵則)|
| **⭐ 23** | **[產品功能發布藍圖(客戶版)](docs/23-產品功能發布藍圖.md)** | ✅ **2026-07-19 v6.5**(**v6.5 v2.7 ERP-parity**:R2 補 委外/票據/信用/營業稅/SoD/連接器 +19 → +~223;**v6.4 v2.6**:R1 AI 設定(BYO key)/ 通道連接 / API 金鑰;**v6.3 v2.5 cascade**:設定中心/使用者管理/回收桶等;人月 R1 ~240 / R2 +~223 / R3 +~40 = 503;**v6.2 §1.6 開發啟動狀態**:Phase 1 工程 2026-07-19 起跑,R1 命門(表單引擎核心 = Gate P0-1)已 SHIPPED 並通過隔離/壓測驗證,**時程承諾不變**;**v6.1 docs/25 拍板**:電子簽章拆基本 R1 / 合規 R2;AI 遷移建表·NL 查詢·ZEN 前移 R1、拍照抽單前移 R2;**對客戶**功能時程|**Ragic-parity-first 階段重排**:R1 完整 Ragic 平台(既有客戶遷移 land)→ R2 ERP+計算層(補「算」取代 ERP)→ R3 MES+ISO(完整 MVP)→ R4 對標+AI;**solo 主基準**務實 R1 ~2-2.5 年 / R2 ~4 年 / R3 ~4-4.5 年,加速 R1 ~1.5 / R2 ~2.5-2.7 / R3 ~3 年;每階段可用不半殘、資料不重來)|
| PDF | `docs/pdf/*.pdf` snapshot | ⚠️ **手動重生**|對外分享才 `bash docs/pdf/build.sh`(2026-07-16 決策|對話中一律讀 .md,不自動重生 PDF)|
| **⭐ 30** | **[產品定位文案](docs/30-產品定位文案.md)** | ✅ **2026-08-02 v1**(**對外文案的文字來源** —— slides / 官網 / 業務簡報皆由此出,不各寫一套。一句話「**不用寫 code 的表單資料庫,連「算」也不用寫**」;§5 為向上設計段(競品文案無對應段落);§6 文案守則:**正面表述不講對手做不到** / 對照到品類為止不點名 / **不抄競品句子**(逐句換名是重製)/ 數字附出處與日期 / 「不用寫程式」是可稽核承諾)|
| **⭐⭐ 31** | **[向上設計 backlog](docs/31-向上設計backlog.md)** | ✅ **2026-08-02 v1**(**向上設計的可執行清單**,每條附競品官方文件逐字依據。方法:582 份 Ragic 官方文件全文掃描,找出「使用者想做某事、官方答案是寫程式」的位置 —— 那是它承諾「不用寫程式」卻沒兌現的地方。**23 條真 pro-code**(13 篇 KB 直接貼 JS 原始碼)· 12 處官方明說做不到 · **10 項它已用視覺化工具解掉(不得重複宣稱)**。**三件最該做**:① 重算/同步宣告式觸發(五篇 KB 教人寫 JS 補,且 **2000 筆上限超過就整批不重算** —— 正確性問題非方便性)② 計算層 no-code 綁定(官方把帳務指向 Xero)③ 視覺化規則引擎(四條 JS 是同一件事的變形)。⚠️ JS Workflow 指南全文不在本地庫,能力邊界為反推)|
| **⭐⭐ 34** | **[開源 MES 生態技術與功能拆解](docs/34-開源MES生態技術與功能拆解.md)** | ✅ **2026-08-03 v1**(T 模組之「站在巨人的肩膀上」;六軸平行研究,**所有承重授權逐一複驗 LICENSE 檔本文**。六結論:① 授權形狀不利 —— 功能最完整的 **qcadoo 是 AGPL 不可讀**,可 fork 的 **UMH 根本不是 MES**(官方自述只做 data management)② 但向上位置可稽核 —— **開源 MES 圈無任何終端使用者自助設計器**(qcadoo 加欄位要 `mvn archetype:generate` + XML + Java 重編譯)③ 🔴 **EMQX v5.9.0 轉 BSL 1.1 明文排除 embedded 出貨 → 推翻 docs/11 選型**,改 NanoMQ(MIT)④ 功能矩陣軸改 **ISA-95 P3 4 domain × 8 activity**(與「一 substrate 承載多領域」同構)⑤ **B2MML 為免費合法取得 ISA-95 物件模型之路徑**,不必買標準 ⑥ **APS 無 JS/TS CP-SAT → 唯一須破壞統一 TS 全棧處,待獨立 M0 裁定**。另記 4 起授權漂移 + 3 條不得宣稱事項〔no-code MES 非無人做(Tulip)/ metadata 驅動非差異化(iDempiere AD)/ 開源 MES 非都要寫程式(FUXA)〕)|
| 03 | 鮮勇當前表單分析(Ragic 已滿足 vs 需 ERP 補強) | ⏳ 待做 |
| **05** | **[商業模式驗證](docs/05-商業模式驗證.md)** | ✅ **2026-07-18 v1**(值不值得投入財務模型|競品定價錨 → Weyver 三段式(Pro ~NT$336K/年)→ 客戶分層 ACV 基準 NT$400K → ARR 5 年(Y3~11M/Y5~32M)→ OSS 高毛利 ~80% → 解耦提早營收 breakeven Y2-3;假設可調三情境 + 待拍板清單)|
| 06 | 法律風險與 Clean Room SOP | ⏳ 待做 |

**入場任何新對話前**:先讀 README.md + 01 + 02 對齊 context,不要重問已決策過的事。

---

## 關鍵決策待定(下次見面直接接續)

- [x] ~~Weft 商標檢索~~ → 2026-07-16 完成初步自查,Weft 空間飽和,**改主選 Weyver**(見 docs/02)
- [ ] **TIPO 正式檢索 Weyver + 織雲 Class 09/42**(近似音含 Weijver / Weaver / Weyber)
- [ ] **USPTO 正式檢索 Weyver Class 009/042**
- [ ] **weyver.io + weyver.app 註冊**(可直接註,先卡位)
- [ ] weyver.com broker 議價(2025-05 剛被 squat,可能 1–3k USD)
- [ ] **戰略決策|是否進大陸?**(影響「織雲」中文品牌可用性 — 撞 Tencent 织云)
- [x] ~~資料夾 `weft/` 是否連動改名 `weyver/`~~ → 2026-07-18 完成(folder + memory path 改名 + `git init` 首次 commit;git remote 待定)
- [x] ~~路線 A vs 路線 B~~ → 2026-07-16 定案|走 **路線 A|Ragic + ERP + MES + ISO 一體 offering,缺一不可**(v2.0,見 docs/04)
- [x] ~~是否採 Odoo fork~~ → 2026-07-16 定案|**不 fork Odoo,全自研 TypeScript**(v2.0,domain 學習純合法來源)
- [x] ~~Grid 引擎:自研 vs AG Grid Enterprise 授權~~ → 2026-07-16 定案|**Glide Data Grid OSS(MIT)+ 自建 pivot / master-detail / Excel export**(v2.1 OSS-only pivot)
- [ ] 團隊規模:5 / 8 / 12 人

## 下一步順序

1. ~~商標與網域自查~~ → 2026-07-16 完成,主選改 Weyver
2. ~~ERP 領域邏輯估算(第四份)~~ → 2026-07-16 完成 `docs/04-完整產品功能表.md`(Ragic + ERP 統合)
3. **⭐ 第三份文件|鮮勇當前表單分析** —— 用 docs/04 Ragic 涵蓋欄反查,可能推翻某些 ✅ 判定
4. 商業模式驗證(第五份) —— 用 docs/04 的 278 MVP + Phase 0 = 130 人月數據估 ARR / 回本
5. 法律風險與 Clean Room SOP(第六份)

---

## 時間戳

- 2026-08-03|**docs/34 開源 MES 生態拆解(六軸平行研究)+ EMQX 選型推翻**|決策方要求「跟 ERP 一樣做開源 MES 功能分析,站在巨人的肩膀上向上開發」。六軸:專門 MES/MOM · ERP 內建製造模組 · IIoT 連線層 · SCADA/HMI 現場 UI · 排程/SPC/CMMS/OEE 演算法 · MES 標準框架。**所有承重授權由本專案逐一複驗 LICENSE 檔本文,未採信轉述**。🔴 **最重要產出=推翻既有選型**:`docs/11` line 1152 逐字寫「EMQX open-source edition(Apache 2.0)」,但 EMQX v5.9.0+ 已為 **BSL 1.1**,Additional Use Grant 明文排除「integrating it into a product or solution offered to third parties」——正是 Edge Gateway per-customer 出貨形態。已全文改為 **NanoMQ(MIT)**,並修正 line 1326 指錯地方的交叉引用(§5.4 談的是 Kepware/Ignition 對接,未涉授權)。**四起授權漂移**:UMH AGPL→Apache-2.0(2023-03,舊資料會誤判為不可用而白白放棄資產)· EMQX Apache→BSL · Grafana Apache→AGPL(v8.0)· 万界星空行銷文稱 Apache 但 repo 為 GPL-3.0。**三條新鐵則入 AGENTS.md §5-bis**:`gh api .license.spdx_id` 不可作唯一依據(qcadoo/Odoo/frePPLe/Mosquitto/B2MML 全回 `NOASSERTION`)· 廠商行銷頁不算數 · 同公司不同產品授權可不同(EMQ 的 EMQX 轉 BSL 但 NanoMQ 仍 MIT)。**其餘結論**:功能矩陣軸改 ISA-95 P3 4×8(與「一 substrate 承載多領域」同構)· B2MML 為免費取得 ISA-95 物件模型之合法路徑(permissive + 強制姓名標示)· APS 無 JS/TS CP-SAT(npm 實測 `or-tools`/`cp-sat`/`timefold` 全 Not found)→ 唯一須破壞統一 TS 全棧處,**待獨立 M0 裁定** · OEE 三派分歧(TPM/SEMI E79/ISO 22400)→ **不得寫死公式,分母選擇是業務決策**,落在 [[feedback-calc-binding-self-service]] · FSMA 204 生效日**已延至 2028-07-20**,其 TransformationEvent「多對多投入→產出」須為批次追蹤一等公民。**三條不得宣稱**(避免重演 docs/17 教訓):no-code MES 非無人做(Tulip)· metadata 驅動非差異化(iDempiere Application Dictionary 官方逐字「often without the need for adding software」,Compiere 2001 血統)· 開源 MES 非都要寫程式(FUXA 純 GUI)。

- 2026-07-19|**F-2 Auth SHIPPED v1.0(M0→M5,dev header→真實認證)**|承 R1 命門後補「對外上 prod 硬前提」。M1 Better Auth 引擎 DI 接入(Argon2id / secret prod fail-fast)→ M2 org↔tenant · user↔actor 對映(IdentityService 冪等 upsert;`users` + `tenants.auth_org_id`/`parent_tenant_id`,Tier-1 系統表非 RLS)→ M3 **AuthGuard**(getSession→activeOrg→tenantId;**剝除 client 租戶 header**;TenantGuard 環境分派 prod→Auth / dev→DevTenant;**跨租戶隔離 e2e:B 讀不到 A / 偽 header 無效**;org→tenant 走 `afterCreateOrganization` hook)→ M4 掛 `/api/auth/*` handler + 前端 authClient / 登入·註冊·登出 / `/app` 受保護 layout(**強制登入僅 prod**,對齊後端 dev/prod;登入設 active org)→ M5 硬化(Better Auth rateLimit 寫端點嚴限 + get-session 放寬〔M4 誤傷已修〕/ 安全標頭 onSend / throttler / cookie httpOnly·SameSite)+ `auth.spec` 固化 + **§12 FMEA P0 全緩解**。踩點:auth.module↔auth-guard 循環 import(AUTH token 抽 auth.tokens.ts)· fastify 4.28/4.29 型別重複(釘 4.28.1)· get-session 被自設 rateLimit 429。Playwright MCP 實走(註冊「鮮勇食品」→builder→登出→登入 org 名解析)。api 110 + web 4 e2e 綠。治理決策見 auth.md §6-bis(登入按角色分層 + owner 須公司可控可回收 + 社群不得為 sole owner + offboarding SOP)。

- 2026-07-19|**docs/04 v2.7 ERP-parity 缺口審計(484 → 503)**|反思「取代 ERP」定位後對照鼎新/正航/Odoo 標配掃缺口(排除已規劃之銀行對帳/合併報表/預算控管):採積極型補 6 項全 R2 —— L 委外加工 5(食品加工硬需求)· J 票據管理 3 · K 信用額度 2 · O 營業稅申報 401/403 2(開票≠報稅)· E 職責分離 SoD/內控 3 · G 預建連接器庫 4(銀行/物流/電商/政府)。SoD/連接器 homed 於 A-I 但 release 歸 R2。**MVP 484→503(R2 +204→+223,R1 ~240 不變);對標 ~944;累計 440→503 +14% 由維運拖累吸收,band 不變**。對標暫緩|量測校驗 / 協同 portal。cascade|04 v2.7 · 25 v1.4 · 23 v6.5 · 13 v1.8 · 07 v2.14 · CLAUDE/README。相關|命門原則見 [[feedback-calc-binding-self-service]](算的綁定須自助化)。
- 2026-07-19|**docs/04 v2.6 S22 設定頁深掘(480 → 484)**|用戶追問「通知設定 / 自建員工帳號 / AI API key 這類設定頁功能是否完整」→ 對照國際級設定頁分類(Salesforce Setup / M365 admin / Slack admin / Odoo Settings)逐類掃描:員工帳號 v2.5 已補;通知路由與個人偏好已有、**缺租戶通道連接憑證 UI**;**AI 設定頁全缺**(docs/17 只有 provider 抽象層工程面 —— OSS-only 下客戶 BYO API key 為唯一路徑,R1 AI 功能無此頁不可用)。全採補 3:A AI 設定頁 +2(BYO key 加密 / 模型 / 用量 / 資料外送同意 / 表單級 AI 開關)、H 通知通道連接 UI +1(LINE token / webhook / SMTP 網域驗證 + 測試發送)、G API 金鑰管理 UI +1(簽發/輪替/撤銷/scope);SSO 自助設定 UI 明文化入 A 認證。**MVP 484(R1 ~240);對標 ~911;band 不變(+0.8%)**。cascade|04 v2.6 · 25 v1.3 · 24 v1.4(S22 擴充)· 23 v6.4 · 13 v1.7(P1-I ~91)· 07 v2.13 · CLAUDE/README。
- 2026-07-19|**docs/04 v2.5 企業級 SaaS 通用功能審計(472 → 480)**|用戶質疑「設定/權限等通用功能是否缺列」→ 反查 docs/10 §3.1(Ragic 平台/帳號管理)+ 通用功能清單:權限模型 E 已列,**「設定/管理」surface 從未列項**(R1 Ragic parity 破口)。全採建議補 8 缺口:A 租戶設定中心 2 / 帳號安全操作面 1(併 F-2 Auth)、E 使用者管理後台 UI 1 / 外部使用者 1、H 個人設定 1 / 資源回收桶 1(引擎 soft delete 地基已 SHIPPED)、I PDPA 資料權利 1(R2);對標暫緩|測試環境 sandbox(+3)/ 公告導覽(+2)。**MVP 480(R1 +7 → ~236 / R2 +1 → +~204);對標 ~904;solo 時程 band 不變(+1.7%)**。cascade|docs/04 v2.5 · 24 v1.3(**補 S22 設定中心**,Phase 1 = S1–S13+S22,入口收 topbar 帳號選單不佔側欄)· 25 v1.2 · 23 v6.3 · 13 v1.6(P1-I ~87)· CLAUDE/README。已涵蓋確認不缺|權限模型 E12 / 認證 SSO·2FA A3+SCIM G3 / 稽核 S13 / 備份匯出 I / 客服後台假登入 I / 白牌配額 A / 通知路由 S10 / 範本庫 B2 / 計費 Phase 2。
- 2026-07-19|**Gate P0-1 全數達成:form-designer-ui M0→SHIPPED v1.0(前端接引擎 API)**|承後端核心後,依 M0 流程(OQ-FDU-1..6 全採建議)接前端:M1 engine API client(錯誤信封→EngineApiError / dev tenant localStorage 單點 / Zod 解析 / TanStack Query hooks / Next rewrites 同源代理免 CORS)→ M2 `/app/builder` 表單清單(nuqs URL)+ 設計器雙模式(新建發布 / 編輯增欄·白名單改型別·上下移;後端補 PATCH position API)→ M3 填單動態渲染(15 型別 field-input;修 pg DATE type parser 位移 bug)+ 記錄檢視 → M4 子表 header+lines 走 saveWithLines(DB parent_id/line_no 驗證)→ M5 **Playwright golden path 固化進 CI**(建表→加欄→填單→子表→檢視,對真 api+真 PG 綠)+ FMEA(P0 全清)。web 18 + api 60 單元/整合 + e2e。每步 Playwright MCP 實走真瀏覽器驗證(抓到並修 date parser bug)。**瀏覽器裡「自己建自己填」完整跑通** —— Ragic 範式核心迴圈成立。
- 2026-07-19|**進入 Phase 1 工程;P0-1 表單引擎核心 M0→SHIPPED v1.0 一日走完**|用戶拍板開發起跑 → M0 design doc(OQ-FEC-1..7 全採建議)→ M1 spike Gate 通過(10K 表 catalog 近線性 ×1.22 / advisory lock 開銷可忽略·禁 rewrite DDL / RLS 8 斷言 + 兩個 production 發現:set_config 參數化、GUC reset `''` 需 NULLIF)→ M2 `apps/api` NestJS+Fastify 骨架 + metadata catalog(physical identifier 由 DB generated column 保證)+ 15 型別雙軸 registry → M3 DDL 安全鏈(三段式 provision + advisory lock + ddl_audit)→ M4 記錄 DML(name-keyed values / autoNumber sequence / filter 白名單)+ 子表單一 tx → M5 租戶隔離(weyver_app 角色分離 + 每 tx set_config;**BOLA killer 測試:無 WHERE 的查詢 RLS 兜底不洩漏**)→ M6 REST API(錯誤信封 / dev guard prod fail-closed;Swagger→zod-openapi deviation)→ M7 FMEA(P0 12 項全清,殘留 6 項 P1/P2 歸屬明確)。59 tests(Testcontainers 真 PG)+ dev live smoke。docker-compose PG16(OrbStack :5433)+ spikes/ workspace。模組流程紀律確立:`docs/modules/`(_template + MODULES.md 索引)。
- 2026-07-16|專案啟動,完成 01 工程量估算 + 02 命名候選,主選 Weft
- 2026-07-16|資料夾從 `ragic-saas` 改名 `weft`
- 2026-07-16|套用 claude-starter 模板(AGENTS.md + memory + docs 工作流程檔)
- 2026-07-16|完成 Weft + 備選(Weyver / Formora)初步商標/網域自查 → **主選改 Weyver(織雲)**,Weft 降備選(見 docs/02 v2)
- 2026-07-16|完成 docs/04 完整產品功能表 v1(合併 Ragic 9 模組 + ERP 8 模組)。MVP 從 168 → 278 人月;8 人團隊完整 MVP ~3.7 年 / Phase 0 上線收費 ~1.7 年。
- 2026-07-16|docs/04 v1.1 補全 🔴 gap:+R HR/薪資、+S CRM 輕量、+J 多幣別/合併/預算/費用、+C 單據流編排、+K 序號條碼/儲位、+P 三角貿易、+F Kanban/Calendar 視圖;訂閱計費從 MVP 移 Phase 2。MVP 328 人月(+50),8 人完整 MVP ~4.3 年 / Phase 0 ~1.8 年。同時建 `cspell.json` 專案字典白名單。
- 2026-07-16|抓 4 家(Ragic / Digiwin / SAP B1 / 正航)UI 截圖 61 張到 `docs/research/ui-screenshots/`。正航覆蓋弱需補。
- 2026-07-16|得知現存導入 pipeline **17 家客戶,已 80% 完成度,分批 2026-07 到 12 上線**(pipeline 導入業務財務結構與本規劃分開處理)。Weyver 定位改為「現存產品 next-gen 重寫,已上線客戶未來升級」。開發者角色為「單人執行 17 家導入 + 同時開 Weyver R&D」。產 `docs/07-產品開發時程規劃.md`(初版時檔名為 `07-個人開發時程表.md`,2026-07-16 v2.0 rename;2026-07-16 v2.1 產能重估)。**投入強度 16-18 hr/day 全職 + 週 6 日**,M18 milestone|Q 模組完整 + 對帳 UI + 電子發票 stub + 泛產業批次追蹤 + 1 家 pilot 上線。
- 2026-07-16|docs/04 v1.2:發現 pipeline 產品是「ERP+**MES**+**ISO**」三合一,補 T MES(22 MVP:現場執行 / SCADA / OEE / Andon / 排程)+ U ISO(24 MVP:文管 / 內外稽核 / NCR / CAPA / **HACCP CCP** / 過敏原);修 v1.1 Ragic 側加總誤差;補小 gap(B 快速範本 / F SQL+個人化 / G Public Form+API log / H 電子簽章+主題 / L 工時);用 Ragic 官方 doc 15 張截圖校準 ✅ 判定。**MVP 328 → 367(+39)/ 8 人 4.3 → 4.8 年 / Phase 0 140 → 154 人月 24 個月**。
- 2026-07-16|docs/04 v1.3:**MES + ISO 從 MVP 拆出**,標範圍外附錄。理由|定位重申「Ragic+主流 ERP+多租戶 SaaS」,MES(SaaS 與 SCADA 硬體衝突)+ ISO(有專門 vendor)非核心差異化,對接第三方或客戶既有解。**MVP 367 → 321(-46)/ 8 人 4.8 → 4.2 年 / Phase 0 回到 140 人月 22 個月**。命門 11 → 9,人才風險移除 MES/ISO 兩類。
- 2026-07-16|docs/04 v1.4:Ragic 全 15 張截圖校準完(v1.2 只看 4 張)。發現一個真正的漏 → B 補「用既有 Excel 建立表單」sub-feature(Ragic 差異化 onboarding 神器)。**MVP 321 → 323(+2 marginal)**。定稿。
- 2026-07-16|docs/04 v1.5:**產品定位重申為多產業通用 SaaS**(非食品業垂直)。全域中性化食品業特化語言;A1 假設改 pluggable ERP adapter 框架;新增 A9 明示「pilot 產業集中但平台通用」;產業別合規(HACCP/GDP/SN 深度)標為 add-on。**MVP 人月不變(323),模組不變,只重寫定位語言**。
- 2026-07-16|docs/04 v1.6:**MES + ISO 恢復入 MVP(修正 v1.3 拆出決策)**|定位由「多產業通用 SaaS」升為「**多產業通用企業級平台**」對標主流 ERP vendor 三合一 offering。修正 v1.3 拆出理由:(1)「多租戶 SaaS + MES 硬體衝突」被 **Cloud + Edge Gateway hybrid 架構(A10)** 化解;(2) ERP+MES+ISO 三合一是主流 vendor 標配。新增 A10-A11 架構假設。**MVP 323 → 369(+46)/ 8 人 4.2 → 4.8 年 / Phase 0 140 → 154 人月 24 個月**。命門 9 → 11,人才風險 5 → 7。
- 2026-07-16|docs/04 v1.7:基於 docs/08 MES + docs/09 ERP + docs/10 Ragic 三份市場分析報告校準|新增 A12(A-I 對 Ragic parity 完成)+ A13(對照國際 Tier 1 進階功能為對標階段 add-on);J/K/R 對標欄補 Multi-book / ASC 606 / 進階 WMS / Recruiting / Talent / Learning;MVP 不變 369,對標 +25。
- 2026-07-16|docs/04 v1.8:**ISO 定位變更為通用工具平台,產業特化客戶自建**|U 只做通用工具(文管/稽核/NCR/CAPA/教訓/客訴/供應商評鑑/管理審查),**HACCP CCP + 過敏原 / 蟲害 / 清潔紀錄 由客戶 ISO 專員在 B+C 自建**(呼應 Ragic self-service 精神,strengthen 表單引擎+工作流戰略價值)。**MVP 369 → 361(-8)/ 8 人 4.8 → 4.7 年 / Phase 0 154 → 150 人月**。命門|U HACCP CCP 移除,改為 B+C self-service。人才風險|移除 ISO 稽核員(客戶自帶)。
- 2026-07-16|docs/04 v1.9:**拆 ERP CORE + 拋 Odoo fork + 統一 TypeScript 全棧**|用戶對「後端 Python」pushback + 四目標(安全/可靠/性能/好維護)判斷 → 選項 C(拆 ERP CORE)。**J/K/L/N/P 拆出由客戶自帶 ERP**(-81 MVP);A2 假設 update「路線 A 通用 SaaS + 全自研 TypeScript」;新 A14/A15 假設。**MVP 361 → 280(-81)/ 8 人 4.7 → 3.6 年 / Phase 0 150 → 117 人月 18 個月**(縮 6 月)。命門|Q 升為 v1.9 對外最核心承諾;J GL 移除。人才|移除 ERP 財會顧問 + Odoo fork 資深(2 類)。docs/11 亦升 v2(拋 Odoo,§4 改為 pluggable adapter framework)。
- 2026-07-16|docs/12 v1 + docs/11 v3:**TypeScript 7 Native + NestJS 10 + Fastify adapter**|user 對 v2 之 Fastify only pushback「企業級軟體很少用 Python,前後說詞反覆」→ docs/12 全面評估(TS 7 現狀 + Fastify/NestJS/Encore.ts/Hono 對照),user 拍板「企業級應用框架,安全、可靠」→ 選 **NestJS + Fastify adapter**(產業標配 opinionated + Guards/DI/RBAC 內建 + Fastify adapter 保 90% throughput)+ **TypeScript 7 Native**(10x compile,Bloomberg/Google/Notion pre-release)。docs/11 升 v3。
- 2026-07-16|**docs/04 v2.0 revert 拆 ERP CORE**|user「系統本來就針對 Ragic+ERP+MES+ISO 設計,缺一不可」→ Weyver 自建全套 ERP CORE(全自研 TS,不 clone Odoo source,A16 純合法 domain 學習)。**MVP 280 → 419**;8 人 3.6 → 5.5 年。docs/11 v4。下載 Odoo docs(CC BY-SA)到 `reference-materials/`。
- 2026-07-16|**docs/04 v2.1 OSS-only + v2.2 通知**|user「只用免費開源軟體」→ 全砍商業授權(AG Grid→Glide Data Grid / Sentry→GlitchTip / Doppler→Infisical / Chromatic→Playwright / Vercel→Coolify)。H 通知加 LINE/Slack/Teams/Telegram/WhatsApp/Discord。**MVP 419 → 429 → 440**。docs/11 v5/v6。docs/13 開發順序表 v1。
- 2026-07-17|**docs/14 前端設計規則 + 設計系統定案**|經 6 版首頁迭代(死板→消費暖色→企業級 v6),對齊 Dynamics/Ramp/Sigma 企業基準。**字型經視覺評估選 IBM Plex 超家族**(取代 Inter「AI 預設」)。深海青 #0C5F73 + 細邊框 + 資料導向。產 `docs/mockups/design-system.html` + `homepage-v6.html` + `form-engine.html`。多租戶=單一租戶(移除切換工作區 UI)。修正「已整合系統(鼎新同步)」誤植 → 改「現場設備」(Weyver 取代 ERP,非依附同步)。
- 2026-07-17|**架構主張定案|Ragic 表單引擎為 substrate**|user 明確「廠商放棄原 ERP,統一用 Ragic 範式取代 ERP,再加 MES+ISO」。表單引擎 = 平台底層(非模組之一);ERP/MES/ISO 單據皆為引擎上的表單 app,深層計算(GL/MRP/成本/估值)由計算層補。新 A17 假設。Q 多 ERP 對帳角色收斂(至多 onboarding 一次匯入)。codify 進 docs/04 定位 + A14/A17、docs/11 §2 架構圖、docs/13 §0 原則、CLAUDE 一句話定位。
- 2026-07-17|**docs/11 v7|Modular Monolith 定案(非微服務)**|user 問是否拆 Ragic/ERP/MES/ISO 微服務 → 結論**不拆四大業務微服務**(理由:solo dev 全成本零收益 / 打架 substrate 共用引擎+DB / 跨模組整合變分散式交易地獄 / 韌性靠多實例+Edge store-and-forward)。採**模組化單體**,只按技術特性抽 4 單元(Edge Gateway / 即時採集 / 背景 worker / 搜尋)。§ 1.3 新增決策 + 「何時才拆微服務」6 條判斷表(<3 項成立不拆)。
- 2026-07-18|**docs/11 v8|Prod 雲端部署架構(AWS/GCP)+ 全服務成本**|用戶要求評估 prod 部署(dev 全本地無議題)。新增 § 16.5-16.11:(a) 釐清 **OSS-only 於雲端 = infra≠軟體授權**,用 managed-OSS(RDS/Cloud SQL=OSS PG、Memorystore/ElastiCache=Valkey、Cloud Run/Fargate=OSS 容器)+ **避 Aurora/DynamoDB/Spanner 專屬 lock-in** → cloud-portable;(b) 由 VPS 升 managed 之正當性 = **solo binding constraint 是 attention(docs/07),managed 買回 ops 時間**;(c) AWS + GCP 兩套參考架構 + 服務對應 + Tier E 成本;(d) **主推 GCP**(asia-east1 **在台灣** data residency + Cloud Run solo-ops 最低 + 略便宜),AWS 強備案;(e) 三情境成本 pilot ~NT$4-6K / early ~NT$14-22K / scale ~NT$80-160K + 省成本槓桿 + 單位經濟對 docs/05 ACV <1% 保 80% 毛利;(f) Edge Gateway on-prem self-host EMQX。§ 11 DevOps 對齊 OSS-only(Sentry→GlitchTip / Vercel→Cloud Run / Doppler→Infisical)。**成本為 list-price 2025 估算,build 前須複核**。
- 2026-07-18|**階段重排|Ragic-parity-first(既有客戶遷移策略)**|用戶決策|客戶目前都在用 Ragic → **第一階段先交付完整 Ragic 功能讓客戶遷移,ERP/MES/ISO 後續接**。範圍定為**完整 Ragic A-I parity**(用戶選:全 204 人月,非子集)。roadmap 重排(總量 440 與 solo 時程總長不變,只改順序與各階段內容):**R1/Phase 1 = 完整 Ragic 平台(204,land 既有客戶)→ R2/Phase 2 = ERP 核心 + 計算層(+198,補『算』取代 ERP)→ R3/Phase 3 = MES + ISO(+38,完整 MVP)→ R4/Phase 4 = 對標 + AI**。完整表單引擎自舊 R3 前移 R1、AI 進階移 R4。累計時程(solo 務實):R1 ~2-2.5 年 / R2 ~4 年 / R3 ~4-4.5 年。cascade|docs/23 v6(四階段 + §1.5 + 矩陣全重映)· docs/13 v1.2(Phase 概觀 + M18 改 Ragic-first)· docs/04 v2.3(Phased 出貨 + Talking Point 3)· **docs/19 superseded**(其「固定 schema ERP 先出」與此相反 → 降為 R2 ERP 建構技法,技術洞見仍有效)· strategy-slides 待更新 slide 8。**張力已向用戶點明**|R1 純 Ragic = 客戶已有的東西、無新差異化 → Phase 1 本質是 land(遷移+綁),付費升級的「算」在 R2;且與 docs/19 刻意 de-risk(表單引擎移出關鍵路徑)相反,最難的 P0-1 動態 schema 回到最前。用戶接受。ERP-before-MES 排序係本人依「ERP 198 人月為差異化核心、MES+ISO 僅 38」推定(用戶列「MES、ERP、ISO」為列舉非優先序)。
- 2026-07-18|**重刷 docs/strategy-slides.html**|原簡報落後 3 大版本且有方向性錯誤(Odoo fork / MES·ISO 標範圍外不自研 / AG Grid 授權 / 323 人月 / 8 人時程)。整份重寫為 13 張對齊現行:Ragic substrate 取代 ERP+MES+ISO 一體 offering 定位、市場驗證(客戶已用 Ragic 撞「算」的牆)、21 模組、440 MVP、全自研 TS 拋 Odoo fork + clean-room、計算層差異化(docs/18)、兩層解耦出貨(docs/19)、solo 時程 + Vernova 實證校準、11 命門、商業模式(Pro ~336K / ARR Y3 11M Y5 32M / breakeven Y2-3)。品牌 token 由 Inter(曾被標 AI 預設)改 IBM Plex + 深海青 #0C5F73(對齊 docs/14)。
- 2026-07-18|**全庫 cascade|時程基準 8 人團隊 → solo(承 docs/23 v5)**|用戶指示「其他有 8 人團隊相關的都改 solo」。**分類處理**|(a) live 檯面內容改 solo 主基準:CLAUDE.md 已估算結論表(2 列)、docs/04 v2.3(時程 Scaling 節 + A5 假設 + Phased 出貨 + Talking Point,順帶修 stated 419→440)、docs/05 v1.1(回本模型 2 處)、docs/13 v1.1(§0.2 Solo bandwidth 校正 + §1 完整 MVP 標頭)、README docs/23 索引。統一數字|完整 MVP solo 務實 ~4-4.5 年 / 加速 ~3 年、Phase 0/R1 務實 ~2-2.5 年 / 加速 ~1.5 年,8 人列降為「若擴編」對照。(b) **保留不動**|各 doc 版本 changelog / CLAUDE 時間戳 log(歷史記錄)、docs/11 v4 changelog 之對齊註記、docs/01 legacy(168 人月舊 scope)、「團隊規模 5/8/12」開放決策項。(c) **待用戶決定**|docs/strategy-slides.html 數字 stale(323 人月 / 4.2 年,落後 3 版)需整體重整非只換 solo。
- 2026-07-18|**docs/23 v5|時程基準 8 人團隊 → solo**|承上,用戶指出「開發僅 ahern 一人,應更快」。**8 人團隊 5.5 年係虛構基準且反較 solo-峰值慢**(docs/07 §1.4 (a) 純 focus solo 加速 ~2 年 < 8 人 5.5 年,因 8 人估算用傳統 ~0.8 人月/月/人,solo AI 輔助峰值為其數倍)。docs/23 全文改以 solo 為主基準:各 release 標頭 + §1.5 表 + 加速 band + footnote 換 solo **務實檔**(80% steady + 峰值×0.3,承諾底線)R1 ~2-2.5 / R2 ~3.5 / R3 ~4-4.5 年;**加速檔**(90% + 卸載維運,努力目標)R1 ~1.5 / R2 ~2 / R3 ~3 年。**壓不到 ~1-2 年之硬約束**|(1) 純 focus ~2 年已內含峰值×0.5 續航折損,(2) 17 家導入到 2026-12 為合約硬 deadline 前 ~1 年 R&D 近零。移除「團隊等比例調整」+ 加「擴編則後段加速」對照。
- 2026-07-18|**docs/07 v2.9 + docs/23 v4|calendar 稀釋校正**|回應「已實測 Vernova 產能為何時程仍長」:(a) docs/07 § 1.4 校正舊「前 ~1 年 90-95% 導入」為 **~6 個月密集期(2026-07~12,對齊 § 3)**;新增純 focus (a) / 稀釋模型 (b) / 疊加後 calendar (c) 三表;**核心結論|solo 時程 bound 於穩定期 ~30% 維運拖累(17 家 live 客戶),非 coding 速度**——校正前段僅省 ~6 個月(小槓桿),唯有維運卸載至 ~90% focus 才使加速情境 完整 MVP 壓至 ~2.7 年(< 3 年);務實 ~4-4.5 年 與 8 人保守 5.5 年收斂(修正舊「solo 務實已快於 8 人」係未計稀釋)。(b) docs/23 § 1.5 加速 band 重算|R1 ~1.5 年 / 完整 MVP ~2.5-3.5 年;保守 8 人地板不變。cspell 加 Vernova。
- 2026-07-19|**docs/25 功能審計 + 全數拍板 cascade(440 → 472)**|全 docs(01–24)交叉審計產 docs/25 功能完整對照清單(A–U 全子功能 × R1–R4 × S1–S21 開發追蹤 checklist)。發現 8 缺口 + 5 衝突,用戶「全採建議」:(a) **docs/04 v2.4**|補 AI MVP 5 項 16 人月(B 遷移建表 6 / C 公式助手 2 / F NL 查詢 3 / K 單據抽取 3 / U CAPA 2;Copilot 等 4 項留 R4)+ C ZEN 規則編輯器 3 + J 帳齡 1 + K 三方比對 1 + A 白牌網域 1 / 配額 2 + I 平台可靠性工程 8;**MVP 440 → 472**;**修 v2.1 起 B 小計算術漏**(47 誤植 37,各表加總與宣告總計自此一致);solo 時程 band 不變(+7% 在誤差帶內)。(b) **docs/13 v1.3**|C1 P0-9 之 HR→Phase 2、MES/ISO→Phase 3;C3 sprint 代號 legend。(c) **docs/23 v6.1**|C2 電子簽章拆基本 R1 / 合規 TWCA R2;AI 遷移建表·NL·ZEN 前移 R1、拍照抽單 R2;人月同步(檔頭誤植 v2 併修)。(d) README docs/23 版本 v5→v6.1 同步(C4)。(e) C5|Grid 依 Glide,Teable canvas SDK 列 Phase 2 評估。前端視覺工作另見 docs/24(心智模型)+ mockups(form-first 定調)。
- 2026-07-18|**docs/23 客戶版發布藍圖 + docs/07 §1.4 實證校準 + 資料夾改名 + git init**|(a) docs/23 產品功能發布藍圖(對客戶 R1-R4 + 模組×階段矩陣 + 開發時程保守基準 + 加速情境)。(b) docs/07 §1.4|以 ahern 於 **Vernova AI** 專案 git 實測產能反推 Weyver 時程(**僅計本人 commit**,其餘協作者剔除):個人衝刺淨 +164K LOC / ~961 commits / 53 活躍日 → 峰值 ~86K 淨 LOC/月;三情境 solo 完整 MVP 加速 ~2 年 / 務實 ~3-4 年;binding constraint 為前 ~1 年導入 attention-split 非 coding 速度。(c) 資料夾 `weft/` → `weyver/` 改名 + memory path 同步 + **首次 `git init` commit**(.gitignore 排除 .DS_Store + 生成 PDF;保留 330 張競品截圖研究資產)。
