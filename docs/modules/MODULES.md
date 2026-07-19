# Weyver 模組設計文件索引

> 每個 non-trivial 模組動工前先寫 M0 design doc(骨架 `_template.md`),OQ 裁定後 APPROVED → 實作 → FMEA 收尾 SHIPPED 標 ✅。

| 模組 | Sprint | 狀態 | 文件 |
|---|---|---|---|
| 表單引擎動態 schema 核心 | P0-1 | ✅ **SHIPPED v1.0**(2026-07-19;M0–M7,59 tests,FMEA P0 全清;對外上 prod 前提 = F-2 + §12.7 可靠性 checklist)| [form-engine-core.md](form-engine-core.md) |
| 表單設計器 + 填單 接引擎 API | P0-1·UI | 🚧 **M0 DRAFT — 待裁定 OQ-FDU-1..6**(收 Gate P0-1 UI 路徑)| [form-designer-ui.md](form-designer-ui.md) |

## 下一個模組候選(依 docs/13 dependency)

| 候選 | Sprint | 說明 |
|---|---|---|
| F-2 Auth + 租戶 context | Foundation | Better Auth + JWT + nestjs-cls;§12.7 對外上線硬前提;T1/T2/T4 治本 |
| P0-2 Grid 主檢視 + Excel 建表 | Phase 1 | Glide Data Grid 接引擎 API + xlsx 匯入(Ragic 招牌 onboarding)|
| P0-3 公式引擎 + Link&Load | Phase 1 | fork Teable MIT `packages/formula` 評估(OQ-FEC-7 遞延決策)|
