import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/* 🔴 研究索引的**產生器**。

   ## 要解的問題

   「我要做 X 了,先去查 Ragic 怎麼做」—— 而那份查證**可能三個月前就做過了**,
   只是躺在另一個模組的 doc 裡。這個 repo 已經有 54 份模組 doc、
   引用了數十份競品官方文件,沒有索引的話**重複查證是必然的**,
   而重複查證最貴的不是時間,是**兩次查出不同結論卻沒人發現**。

   ## 為什麼是產生的不是手寫的

   手寫的索引會漂 —— 這個 repo 已經為此付過四次代價(`docs/25` 的漏計)。
   索引的**唯一真實來源是模組 doc 本身**,所以這裡從它們掃出來,
   而 `research-index.test.ts` 斷言 committed 的檔案與重新產生的一致。
   golden file:漂移在 CI 就會紅,不必靠人記得更新。 */

export interface ModuleResearch {
  readonly path: string
  readonly title: string
  /** MODULES.md 標 SHIPPED */
  readonly shipped: boolean
  /** 有〈巨人的肩膀〉章節。⚠️ **不強制「站在」二字** ——
      `formula-and-linkload` 與 `form-engine-core` 的標題是「## 2-bis. 巨人的肩膀:…」,
      而舊 regex 要求「站在巨人的肩膀」,於是把兩份有研究的 doc 判成沒有。
      那是 2026-08-06 同型假陰性的第五次。 */
  readonly hasGiantsSection: boolean
  /** 有 `## 0.` / `## 0-bis.` 證據段(`_template.md` 規定的位置)*/
  readonly hasEvidenceSection: boolean
  /** 外部出處連結數(`https://`)。 */
  readonly sourceLinks: number
  /** 🔴 **可回查的出處總數** = 外部 URL + 自家程式碼路徑 + Ragic 文件編號。

      2026-08-06 由只數 URL 改為三者相加,理由是 `AGENTS.md`〈三站〉自己說:
      站①**自家 repo**、站②**自己的相依套件**是最常漏、也最有價值的兩站。
      只數外部 URL 的話,`server-pdf`(15 個程式碼路徑 + 4 份 Ragic doc)
      與 `field-label-a11y`(9 個程式碼路徑)會被判成「沒有可回查的出處」——
      **那等於在懲罰品質最高的那種研究,與本 repo 自己的教義矛盾。**

      「可回查」的判準是**別人能不能自己去驗**,不是「有沒有 https」:
      程式碼路徑指得到檔案,Ragic doc 編號對得到本機鏡像與官網。 */
  readonly citations: number
  /** 研究有沒有**推翻**某個決定。目前唯一信得過的「深度」訊號。 */
  readonly overturned: boolean
  /** 「逐字」出現次數 —— 一手引用的粗略強度 */
  readonly verbatim: number
  /** 引用到的 Ragic 官方文件編號 */
  readonly ragicDocs: readonly string[]
  /** 提到的其他來源(競品 / 套件 / 規範) */
  readonly otherSources: readonly string[]
  /* 🔴 明示豁免的理由。`null` = 沒有豁免。

     **不是所有模組都需要外部研究。** `subscription-billing` 的核心論據是
     「用量歷史晚做就永久失去,是唯一不可回溯的」—— 那是第一原理,
     不是 Airtable 有沒有這樣做的問題。硬要它湊十個連結就是**引用表演**,
     而表演會讓整個指標失去意義。

     🔴 **但豁免必須是明示的、有理由的、而且列得出來的**:
     格式為一行 `> **研究豁免**|理由…`,理由太短(< 20 字)不算,
     且所有豁免會列進索引 §D 供稽核。**靜默的例外才是漏洞,寫出來的不是。** */
  readonly exemptReason: string | null
}

/* 🔴 只認 Ragic 的引用形式:`doc/81` / `doc-kb/284` / `doc-user/22`。

   ⚠️ **不能寫成 `doc[-a-z]*\/`** —— 那會把我方自己的 `docs/25` / `docs/04` 也吃進去,
   於是反向索引出現「Ragic doc/25」這種**不存在的來源**,
   而照著它去查的人會找不到東西然後重查一次。
   **指向錯地方的索引比沒有索引更糟。**(第一版就是這樣,產生後看內容才發現) */
const RAGIC_DOC_PATTERN = /\bdoc(?:-[a-z]+)?\/(\d+)/g

/* ⚠️ **這是「順帶列出來給人看」的,不是判斷研究強度的依據。**

   2026-08-06 的教訓:白名單對**基礎設施模組是瞎的**。
   `foundation/auth` 對照了 OWASP 三份 cheat sheet + GitHub Advisory DB,
   還讀了 better-auth 的 dist 原始碼,查出並修掉三個 P0 資安漏洞 ——
   而它在索引裡顯示「研究強度 —」,因為它引的東西不在清單裡、
   標題也不叫〈站在巨人的肩膀〉。`malware-scanning`(ClamAV 生態,19 個連結)與
   `framework-upgrade`(22 個連結)同樣被誤判。

   **強度改由不依賴白名單的訊號決定**(見 `depth()`)。 */
/* 正規拼法清單。regex 由它產生,顯示也用它正規化 ——
   否則 `gi` 會讓同一個來源以 `OWASP` / `owasp` 兩種形式並列。 */
const SOURCE_NAMES = [
  "Airtable",
  "Baserow",
  "Teable",
  "NocoDB",
  "Metabase",
  "Salesforce",
  "Notion",
  "Odoo",
  "Smartsheet",
  "Zoho",
  "Glide Data Grid",
  "ERPNext",
  "iDempiere",
  "qcadoo",
  "ClamAV",
  "Better Auth",
  "Fastify",
  "NestJS",
  "Stripe",
  "Shopify",
  "ServiceNow",
  "SAP",
  "Kissflow",
  "OWASP",
  "ASVS",
  "W3C",
  "ARIA APG",
  "EDPB",
  "GDPR",
] as const

const CANONICAL = new Map<string, string>(SOURCE_NAMES.map((n) => [n.toLowerCase(), n]))

const OTHER_SOURCE_PATTERN = new RegExp(`\\b(${SOURCE_NAMES.join("|")}|CVE-\\d{4}-\\d+)\\b`, "gi")

/* 大小寫不同的同一個來源收斂成一個;CVE 一律大寫。 */
function canonicalSources(raw: readonly string[]): string[] {
  const out = new Set<string>()
  for (const r of raw) out.add(CANONICAL.get(r.toLowerCase()) ?? r.toUpperCase())
  return [...out].sort()
}
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith(".md")) out.push(full)
  }
  return out
}

/* 一行 `> **研究豁免**|<理由>`。理由太短視為沒寫 —— 「不需要」三個字不算理由。 */
const EXEMPT_MIN_REASON = 20

export function parseExemption(text: string): string | null {
  const m = /^>?\s*\*\*研究豁免\*\*[|｜]\s*(.+)$/m.exec(text)
  const reason = m?.[1]?.trim() ?? ""
  return reason.length >= EXEMPT_MIN_REASON ? reason : null
}

function titleOf(text: string, fallback: string): string {
  const m = /^#\s+(.+)$/m.exec(text)
  if (m?.[1] === undefined) return fallback
  /* 檔頭通常是 `xxx.md — [R1·A-1] 名稱 設計文件`,取破折號之後的部分 */
  const after = m[1].split(/\s—\s|\s--\s/)[1]
  return (after ?? m[1]).replace(/\s*設計文件\s*$/, "").trim()
}

export function collectResearch(root: string): ModuleResearch[] {
  const modulesDir = join(root, "docs/modules")
  const shippedNames = new Set(
    readFileSync(join(modulesDir, "MODULES.md"), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("| ") && l.includes("SHIPPED"))
      .flatMap((l) => [...l.matchAll(/\(([^)]+\.md)\)/g)].map((m) => m[1] ?? "")),
  )

  const out: ModuleResearch[] = []
  for (const file of walk(modulesDir)) {
    const rel = relative(modulesDir, file).replace(/\\/g, "/")
    if (rel === "MODULES.md" || rel === "_template.md" || rel.startsWith("_research-index"))
      continue
    const text = readFileSync(file, "utf8")
    out.push({
      path: rel,
      title: titleOf(text, rel),
      shipped: shippedNames.has(rel),
      hasGiantsSection: /巨人的肩膀/.test(text),
      /* 🔴 證據段的**編號不固定**。這個 repo 至少用過四種寫法:
         `## 0. 證據` · `## 0-bis. 追溯稽核` · `## 2-bis. 巨人的肩膀` ·
         `## 10-bis. 向上設計研究證據`。

         舊 regex 只認 `## 0.`,於是把 `authz-resource-inheritance`
         (§10-bis 對照 Notion / Salesforce / Drive 餵給 OQ 裁定)判成沒有證據段
         —— **那是同型假陰性的第六次**。

         改為**聯集**:`## 0.` 開頭(不論標題)**或**任何 `##` 標題含證據類關鍵詞。
         ⚠️ 第一版只寫了後半,結果 `data-export`(標題是 `## 0.` 但不含關鍵詞)
         反而從通過變成不通過 —— **「放寬」在另一個維度變窄了**。
         改動判準時要兩個方向都量,不能只看想修的那幾份。
         寧可寬一點 —— 這支是導航訊號,漏判的代價(把做過研究的判成沒做)
         比誤判的代價(把沒做的判成做過)高得多,因為前者會讓人重做一次研究。 */
      hasEvidenceSection:
        /^##\s+0(-bis|-ter)?\./m.test(text) ||
        /^##\s+[^\n]*(證據|研究|巨人的肩膀|業界對照|競品對照|追溯稽核)/m.test(text),
      sourceLinks: (text.match(/https:\/\//g) ?? []).length,
      citations:
        (text.match(/https:\/\//g) ?? []).length +
        (text.match(/`[a-z0-9@/._-]+\.(ts|tsx|sql|json|html)[`:]/gi) ?? []).length +
        new Set(text.match(/\bdoc(?:-[a-z]+)?\/\d+/g) ?? []).size,
      overturned: /推翻|自我更正|自我修正|改判/.test(text),
      verbatim: (text.match(/逐字/g) ?? []).length,
      ragicDocs: [...new Set([...text.matchAll(RAGIC_DOC_PATTERN)].map((m) => m[1] ?? ""))].sort(
        (a, b) => Number(a) - Number(b),
      ),
      otherSources: canonicalSources(text.match(OTHER_SOURCE_PATTERN) ?? []),
      exemptReason: parseExemption(text),
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/* 「哪一份 Ragic 官方文件已經被誰讀過」—— 這是本索引價值最高的一半。
   要查 `doc/81` 之前先看這裡,若已有人逐字抄過就不必重讀。 */
export function reverseIndex(mods: readonly ModuleResearch[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const m of mods) {
    for (const d of m.ragicDocs) {
      const list = out.get(d) ?? []
      list.push(m.path)
      out.set(d, list)
    }
  }
  return new Map([...out].sort((a, b) => Number(a[0]) - Number(b[0])))
}

/* 🔴 研究強度。**2026-08-06 重寫** —— 舊版只認一種格式而誤判了三份 doc。

   舊版靠〈站在巨人的肩膀〉標題 + 「逐字」字數,於是:
   `foundation/auth` 的研究記在 `0-bis 追溯稽核` 底下(OWASP 三份 cheat sheet +
   GitHub Advisory DB + 讀 better-auth dist 原始碼,**查出並修掉三個 P0 資安漏洞**)
   → 顯示「—」,看起來像完全沒做研究。`malware-scanning` / `framework-upgrade` 同理。

   新版改用**不依賴標題格式、也不依賴白名單**的訊號:

   1. **出處連結數** —— `_template.md` 逐字要求「附可點擊的來源連結」,
      它本來就是規範,而且是「研究有沒有留下可回查的東西」的直接量測
   2. **有沒有證據段**(`## 0.` / `## 0-bis.` / `## 0-ter.`,或〈站在巨人的肩膀〉)
   3. 🔴 **有沒有推翻過什麼** —— 目前唯一信得過的「深度」訊號。
      深度研究會改變結論;`event-triggers` 出貨當下什麼都沒推翻,那正是它露餡的地方

   ⚠️ 仍然是**導航訊號不是評分**。⭐⭐ 只代表「留下的東西夠多、可以先信」,
   承重之前一樣要看該 doc 內記的查證日期。 */
function depth(m: ModuleResearch): string {
  const anchored = m.hasGiantsSection || m.hasEvidenceSection
  if (anchored && m.citations >= 10 && m.overturned) return "⭐⭐ 深且推翻過"
  if (anchored && (m.citations >= 8 || m.verbatim >= 5)) return "⭐ 有一手依據"
  if (m.citations > 0) return "· 零星引用"
  return "—"
}

/* A / B 分段的判準。與 `depth()` 同源,避免兩份標準漂移。 */
function isWellResearched(m: ModuleResearch): boolean {
  return depth(m).startsWith("⭐")
}

export function renderIndex(mods: readonly ModuleResearch[]): string {
  const rev = reverseIndex(mods)
  const lines: string[] = []
  lines.push("# 研究索引(**本檔為產生檔,勿手改**)")
  lines.push("")
  lines.push(
    "> 由 `packages/docs-check/src/research-index.ts` 從模組 doc 掃出來,",
    "> `research-index.test.ts` 斷言它與重新產生的一致 —— **漂移在 CI 就會紅**。",
    "> 要改內容請改**模組 doc**,不要改這一份。",
    "",
    "## 這份索引要解的問題",
    "",
    "「我要做 X 了,先去查 Ragic 怎麼做」—— 而那份查證**可能三個月前就做過了**,",
    "只是躺在另一個模組的 doc 裡。重複查證最貴的不是時間,",
    "是**兩次查出不同結論卻沒人發現**。",
    "",
    "⚠️ 研究強度是**導航訊號不是評分**:⭐⭐ 可直接信;· 零星引用者仍須自己複核。",
    "⚠️ **競品的功能會變**。索引只告訴你「誰查過」,不保證「現在仍然如此」——",
    "承重的斷言仍須看該 doc 內記的**查證日期**。",
    "",
  )

  lines.push("## A. 已出貨且研究齊全的模組(**別重查**)")
  lines.push("")
  lines.push("| 模組 | 研究強度 | 可回查出處 | 逐字 | Ragic doc | 其他來源 | 文件 |")
  lines.push("|---|---|---|---|---|---|---|")
  for (const m of mods.filter((x) => x.shipped && isWellResearched(x))) {
    lines.push(
      `| ${m.title} | ${depth(m)} | ${String(m.citations)} | ${String(m.verbatim)} | ${m.ragicDocs.map((d) => `\`${d}\``).join(" ") || "—"} | ${m.otherSources.join(" · ") || "—"} | [${m.path}](${m.path}) |`,
    )
  }
  lines.push("")

  lines.push("## B. 其餘模組(引用較零星,承重前請自行複核)")
  lines.push("")
  lines.push("| 模組 | 已出貨 | 研究強度 | 可回查出處 | Ragic doc | 文件 |")
  lines.push("|---|---|---|---|---|---|")
  for (const m of mods.filter((x) => !(x.shipped && isWellResearched(x)))) {
    lines.push(
      `| ${m.title} | ${m.shipped ? "✅" : "—"} | ${depth(m)} | ${String(m.citations)} | ${m.ragicDocs.map((d) => `\`${d}\``).join(" ") || "—"} | [${m.path}](${m.path}) |`,
    )
  }
  lines.push("")

  const exempt = mods.filter((m) => m.exemptReason !== null)
  if (exempt.length > 0) {
    lines.push("## D. 明示豁免外部研究的模組(**逐條列出供稽核**)")
    lines.push("")
    lines.push(
      "🔴 **不是所有模組都需要外部研究。** 但豁免必須是**明示的、有理由的、列得出來的** ——",
      "靜默的例外才是漏洞,寫出來的不是。要質疑某一條豁免,直接看它的理由。",
      "",
      "| 模組 | 豁免理由 | 文件 |",
      "|---|---|---|",
    )
    for (const m of exempt) {
      lines.push(`| ${m.title} | ${m.exemptReason ?? ""} | [${m.path}](${m.path}) |`)
    }
    lines.push("")
  }

  lines.push("## C. 反向索引|哪一份 Ragic 官方文件已經被讀過")
  lines.push("")
  lines.push("**要查某一份文件之前先看這裡。** 已有人逐字抄過就不必重讀。")
  lines.push("")
  lines.push("| Ragic doc | 已被這些模組引用 |")
  lines.push("|---|---|")
  for (const [doc, paths] of rev) {
    lines.push(`| \`doc/${doc}\` | ${paths.map((p) => `[${p}](${p})`).join(" · ")} |`)
  }
  lines.push("")
  return lines.join("\n")
}
