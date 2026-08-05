import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/* 🔴 出貨了但沒記帳 —— 這個 repo 已經發生四次。

   ## 為什麼是檢查而不是再寫一次規則

   `docs/modules/MODULES.md` 開頭**早就寫著**:
   「**[P0] 收尾必回填 `docs/25`**|模組 SHIPPED 時…**必須**同步更新對應子功能列」。
   規則在那裡,而它照樣漂了四次:

   | # | 漂移 | 後果 |
   |---|---|---|
   | 1 | 表單範本庫已出貨,對照列仍 ⬜ | 覆蓋率低報 |
   | 2 | audit-E 那批五項 parity 面沒進表 | 同上 |
   | 3 | H 段九列裡**七列**早就出貨 | H 記 24%,實為 50% |
   | 4 | **R1·A-1 設定中心**(2026-08-01 SHIPPED)在 docs/25 完全沒出現 | 兩列 ⬜ 掛了四天 |

   第 4 次不是靠人品發現的,是**寫這支檢查時量出來的**。
   `pitfall_rule_without_check_always_drifts` 的第十次 —— 這次不再只補規則。

   ## 危害不是數字不準

   2026-08-05 差點在錯的數字上開工(本來要挑「H 只有 24%,先補這段」),
   是動手前逐列對碼才發現的。**在錯的數字上開工比不開工更糟** ——
   它會把時間花在已經做完的事情上,而真正的缺口繼續看不見。

   ## 這支檢查斷言什麼(以及斷言不了什麼)

   ✅ 能抓:**SHIPPED 的模組,而 `docs/25` 從頭到尾沒提過它**(漂移 1/2/4 的形狀)。
   ❌ 抓不到:模組被提過了,但某幾列該翻的 ⬜ 沒翻(漂移 3 的形狀)——
      那需要判斷「這一列的功能算不算做完」,沒有機器能代答。
      對策是流程面的:**選定一段動工前,先重驗那一段**(見 §1 每段的校對日期)。

   誠實記下涵蓋範圍,比假裝這支檢查什麼都擋得住有用。 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const modules = readFileSync(join(ROOT, "docs/modules/MODULES.md"), "utf8")
const parity = readFileSync(join(ROOT, "docs/25-功能完整對照清單.md"), "utf8")

/* 沒有 parity 面的模組。**每一條都要寫得出理由** ——
   豁免清單是這支檢查唯一能被繞過的地方,它一旦變成垃圾桶就等於沒有檢查。 */
const EXEMPT: Record<string, string> = {
  /* 目前是空的 —— 而這正是想要的狀態。
     豁免要在**真的遇到沒有 parity 面的模組**時才加,不是先鋪好位子等人來填。
     (初稿曾預先塞三條,結果全被「豁免清單裡的模組都還存在」那條打掉:
      F-1 / F-3 的狀態欄根本不含 `SHIPPED`,壓根沒進集合。) */
}

type ModuleRow = { name: string; sprint: string; doc: string }

function shippedModules(): ModuleRow[] {
  const out: ModuleRow[] = []
  for (const line of modules.split("\n")) {
    if (!line.startsWith("| ") || line.split("|").length < 5) continue
    const cells = line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim())
    const [rawName, rawSprint, status] = cells
    /* 🔴 狀態欄的**內文本身含 `|`**(它拿全形直線當分隔),所以 `cells[3]` 不是
       文件連結欄。取最後一格才對 —— 這個 off-by-one 讓 `doc` 對多數模組是空字串,
       檢查於是只靠 sprint 代號比對而看起來「差不多能動」。 */
    const rawDoc = cells[cells.length - 1]
    if (rawName === undefined || rawSprint === undefined || status === undefined) continue
    /* 🔴 只認 `SHIPPED`。單看 ✅ 會把「✅ M0 APPROVED」當成出貨 ——
       寫這支檢查時就誤報了一個(R2 的語意計算綁定層,設計核准但一行都還沒寫)。
       **誤報會訓練人忽略檢查**,比漏報更快讓一道守衛失效。 */
    if (!status.includes("SHIPPED")) continue
    const doc = /\(([^)]+\.md)\)/.exec(rawDoc ?? "")?.[1] ?? ""
    out.push({
      name: rawName.replace(/\*\*/g, "").trim(),
      sprint: rawSprint.replace(/\*\*/g, "").trim(),
      /* design doc 的檔名是**機器產生、唯一、穩定**的鍵。
         sprint 代號兩邊會用不同寫法(MODULES 寫 `P0-2 殘留`、docs/25 寫 `R1·GP`),
         檔名不會。 */
      doc: doc.split("/").pop()?.replace(/\.md$/, "") ?? "",
    })
  }
  return out
}

describe("出貨了就要記帳", () => {
  it("MODULES.md 解析得出足夠多的 SHIPPED 模組(解析壞掉時這支檢查會靜默失效)", () => {
    /* 🔴 沒有這一條的話,一個把表格改成別種寫法的 commit 會讓下面那條
       「零違規」永遠成立 —— 而看起來一切正常。守衛自己也要有守衛。 */
    expect(shippedModules().length).toBeGreaterThan(30)
  })

  it("🔴 每個 SHIPPED 的模組都要在 docs/25 留下痕跡", () => {
    const missing = shippedModules()
      .filter((m) => EXEMPT[m.sprint] === undefined)
      .filter((m) => {
        /* sprint 代號或 design doc 檔名,任一出現即算記過帳。
           兩個都沒有 = docs/25 從頭到尾沒聽說過這個模組。 */
        /* 🔴 檔名太短就不當鍵。`auth` / `mfa` / `authz` 這種四五個字母的詞
           會在幾萬字的清單裡意外命中,於是檢查對那些模組永遠是綠的。
           短名模組靠 sprint 代號 —— 它本來就夠獨特。 */
        const keys = [m.sprint, m.sprint.split("·").pop() ?? "", m.doc.length >= 6 ? m.doc : ""]
          .map((k) => k.trim())
          .filter((k) => k.length > 1)
        return !keys.some((k) => parity.includes(k))
      })
      .map((m) => `${m.sprint}(${m.doc || m.name})`)

    expect(
      missing,
      "這些模組已 SHIPPED,但 docs/25 完全沒提到 —— 覆蓋率必然低報。\n" +
        "把 sprint 代號或 design doc 檔名寫進對應的子功能列;真的沒有 parity 面就加進 EXEMPT 並寫明理由。",
    ).toEqual([])
  })

  it("豁免清單裡的模組都還存在(留著過期的豁免等於留一個洞)", () => {
    const known = new Set(shippedModules().map((m) => m.sprint))
    const stale = Object.keys(EXEMPT).filter((sprint) => !known.has(sprint))
    expect(stale, "這些 sprint 代號已不在 MODULES.md 的 SHIPPED 列中,豁免該移除").toEqual([])
  })
})
