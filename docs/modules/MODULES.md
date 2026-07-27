# Weyver 模組設計文件索引(按產品功能發布藍圖分類)

> **分類依據**|對齊 `docs/23 產品功能發布藍圖`(R1 完整 Ragic → R2 ERP+計算層 → R3 MES+ISO → R4 對標+AI)+ Foundation(Phase -1 基礎/橫切)。sprint 代號沿用 `docs/13`(P0-x=Phase 1、P1-x=Phase 2,歷史代號)。
> **檔案組織**|各模組 design doc 依所屬 release 置於子資料夾 `docs/modules/<R1|R2|R3|R4|foundation>/`;`_template.md`(骨架)與本索引留在根層。**新模組動工前先寫 M0 design doc,依 release 放對資料夾,並在本表登錄。**
> **流程**(每模組)|M0 DRAFT → OQ 裁定 APPROVED → M1..MN 實作(每 milestone 一 commit)→ FMEA 收尾 SHIPPED。詳見 `_template.md` + `memory/rule_module_design_flow`。
> **狀態圖例**|✅ SHIPPED · 🚧 進行中(APPROVED / 實作)· 📝 M0 DRAFT · ⬜ 未起(規劃中)

---

## Foundation(Phase -1|基礎 / 橫切,gate R1 對外上線)

| 模組 | Sprint | 狀態 | 文件 |
|---|---|---|---|
| Monorepo + NestJS + PG 骨架 | F-1 | ✅ 隨 form-engine-core M2 落地(`apps/api`)| —(見 R1/form-engine-core §9-bis)|
| **Auth + 租戶 context + 使用者身分**(Better Auth + Argon2id)| F-2 | ✅ **SHIPPED v1.0**(M0–M5:引擎+DI · 對映表+IdentityService · AuthGuard session→tenant + 剝 client header + TenantGuard 環境分派 + 跨租戶隔離 e2e · `/api/auth/*` handler + 前端登入/註冊/登出 + 受保護 layout〔強制登入僅 prod〕· rateLimit/安全標頭/throttler 硬化 · auth.spec 固化 · FMEA P0 全緩解;§6-bis 登入分層+治理;org→tenant 走 afterCreateOrganization hook;**dev header→真實認證,R1 上 prod 硬前提達成**。三層 RBAC=P0-4;SSO/MFA=後續)| [foundation/auth.md](foundation/auth.md) |
| UI shell + design tokens + deploy | F-3 | ✅ 前端 v2.1(`packages/ui` + `/app`)| —(見 docs/14)|
| **二步驟驗證(MFA / TOTP)** | F-4 | ✅ **SHIPPED v1.0**(M0–M4:twoFactor plugin + 4 整合測 · 帳號設定啟用/停用 UI〔QR + backup codes〕· 登入二步 challenge〔/login/2fa,TOTP + 備用碼〕· verify 端點 rateLimit · mfa.spec 固化 · FMEA P0 全緩解;承 F-2;scope out email/SMS OTP · passkey · org 強制 · trustDevice)| [foundation/mfa.md](foundation/mfa.md) |

---

## 🟢 R1 · 完整 Ragic 平台(既有客戶遷移 land)

| 模組 | Sprint | 狀態 | 文件 |
|---|---|---|---|
| **表單引擎動態 schema 核心** | P0-1 | ✅ **SHIPPED v1.0**(2026-07-19;M0–M7,59 tests,FMEA P0 全清)| [R1/form-engine-core.md](R1/form-engine-core.md) |
| **表單設計器 + 填單 接引擎 API** | P0-1·UI | ✅ **SHIPPED v1.0**(2026-07-19;M0–M5,Playwright golden path 固化;**Gate P0-1 全數達成**)| [R1/form-designer-ui.md](R1/form-designer-ui.md) |
| Grid 主檢視 + Excel 建表 onboarding | P0-2 | ✅ **SHIPPED v1.0**(2026-07-19;M0–M4;Glide 網格改格 + xlsx 推斷建表 bulk 灌資料;e2e 固化 + FMEA P0 全清)| [R1/grid-and-excel-import.md](R1/grid-and-excel-import.md) |
| 公式引擎 + Link&Load | P0-3 | ✅ **SHIPPED v1.0**(2026-07-19;M0–M6;fork Teable MIT parser + Tarjan SCC 依賴圖 + Link&Load + Rollup N+1 + 讀時算注入 + 設計器啟用 + 即時預覽 + e2e 固化;66 tests;FMEA P0 全清)| [R1/formula-and-linkload.md](R1/formula-and-linkload.md) |
| **三層權限(授權層)** | P0-4a | ✅ **SHIPPED(M1–M7 + FMEA + 管理 UI)**|表單級 **動作集**(view/create/edit/delete/approve/export/design,M7 由 4 級升級,Guard 執法)+ 欄位級遮罩/寫白名單 + **role tree 部門繼承**〔OQ-1=C〕+ owner→admin 對映 + 權限管理 API + **管理 UI `/app/settings/permissions`**(角色樹+動作矩陣+欄位可見性,瀏覽器驗證往返);deny-by-default;縱深(RLS 仍為跨租戶最後防線);後端 163 tests 綠、§12 FMEA P0 全清。記錄級延 P1-I | [R1/authz.md](R1/authz.md) |
| **↳ 資源軸繼承(分類授權 + owner + 敏感旗標)** | P0-4a·uplift | ✅ **SHIPPED v1.0(2026-07-24;M1–M4 + FMEA)**|解逐表列舉維護膨脹(`O(表單)→O(分類)`):既有 `form_permissions` 重定位為**覆寫層**,其下補**分類授權層** `category_permissions` + owner 短路(`form_def.created_by`,**得資料動作 design 除外**)+ 敏感旗標(不吃繼承,admin-only)+ 租戶預設 profile(Salesforce OWD 式)+ 無權表三態(readable/鎖定 stub/敏感隱藏)。migration 0008 純加法惰性零回歸;分層解析 owner→覆寫→分類繼承→預設;管理 UI(FormMatrix 分類分組 + ResourceSettings + 工作台鎖定 stub);後端 40+ tests + 6 web e2e 綠(`permissions.spec` 固化)。**向上設計研究**(Notion/Salesforce/Drive/Purview,§10-bis)錨定 OQ-ARI-1..8。commit `4c9b76b`(後端)| [R1/authz-resource-inheritance.md](R1/authz-resource-inheritance.md) |
| **↳ 記錄工作台收斂(app-shell + 集合視圖 → Object Page)** | R1·workbench-uplift | 🚧 **M0 APPROVED — OQ-RWB-1..7 全裁定(2026-07-24,全採建議),待 M1**|承 form-designer-ui;現況 Object Page 已誠實建好 ~70%(master-detail + 錨點 + label/value + 子表 rollup + 稽核)。補 R1 缺口:**A0 app-shell 密度**(全域 status bar + 首頁卡牆改工作面,回應「頁面單薄」;M1 先做)+ **① 集合視圖**(browse 網格)+ 狀態章 / 金額彙總 / 關聯 rail(正+反向,需小後端)/ user 名 / inline 編輯;OQ-6=C 單域 rail+status bar;R2/工作流(GL/簽核/批號)不放。UI 依 `docs/mockups/weyver-integrated-list-to-object.html` | [R1/record-workbench-ui.md](R1/record-workbench-ui.md) |
| **工作區 IA(分類目錄首頁 + app-shell)** | R1·UP-1 | ✅ **SHIPPED v1.0(2026-07-25;M1–M5 + FMEA W1–W6)**|docs/27 §6 順序 1(OQ-UP 全裁定後首發):首頁卡牆改**分類目錄**(復用 form_categories,三態可見性,空分類隱藏)+ 左 icon rail / 底部 status bar 信任訊號(OQ-RWB-6=C 落地)+ ⌘K command palette 導航搜尋(client-side 零洩漏)+ Object Page 動作列(複製/刪除/友善列印 + print CSS);**誠實不上**通知鈴鐺(無事件源)/工作項目(獨立模組)/右欄佔位。小後端:`GET /api/categories`(非 admin,tenant-scoped)+ forms DTO +categoryId/updatedAt。api 200 + web 7 e2e(`workspace.spec` 固化)綠。commit c15913a(後端)+ ec7504e(前端)| [R1/workspace-ia.md](R1/workspace-ia.md) |
| **視圖系統 + 集合(browse)視圖** | R1·UP-2 | ✅ **SHIPPED v1.0(2026-07-25;M1–M5 + FMEA V1–V12)**|docs/27 §6 順序 2(承 workspace-ia):落地 D2「Ragic 語意、Airtable 骨架」—— 每表恆有**集合 Glide 網格視圖**(套 view 選欄/篩選/排序、inline 編輯、前導「檢視」欄下鑽)+ 與 Object Page **雙模式**(nuqs mode/rid,列表為進表預設)+ `view_def`(0009,authz Tier-1 車道非 RLS)**儲存檢視三態**(個人/共通/預設,admin-gating + 預設唯一)+ facet 篩選(型別感知 operator、單層 AND\|OR)+ 多鍵排序 + 快速搜尋(textual ILIKE)+ 批次刪除 + client-side 匯出。records query 擴充單層 combinator(OR 包 group 不洩 tenant/deleted_at 邊界)+ 快速搜尋。**OQ-VL-2 修正 docs/27 §3**:forcedFilter 非 view 屬性 → 移出歸 authz 軸(Airtable 明文 view filter 非安全邊界 / Teable Authority Matrix)。api 220 + web 12 e2e(views.spec)綠。commit f986477(後端)+ 3300561/9ccda81/9c7cdba(前端)+ ad2a4c2(spec)。殘留 P1:伺服器端大量匯出 / autoNumber·formula 篩選 / `/me` capabilities | [R1/views-list.md](R1/views-list.md) |
| **2D 表單設計器(form-designer-ui uplift)** | R1·UP-3 | ✅ **SHIPPED v1.0(2026-07-25;M1–M5 + FMEA F1–F10)**|docs/27 §6 順序 3(承 views-list):落地 D1「2D 格線畫布=填單畫面」—— 既有線性設計模式 uplift 成 Excel 式 **2D 格線畫布**(row/col/span 擺位、拖曳、合併)+ **靜態敘述/圖片元素** + **表單分段**(列範圍)+ **欄位設定核心**(預設值 17 變數 / 唯讀 / 隱藏 / placeholder / 說明)+ **設計草稿模型**(批次 Save + Ctrl+Z)。**核心洞見**:版面皆 layout metadata、與資料正交 → `form_def.layout` JSONB(migration 0010),form-engine-core DDL/DML 鏈**不動**(低風險)。OQ-FD2-2 定調:layout 走草稿、結構性 DDL 維持即時(Ragic 排除清單);靜態=layout 元素非 field_def(OQ-3);分段=列範圍(OQ-4);畫布 CSS grid + dnd-kit(OQ-5)。create-time 預設值變數($DATE/$USERID 等)。api 226 + web 15 e2e(designer.spec,拖曳分步 mouse)綠。commit e073659(後端)+ cd7dc3a/4a2ee56/2445a5f(前端)+ a473a6a(spec)。殘留 P1:填單頁 Markdown sanitize / 格式 mask·民國年 / 條件式格式 / 全延遲結構性變更集。≈0.47 mo(四模組最大)| [R1/form-designer-2d.md](R1/form-designer-2d.md) |
| **欄位型別 parity(form-engine-core 增量)** | R1·UP-4 | ✅ **SHIPPED v1.0(2026-07-25;M1–M5 + FMEA T1–T10)**|docs/27 §6 順序 4(承 form-designer-2d):落地 §2 欄位型別 P0 —— **系統欄 4 型**(投影 audit 零儲存)+ **rollup**(複用已完整 RollupService,接讀時 field type)+ **lookup**(複用 RelationService,讀時注入)+ **link 補完**(啟用/驗證/顯示標籤/link&load/reverse)+ **autoNumber pattern**(token 文法 + date + reset,counter table)+ **選項顏色 + 連動選項**(options 加法擴充,valueSchema 不變零遷移)+ **條碼生成**(前端 OSS lib 渲染,零 DB)+ **格式遮罩**(displayMask 顯示)。核心洞見:RollupService 已完整、formula withFormulas 讀時注入為 lookup/rollup/系統欄範本、link 部分已建。**OQ-FTP-6**:image/signature/attachment 上傳依賴檔案儲存基礎設施 → 排除 P0(自成 P1)。migration 0011(autonumber_counter)。核心洞見:RollupService 已完整、formula withFormulas 讀時注入範本、系統欄投影 audit 零儲存、virtual 欄(no-op buildColumn/baseQuery 排除)。M4 設計器進階 palette + 設定編輯器。api 236 + web 17 e2e(field-types.spec)綠。commit 0972cf7/d98ffa4/7d212f0(後端)+ e469aa1/ad8c9e7(前端)+ 58e6f1d(spec)。殘留:⚠️ lookup 欄位級權限 / 顯示層 QR·顏色 chip·連動過濾 / image·signature(file-storage)/ member·rich-text·reverse-query 皆 P1。≈0.45 mo | [R1/field-types-parity.md](R1/field-types-parity.md) |
| **自訂按鈕 + 簽核流程(workflow UX)** | R1·後續-1 | ✅ **SHIPPED v1.0(2026-07-25;M1–M5 + FMEA A1–A10)**|docs/27 §6 後續-1(承四大 P0 模組):落地 §4 P1「按鈕與簽核=workflow UX 面」—— **自訂按鈕動作框架**(updateSelf 更新本表 / pushTo 資料拋轉 / openUrl;確定性 allowlist + 權限 gate + 冪等 + audit,docs/22 不變量)+ **簽核 state machine**(階層順序多步 + ZEN 金額路由 + 人核准 gate + 記錄鎖 + 簽核完自動執行)。**核心洞見:簽核=DB 狀態機(pending step 由 approve 推進)不需 DBOS durable execution;ZEN 只算路由決策**(OQ-AA-1/4)。裝 GoRules ZEN(MIT in-process);DBOS/並簽/Email·SMS 動作/留言@提及 → P1。migration 0012(button_def/action_audit/approval_def/instance/step_log)。記錄鎖用全域 interceptor(guard 早於 TenantGuard 拿不到租戶)。api 250 + web 19 e2e(actions-approval.spec)綠。commit d346451/6c352aa(後端)+ a4d48cd/ead550c(前端)+ 56adb24(spec)。殘留:⚠️ 完成狀態與 onComplete 非同一 tx(冪等兜底)/ 空角色送簽檢查 / 並簽 / Email·SMS 動作 / 留言@提及 皆 P1。≈0.45 mo | [R1/actions-approval.md](R1/actions-approval.md) |
| **標籤/QR 產生器 + 列印增強** | R1·後續-2 | 🚧 **M0 APPROVED — OQ-PM-1..7 全裁定(2026-07-25,全採建議),進 M1**|docs/27 §6 後續-2(§4 P1/P2)。**範圍洞見(Ragic 證據)**:列印是三件事 —— ①標籤 maker **完全 in-app 設定**(選欄+樣式+標籤尺寸+平舖/一頁一標籤+數量參照欄,doc/40)、②友善列印**紙張/邊界/方向委派瀏覽器**(doc/149)、③合併列印/客製報表才需**上傳** .xlsx/.docx(Carbone,doc/42·138)。→ **P0 取 ①②(零新依賴、零 infra):barcode 欄 QR 渲染(複用已裝 qrcode.react)+ `label_def` 標籤產生器 + A4 平舖列印頁 + 批次 + `layout.print` 頁首頁尾/換頁**;**③範本上傳合併歸 P1,待 file-storage**(與 OQ-FTP-6 同一阻塞)。migration 0013。≈0.34 mo | [R1/print-merge.md](R1/print-merge.md) |
| 通知(通訊平台 LINE/Slack/…)+ 事件推送偏好 | P0-4b | ⬜(拆自 P0-4,與授權無耦合)| 待建 |
| Ops(觀測 / 健康檢查 / 部署硬化)| P0-4c | ⬜(拆自 P0-4)| 待建 |
| 每表單自動 API + Public Form + webhook | P0-5 | ⬜(zod-openapi;M6 deviation 於此落地)| 待建 |
| Ragic A–I 補齊(BI/報表/樞紐/mobile PWA/電子簽章基本/i18n/系統管理）| P1-I | ⬜ | 待建 |

---

## 🔵 R2 · ERP 核心 + 計算層(補「算」取代 ERP)

| 模組 | Sprint | 狀態 | 文件 |
|---|---|---|---|
| **⭐ 語意計算綁定層(自由表單 ↔ 算,自助化)** | P0-6(命門地基）| ✅ **M0 APPROVED — OQ-CBL-1..8 全採建議**(R2 design-ahead;M1–M7 待 R2 計算層啟動;與 J/K/L/N 共用「接法」)| [R2/calc-binding-layer.md](R2/calc-binding-layer.md) |
| 財會 GL / AP / AR core | P0-6 | ⬜ | 待建 |
| 進銷 K + 生產 L basics | P0-7 | ⬜ | 待建 |
| 台灣電子發票 + 批號追蹤 | P0-8 | ⬜ | 待建 |
| 計算層(過帳期結 / 成本 / 估值 / MRP / FX;docs/18)| P0-6~ | ⬜ | 待建 |
| Q 多 ERP 對帳 bridge | P1-A | ⬜ | 待建 |
| ERP 進階(J/K/L+N/P)+ HR 完整 + 合規電子簽章 TWCA | P1-B~F | ⬜ | 待建 |

---

## 🟣 R3 · MES 現場 + ISO 品保(完整 MVP)

| 模組 | Sprint | 狀態 | 文件 |
|---|---|---|---|
| MES 現場 UI + Cloud/Edge Gateway + OEE/Andon | P0-9(T)+P1-G | ⬜ | 待建 |
| ISO 通用工具(文管/稽核/NCR/CAPA/客訴/供應商評鑑)| P0-9(U)+P1-H | ⬜ | 待建 |

---

## 🟠 R4 · 對標 + AI 智慧營運(持續演進)

| 模組 | Sprint | 狀態 | 文件 |
|---|---|---|---|
| 財會 / 生產 / 品質對標(Multi-book / MRP II / SPC / 進階 WMS 等)| Phase 4 | ⬜ | 待建 |
| AI 進階(Copilot / 智慧對帳 / 需求預測 / 異常偵測)| Phase 4 | ⬜ | 待建 |
| HR/CRM 對標 · 完整行動 App · 訂閱計費 | Phase 4 | ⬜ | 待建 |

---

## 下一步候選(依 docs/13 dependency)

> **✅ Gate P0-1 + P0-2 達成**(form-engine-core + form-designer-ui + grid-and-excel-import 皆 SHIPPED):瀏覽器可建表/加欄/填單/子表/檢視 + Excel-like 網格改格 + xlsx 推斷建表灌資料,引擎生成真實資料表 + RLS 隔離。

1. **F-2 Auth**|Better Auth + JWT + nestjs-cls;三模組對外上線硬前提(治 dev tenant header 殘留)
2. **P0-4 三層權限 + 通知 + Ops**|三層權限(表單/欄位/記錄)+ 通訊平台通知 + 監控
3. **P0-5 每表單自動 API + Public Form + webhook**;**P1-I Ragic A–I 補齊**(BI/報表/樞紐/mobile PWA/i18n)
