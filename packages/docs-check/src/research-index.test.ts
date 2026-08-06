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

/* 🔴 2026-08-06|**研究強度誤判三份 doc 的回歸測試。**

   舊版的 `depth()` 只認〈站在巨人的肩膀〉標題 + 「逐字」字數,於是把三份
   **研究做得最紮實的基礎設施模組**判成「—」(看起來像完全沒做研究):

   | doc | 實際有的 |
   |---|---|
   | `foundation/auth` | OWASP 三份 cheat sheet + GitHub Advisory DB + 讀 better-auth dist 原始碼,**查出並修掉三個 P0 資安漏洞** |
   | `foundation/framework-upgrade` | `## 0. 深度研究 — 業界實證`,34 個出處連結 |
   | `foundation/malware-scanning` | `## 0. 深度研究`,19 個出處連結 |

   根因:代理指標只認一種**格式**,而研究可以記在別的標題底下。
   ⚠️ 順帶記一個更上層的教訓 —— 那天同一個形狀犯了三次
   (CI 的關聯檢查、FMEA 的「改欄位名」、這一個):
   **做了代理指標,然後把代理的輸出當答案報出去。** */
describe("研究強度不得再誤判基礎設施模組", () => {
  const mods = collectResearch(ROOT)
  const find = (p: string) => mods.find((m) => m.path === p)

  it.each([
    "foundation/auth.md",
    "foundation/framework-upgrade.md",
    "foundation/malware-scanning.md",
  ])("%s 有一手依據", (path) => {
    const m = find(path)
    expect(m, `${path} 應該在模組清單裡`).toBeDefined()
    /* 🔴 斷言的是**訊號本身**不是分級字串 —— 分級的門檻日後可能調,
       但「這三份有留下可回查的出處」這件事不會變。 */
    expect(m?.sourceLinks, `${path} 的出處連結數`).toBeGreaterThanOrEqual(8)
    expect(
      (m?.hasGiantsSection ?? false) || (m?.hasEvidenceSection ?? false),
      `${path} 應該被認出有證據段`,
    ).toBe(true)
  })

  /* 守衛的守衛:上面三條在「collectResearch 回空陣列」時會全部因為
     `toBeDefined()` 而紅 —— 但若 find 改壞成永遠回一個假物件就會空過。 */
  it("collectResearch 真的掃得到東西", () => {
    expect(mods.length).toBeGreaterThan(30)
    expect(mods.some((m) => m.sourceLinks > 0)).toBe(true)
  })
})
