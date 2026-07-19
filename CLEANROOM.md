# Clean-room / 第三方來源紀錄

> Weyver 法律紅線(AGENTS 鐵則 5)|不 clone Ragic / Odoo / NocoDB / Teable-AGPL source;**僅可 fork MIT** 授權組件,且須**逐檔驗授權 + 保留 attribution + 記錄於本檔**。

## Vendored 組件

### 1. `packages/formula/src/vendor/teable/` — ANTLR 公式 parser

| 項目 | 內容 |
|---|---|
| **來源** | `@teable/formula`(Teable monorepo `packages/formula`,develop 分支)|
| **授權** | **MIT**(`@teable/formula` package.json `license: MIT`,已驗證) |
| **上游 attribution 鏈** | 其 `Formula.g4` 文法檔標頭載明「Portions based on **Baserow** software, Copyright (c) 2019-present Baserow B.V., The MIT License」→ 授權鏈:Weyver ← Teable(MIT)← Baserow(MIT),兩者皆 MIT |
| **取用日** | 2026-07-19 |
| **取用檔案** | `parser/Formula.g4`、`parser/FormulaLexer.g4`(文法源,含原 MIT + Baserow 標頭,原樣保留)· `parser/Formula.ts`、`parser/FormulaLexer.ts`、`parser/FormulaVisitor.ts`(antlr4ts-cli 生成碼)· `parser/*.tokens`、`parser/*.interp`(ANTLR aux)· `error.listener.ts` |
| **修改** | 生成碼 `.ts` 與 `error.listener.ts` 僅在檔首加 `// @ts-nocheck` + vendored 註記(隔離出 Weyver strict TS/biome gate);**未改邏輯**。文法 `.g4` 原樣。 |
| **執行期依賴** | `antlr4ts`(MIT,npm) |
| **Weyver 自寫層** | `packages/formula/src/parse.ts`(parse 入口 + typed 錯誤)· `index.ts` · 後續之型別推斷 / 函數 registry / 依賴圖(HyperFormula 式,見 `docs/modules/R1/formula-and-linkload.md`)為 **Weyver 原創**,非 vendored |
| **合規動作** | ✅ package 級 MIT 已驗;✅ Baserow + Teable attribution 於文法標頭保留;✅ 本檔登錄;⬜ 若日後改文法 → 以 `antlr4ts-cli`(Java)由 `.g4` 重生,不手改生成碼 |

> **絕不** vendored Teable backend(AGPL)/ NocoDB(Sustainable Use)/ Ragic / Odoo source。僅限上表 MIT 組件。
