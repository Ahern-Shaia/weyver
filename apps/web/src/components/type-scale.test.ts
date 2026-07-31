import { readdirSync, readFileSync, statSync } from "node:fs"
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
    } else if (p.endsWith(".tsx") || p.endsWith(".ts")) {
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

function scan(root: string): Offender[] {
  const bad: Offender[] = []
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf-8").split("\n")
    lines.forEach((ln, i) => {
      for (const m of ln.matchAll(/text-\[([0-9.]+)px\]/g)) {
        const raw = m[1]
        if (raw === undefined) continue
        if (!ALLOWED.has(Number(raw))) {
          bad.push({ file: file.replace(process.cwd(), ""), size: raw, line: i + 1 })
        }
      }
    })
  }
  return bad
}

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
