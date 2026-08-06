import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { type ModuleResearch, collectResearch } from "./research-index"

/* 🔴 **每個出貨的功能都要有可回查的研究。** 這條規則從此由機器把關。

   ## 為什麼是檢查不是承諾

   `_template.md` 早就逐字要求「研究即寫入 doc」「附**可點擊的來源連結**」,
   而這個 repo 已經為「規則寫了沒檢查就會漏」付過**六次**代價。
   2026-08-06 起 CI 會跑這一支。

   ## 🔴 判準是**格式**,不是「有沒有研究」

   「有沒有做研究」機器偵測不出來 —— 同一天誤判了四次:

   | 誤判 | 實際 |
   |---|---|
   | `foundation/auth` 顯示「—」 | OWASP 三份 cheat sheet + 讀 better-auth 原始碼,**修掉三個 P0 資安漏洞** |
   | `foundation/framework-upgrade` | `## 0. 深度研究`,34 個連結 |
   | `foundation/malware-scanning` | `## 0. 深度研究`,19 個連結 |
   | `R1/authz-resource-inheritance` | **§10-bis** 對照 Notion / Salesforce / Drive 餵給 OQ 裁定,只是沒放 URL |

   根因:研究可以寫在任何標題底下,而品質與連結數也不是線性相關。
   繼續加偵測規則只會繼續產生假陰性。

   **所以這支檢查的是「有沒有照 `_template.md` 的格式留下可回查的東西」** ——
   標準證據段(`## 0.` / `## 0-bis.` / `## 0-ter.`,或〈站在巨人的肩膀〉)
   + 出處連結或逐字引用。不合格**不代表沒做研究**,代表**別人查不到**。

   ## 為什麼是棘輪不是硬門檻

   目前 46 份已出貨的 doc 有 14 份不合格。一次要求全部補齊 = CI 第一天就紅,
   而紅了沒人修的 CI 等於沒有 CI(同 `ci.yml` 對 lint / audit 的處置)。

   棘輪保證的正是使用者要的那件事:**往後每一個功能都要有**。
   數字只能往下,補一份就把 BASELINE 減一。 */

const ROOT = join(import.meta.dirname, "../../..")

/* 🔴 只能往下調。往上調 = 這條規則失效,審 PR 的人看到 +1 就該擋下來。 */
const BASELINE = 12

function meetsBar(m: ModuleResearch): boolean {
  const hasSection = m.hasGiantsSection || m.hasEvidenceSection
  const hasCitations = m.sourceLinks >= 10 || m.verbatim >= 5
  return hasSection && hasCitations
}

describe("出貨的功能都要有可回查的研究", () => {
  const shipped = collectResearch(ROOT).filter((m) => m.shipped)
  const weak = shipped.filter((m) => !meetsBar(m))

  it(`🔴 不合格的已出貨模組不得超過 ${String(BASELINE)} 份(只能往下)`, () => {
    expect(
      weak.length,
      [
        `不合格 ${String(weak.length)} 份(基準 ${String(BASELINE)}):`,
        ...weak
          .slice()
          .sort((a, b) => b.sourceLinks - a.sourceLinks)
          .map(
            (m) =>
              `  連結 ${String(m.sourceLinks).padStart(3)} · 逐字 ${String(m.verbatim).padStart(3)}` +
              ` · 證據段 ${m.hasGiantsSection || m.hasEvidenceSection ? "✓" : "✗"}  ${m.path}`,
          ),
        "",
        "🔴 **變多了就是有新功能沒留研究。** 要通過只有一條路:",
        "   在該模組 doc 補 `## 0.` 證據段 + 可點擊的來源連結(`_template.md` 的規定)。",
        "",
        "⚠️ 補完一份就把 BASELINE 減一 —— 這個數字**只能往下**。",
        "⚠️ 不合格不代表沒做研究,代表**別人查不到** ——",
        "   已知有幾份的研究寫在非標準章節(如 §10-bis)且沒放 URL。",
      ].join("\n"),
    ).toBeLessThanOrEqual(BASELINE)
  })

  /* 守衛的守衛:`collectResearch` 回空陣列時 `weak.length` 是 0,
     上面那條會**永遠通過**。本 repo 的否定斷言已經空過三次。 */
  it("掃得到已出貨模組(否則上一條恆真)", () => {
    expect(shipped.length).toBeGreaterThan(30)
    expect(shipped.some(meetsBar), "至少要有一份是合格的").toBe(true)
  })
})
