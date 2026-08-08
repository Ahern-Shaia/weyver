import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/* R1·UX-1 M10|**字級白名單 CI 檢查**(OQ-13=A ②)。

   §2.7 的診斷:間距守得住是因為有節奏可循,**色與字級失守是因為從未進 CI**。
   M10 把 **17 種字級 551 處**收斂為 **6 階**;沒有這道檢查,它會再次漂移回去
   ——「這裡小一點點」每次都很合理,累積起來就是 17 種。

   階梯依 docs/14 v5.0 §2.5(地板 12px = Carbon caption-01 / Fluent Caption1)。 */

const ALLOWED = new Set([12, 13, 14, 16, 20, 24])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue
      walk(p, out)
    } else if (p.endsWith(".tsx") || p.endsWith(".ts") || p.endsWith(".css")) {
      out.push(p)
    }
  }
  return out
}

interface Offender {
  readonly file: string
  readonly size: string
  readonly line: number
}

/* 只看程式碼不看註解 —— 註解裡引用被否決的舊值來說明「為什麼不能這樣寫」是合理的
   (本檔自己就有一段引用 `12.5px`,加上這道檢查的第一次執行就被自己抓到)。
   與 `color-literal.test.ts` 同機制。行號以**原始檔**為準,故用等長空白替換而非刪除。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function scan(root: string): Offender[] {
  const bad: Offender[] = []
  for (const file of walk(root)) {
    const lines = stripComments(readFileSync(file, "utf-8")).split("\n")
    lines.forEach((ln, i) => {
      /* 兩種寫法都要看:Tailwind 的 `text-[Npx]`,與 CSS 的 `font-size: Npx`。
         🔴 只看前者的話,`globals.css` 的 `font-size: 12.5px` 可以躺整整一版沒人發現
         —— 事實上它就是這樣躺過來的(docs/14 §0.4(d))。 */
      for (const m of ln.matchAll(/text-\[([0-9.]+)px\]|font-size:\s*([0-9.]+)px/g)) {
        const raw = m[1] ?? m[2]
        if (raw === undefined) continue
        if (!ALLOWED.has(Number(raw))) {
          bad.push({ file: file.replace(process.cwd(), ""), size: raw, line: i + 1 })
        }
      }
    })
  }
  return bad
}

/* 🔴 2026-08-08|`text-*` 命名空間的撞名檢查。

   Tailwind 的 `text-*` **同時服務顏色與字級** —— 若 `--text-X` 與 `--color-X` 同名,
   顏色會贏,於是 `.text-X` 變成 `{ color: … }`:**字級沒生效、連顏色都被改掉,而且不報錯**。

   這不是假想:本檔的標籤軌第一版取名 `--text-label`,而本庫已有 `--color-label`,
   結果 8 個徽章同時掉了字級與顏色。**是去查產生的 CSS 規則才發現的** ——
   `getComputedStyle` 探針因 Tailwind JIT 只掃原始碼而給了假陰性。 */
describe("text-* 命名空間撞名", () => {
  it("--text-X 不得與 --color-X 同名", () => {
    const css = readFileSync(
      resolve(process.cwd(), "../../packages/ui/src/styles/tokens.css"),
      "utf-8",
    )
    const names = (prefix: string): Set<string> =>
      new Set(
        [...css.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+):`, "g"))].map((m) => m[1] ?? ""),
      )
    const colors = names("color")
    const clash = [...names("text")].filter((n) => colors.has(n))
    expect(clash, "這些名字同時是顏色與字級 —— 顏色會贏,字級靜默失效").toEqual([])
  })
})

describe("字階白名單(docs/14 v5.0 §2.5)", () => {
  it("只允許 12 / 13 / 14 / 16 / 20 / 24px —— 地板 12px", () => {
    const offenders = [
      ...scan(resolve(process.cwd(), "src")),
      ...scan(resolve(process.cwd(), "../../packages/ui/src")),
    ]
    expect(
      offenders,
      `以下字級不在階梯內(密度應靠間距回收,不得靠縮字):\n${offenders
        .map((o) => `  ${o.file}:${String(o.line)}  text-[${o.size}px]`)
        .join("\n")}`,
    ).toEqual([])
  })

  /* 🔴 禁「又縮小又調淡」——`ink-disabled` 僅 2.52:1,配上最小字級即雙重不可讀。
     M9 已把 223 處資訊性用途併入 `ink-3`;此測試防止它回流。 */
  it("最小兩階(12 / 13px)不得搭配 ink-disabled", () => {
    const bad: string[] = []
    for (const file of [
      ...walk(resolve(process.cwd(), "src")),
      ...walk(resolve(process.cwd(), "../../packages/ui/src")),
    ]) {
      readFileSync(file, "utf-8")
        .split("\n")
        .forEach((ln, i) => {
          if (/text-\[1[23]px\]/.test(ln) && /text-ink-disabled/.test(ln)) {
            bad.push(`${file.replace(process.cwd(), "")}:${String(i + 1)}`)
          }
        })
    }
    expect(bad, `以下同時使用最小字級與停用色:\n${bad.join("\n")}`).toEqual([])
  })
})

/* 🔴 2026-08-08 M3|**停用態單一值**。

   收斂前實測:同一個「不能用」在畫面上有 **六種**深淺 ——
   30% / 40% / 45% / 50% / 60% / **完全沒有**(共用 `Input`),散在 37 處。
   使用者無從學會「這個灰代表不能點」。

   ⚠️ **v3 不是這條的出處** —— 全檔 `disabled` 出現 0 次、invalid 0 次
   (hover 有 56 條、focus 8 條)。v3 畫的是「可以做什麼」,沒畫「不能做什麼」,
   所以這是我方裁定,值收在 `--opacity-disabled`。

   ⚠️ 第一次 sweep 只掃 `packages/ui` 與 `apps/web/src/components`,
   漏掉 31 處在 `app/` 路由底下的呼叫端 —— **cross-cutting 要整片掃**。 */
describe("停用態不得硬寫透明度", () => {
  it("一律用 opacity-disabled,禁 disabled:opacity-<數字>", () => {
    const bad: string[] = []
    for (const file of [
      ...walk(resolve(process.cwd(), "src")),
      ...walk(resolve(process.cwd(), "../../packages/ui/src")),
    ]) {
      readFileSync(file, "utf-8")
        .split("\n")
        .forEach((ln, i) => {
          if (/disabled\]?:opacity-\d/.test(ln)) {
            bad.push(`${file.replace(process.cwd(), "")}:${String(i + 1)}`)
          }
        })
    }
    expect(bad, `改用 opacity-disabled:\n${bad.join("\n")}`).toEqual([])
  })
})
