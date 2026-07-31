import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/* R1·UX-1 M9|**對比度 CI 檢查**(OQ-13=A ①)。

   §2.7 的診斷是:間距守得住是因為有節奏可循,**色與字級失守是因為從未進 CI**。
   故把 WCAG 對比從「文件上的一句話」變成會擋 CI 的斷言。

   直接讀 `tokens.css` 的實際值 —— 不複製一份常數,否則 token 改了測試不會知道;
   路徑相對於 vitest 的 cwd(apps/web)。 */
const TOKENS = readFileSync(
  resolve(process.cwd(), "../../packages/ui/src/styles/tokens.css"),
  "utf-8",
)

function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(TOKENS)
  if (m?.[1] === undefined) throw new Error(`token 不存在:--color-${name}`)
  return m[1]
}

function channel(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => channel(Number.parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

const AA_TEXT = 4.5
const AA_NON_TEXT = 3

describe("WCAG 對比:文字(AA 需 4.5:1)", () => {
  const pairs: readonly [string, string, string][] = [
    ["主文 / 卡片", "ink", "card"],
    ["次文 / 卡片", "ink-2", "card"],
    ["輔助 / 卡片", "ink-3", "card"],
    /* 🔴 輔助文字大量出現在非白底上 —— 只量白底是先前稽核的盲點 */
    ["輔助 / 應用底", "ink-3", "surface"],
    ["輔助 / 表頭底", "ink-3", "head"],
    ["輔助 / label 格底", "ink-3", "label"],
    ["連結 / 卡片", "link", "card"],
    ["主色 / 卡片", "primary", "card"],
    /* 🔴 表頭:`ink-3` 於 `head` 底上僅 4.21:1 —— M9 已改用 `ink-2` */
    ["表頭文字 / 表頭底", "ink-2", "head"],
    ["label 格文字 / label 底", "ink-2", "label"],
  ]
  for (const [name, fg, bg] of pairs) {
    it(`${name} ≥ ${String(AA_TEXT)}:1`, () => {
      expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_TEXT)
    })
  }
})

describe("WCAG 對比:狀態章與類別色(字 / 底)", () => {
  const tones = ["ok", "wn", "er", "nt", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]
  for (const t of tones) {
    it(`${t} 章 ≥ ${String(AA_TEXT)}:1`, () => {
      expect(contrast(token(t), token(`${t}-t`))).toBeGreaterThanOrEqual(AA_TEXT)
    })
  }
})

describe("WCAG 1.4.11 非文字對比(需 3:1)", () => {
  it("輸入框 resting border ≥ 3:1(空白時為唯一識別線索)", () => {
    expect(contrast(token("line-input"), token("card"))).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })

  it("focus ring ≥ 3:1", () => {
    expect(contrast(token("primary"), token("card"))).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })

  /* 🔴 **刻意的低對比,不是缺陷** —— 這條測試釘住「不得為了讓數字好看而加深表格框線」。
     1.4.11 明文不要求控制項有可見邊界,判準是「邊界是否為識別所必需」;表格非 UI
     component,資料本身傳達結構。Carbon 官方 border-subtle 更淡(1.32:1)且明知照發。 */
  it("表格 / 卡片框線刻意維持極淡(1.4.11 不規範,勿「順手」加深)", () => {
    const c = contrast(token("line"), token("card"))
    expect(c).toBeLessThan(AA_NON_TEXT)
    expect(c).toBeGreaterThan(1.1)
  })
})

describe("停用態 token 的使用邊界", () => {
  /* `ink-disabled` 本就不到 3:1 —— WCAG 1.4.3 對停用元件內文字有 incidental 豁免。
     此測試釘住「它只能是停用色」,避免日後有人拿它當一般輔助色用回去。 */
  it("ink-disabled 低於 AA(僅停用元件可用,非一般輔助色)", () => {
    expect(contrast(token("ink-disabled"), token("card"))).toBeLessThan(AA_TEXT)
  })
})
