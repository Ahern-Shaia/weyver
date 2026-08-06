import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/* 🔴 R1 剩餘量清單(`docs/32`)的**保鮮期**檢查。

   ## 為什麼需要它

   2026-08-06:`docs/32` 標日期 08-05,其後一天內落了 14 個 feat/fix commit,
   於是四處寫著「未起」的東西早就出貨了 —— 包括被那份文件**自己**標為
   「R1 剩餘量最大的單一列」的凍結欄 / 填滿把手。
   差一點就照著錯的清單挑下一件事做。

   本 repo 第五次踩「待辦早就做完了」。前四次的補法都是「人再對一次」,
   而這次補的是檢查 —— 因為前四次證明了人不會記得。

   ## 為什麼是「額度」不是「每次 commit 都要更新」

   清單是**判斷用的**不是**記帳用的**:落一個 commit 就逼人改一次清單,
   只會讓人隨手改日期敷衍過去,那比沒有檢查更糟(看起來新鮮但內容沒對過)。

   額度訂在能讓人「一個工作段落回頭對一次」的量級。
   超過就紅,而紅的當下要做的是**真的逐段對一次**,不是改日期。

   ## 這支檢查不到什麼(誠實記)

   它盯的是**新鮮度不是正確性** —— 剛更新過的清單一樣可以寫錯。
   它只保證「不會在無人察覺的情況下慢慢過期」,那正是已經發生過五次的失敗形狀。 */

const ROOT = join(import.meta.dirname, "../../..")

/* 額度。訂 12 是因為 08-05 → 08-06 那次漂移是 14 個 —— 要能抓到那一次。 */
const COMMIT_BUDGET = 12

function git(...args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: ROOT, encoding: "utf8" }).trim()
}

describe("docs/32 R1 剩餘量清單的保鮮期", () => {
  it("🔴 距上次清點,產品程式碼的 commit 數不超過額度", () => {
    const lastTouched = git("log", "-1", "--format=%H", "--", "docs/32-系統功能清單.md")
    expect(lastTouched, "docs/32 應在 git 歷史中").not.toBe("")

    /* 只數**產品程式碼**。docs 與測試的 commit 不會讓清單過期 ——
       讓它們計數的話,修這份清單本身就會消耗自己的額度。 */
    const since = git(
      "log",
      `${lastTouched}..HEAD`,
      "--format=%h %s",
      "--",
      "apps/api/src",
      "apps/web/src",
      "packages",
    )
      .split("\n")
      .filter((l) => l !== "")

    expect(
      since.length,
      [
        `docs/32 自上次更新後已落 ${String(since.length)} 個產品 commit(額度 ${String(COMMIT_BUDGET)}):`,
        ...since.map((l) => `  ${l}`),
        "",
        "🔴 請**逐段對一次**再更新 docs/32 與 docs/25 的覆蓋率彙總。",
        "只改日期不算 —— 已經發生過的失敗正是「清單看起來新鮮但內容沒對過」。",
      ].join("\n"),
    ).toBeLessThanOrEqual(COMMIT_BUDGET)
  })

  /* 🔴 守衛的守衛:上面那條在「git 指令回空字串」時會**空過**。
     本 repo 已經有過否定斷言空過的紀錄,不重蹈。 */
  it("git 查詢本身是有效的(否則上一條會靜默空過)", () => {
    expect(git("log", "-1", "--format=%H")).toMatch(/^[0-9a-f]{40}$/)
    expect(readFileSync(join(ROOT, "docs/32-系統功能清單.md"), "utf8")).toContain("R1 剩餘工程量")
  })
})
