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
| **Auth + 租戶 context + RBAC**(Better Auth + JWT + nestjs-cls)| F-2 | ⬜ **對外上線硬前提**(form-engine-core FMEA §12.7:T1/T2/T4 治本)| 待建 |
| UI shell + design tokens + deploy | F-3 | ✅ 前端 v2.1(`packages/ui` + `/app`)| —(見 docs/14)|

---

## 🟢 R1 · 完整 Ragic 平台(既有客戶遷移 land)

| 模組 | Sprint | 狀態 | 文件 |
|---|---|---|---|
| **表單引擎動態 schema 核心** | P0-1 | ✅ **SHIPPED v1.0**(2026-07-19;M0–M7,59 tests,FMEA P0 全清)| [R1/form-engine-core.md](R1/form-engine-core.md) |
| **表單設計器 + 填單 接引擎 API** | P0-1·UI | ✅ **SHIPPED v1.0**(2026-07-19;M0–M5,Playwright golden path 固化;**Gate P0-1 全數達成**)| [R1/form-designer-ui.md](R1/form-designer-ui.md) |
| Grid 主檢視 + Excel 建表 onboarding | P0-2 | ✅ **SHIPPED v1.0**(2026-07-19;M0–M4;Glide 網格改格 + xlsx 推斷建表 bulk 灌資料;e2e 固化 + FMEA P0 全清)| [R1/grid-and-excel-import.md](R1/grid-and-excel-import.md) |
| 公式引擎 + Link&Load | P0-3 | ⬜ fork Teable MIT `packages/formula` 評估(OQ-FEC-7 遞延)| 待建 |
| 三層權限 + 通知(通訊平台）+ Ops | P0-4 | ⬜ | 待建 |
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
2. **P0-3 公式引擎 + Link&Load**|fork Teable MIT `packages/formula` 評估(OQ-FEC-7 遞延決策)
3. **P1-I Ragic A–I 補齊**|BI/報表/樞紐/mobile PWA/電子簽章基本/i18n/系統管理
