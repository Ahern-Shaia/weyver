import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { collectResearch, renderIndex } from "./research-index"

/* 🔴 研究索引的 golden 檔檢查。

   索引**手寫必漂** —— 這個 repo 已經為同一件事付過四次代價(`docs/25` 的漏計)。
   故它是產生的,而這裡斷言 committed 的檔案與重新產生的一致。

   ⚠️ 這一條紅的時候**不要改索引**,那是產生物。
   它紅代表模組 doc 變了(新增模組 / 補了引用 / 出貨狀態改變)——
   跑 `UPDATE_RESEARCH_INDEX=1 pnpm -C packages/docs-check test` 重新產生。 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const INDEX = join(ROOT, "docs/modules/_research-index.md")

describe("研究索引", () => {
  it("掃得出足夠多的模組(掃描壞掉時這支會靜默通過)", () => {
    /* 守衛的守衛:若 walk 壞掉回空陣列,下面那條「內容一致」會拿空對空而過 */
    expect(collectResearch(ROOT).length).toBeGreaterThan(30)
  })

  it("🔴 索引與模組 doc 一致(產生檔,勿手改)", () => {
    const expected = renderIndex(collectResearch(ROOT))
    if (process.env.UPDATE_RESEARCH_INDEX === "1") {
      writeFileSync(INDEX, expected)
    }
    const actual = readFileSync(INDEX, "utf8")
    expect(
      actual,
      "模組 doc 變了但索引沒重新產生。跑 `UPDATE_RESEARCH_INDEX=1 pnpm -C packages/docs-check test`",
    ).toBe(expected)
  })
})
