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

/* 🔴 token 值可能是**推導式**(docs/14 §0.4:主色階由 `--base-brand` 以 `color-mix`
   算出)。若這裡只認字面 hex,推導出來的 `-d` / `-t` 就**完全沒有人把關** ——
   等於為了少寫幾個值而把既有的對比保障拿掉。故此處解得開 `var()` 與 `color-mix()`。

   支援的形狀(只有這兩種,多的不猜):
   · `var(--base-x)`
   · `color-mix(in srgb, <來源>, black|white N%)`  ← sRGB 線性混合,與瀏覽器一致 */
function rawToken(name: string, scope: string = TOKENS): string {
  const m = new RegExp(`--(?:color-)?${name}:\\s*([^;]+);`).exec(scope)
  if (m?.[1] === undefined) throw new Error(`token 不存在:--color-${name}`)
  return m[1].trim()
}

function mix(a: string, b: string, pct: number): string {
  const ah = a.replace("#", "")
  const bh = b.replace("#", "")
  const ch = (i: number): number => {
    const av = Number.parseInt(ah.slice(i, i + 2), 16)
    const bv = Number.parseInt(bh.slice(i, i + 2), 16)
    return Math.round(av * (1 - pct) + bv * pct)
  }
  return `#${[0, 2, 4].map((i) => ch(i).toString(16).padStart(2, "0")).join("")}`
}

function resolveColor(value: string, scope: string = TOKENS): string {
  const v = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v

  const varRef = /^var\(\s*--([a-z0-9-]+)\s*\)$/i.exec(v)
  if (varRef?.[1] !== undefined) return resolveColor(rawToken(varRef[1], scope), scope)

  const cm = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s*,\s*(black|white)\s+([\d.]+)%\s*\)$/i.exec(v)
  if (cm?.[1] !== undefined && cm[2] !== undefined && cm[3] !== undefined) {
    const base = resolveColor(cm[1], scope)
    const target = cm[2].toLowerCase() === "black" ? "#000000" : "#ffffff"
    return mix(base, target, Number(cm[3]) / 100)
  }
  throw new Error(`無法解析的 token 值(只支援 hex / var / color-mix):${v}`)
}

function token(name: string, scope: string = TOKENS): string {
  return resolveColor(rawToken(name, scope), scope)
}

/* 三個配色主題各自的 scope。主題只覆寫 `--base-brand`,故先取該主題區塊、
   取不到再退回 :root —— 這正是「換一個值,其餘自動跟上」要驗的性質。 */
function themeScope(theme: "navy" | "teal" | "graphite"): string {
  if (theme === "navy") return TOKENS
  const m = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`).exec(TOKENS)
  return (m?.[1] ?? "") + TOKENS
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

/* 🔴 推導出來的主色階,三個主題各驗一次。

   `--primary-d` 是主要按鈕的 hover 底(**上面是白字**);
   `--primary-t` 是選取列 / 淡底(**上面是 `text-primary`**)。
   兩者都承載文字,卻在改成推導之前**完全沒有測試** ——
   手寫時沒人驗,改推導後更沒人驗,那才是真正的風險。

   這組測試同時是「換一個 base 其餘自動跟上」這個主張的驗收:
   三個主題只覆寫 `--base-brand`,若某個色相推導後對比不足,這裡會紅,
   屆時退回該色相手調並在此記錄為例外(docs/14 §0.4(a) 已載明此退路)。 */
describe("🔴 主色階由 base 推導 —— 三主題皆須過對比", () => {
  const themes = ["navy", "teal", "graphite"] as const
  for (const theme of themes) {
    const scope = themeScope(theme)

    it(`${theme}:白字 / primary-d(按鈕 hover)≥ ${String(AA_TEXT)}:1`, () => {
      expect(contrast("#ffffff", token("primary-d", scope))).toBeGreaterThanOrEqual(AA_TEXT)
    })

    it(`${theme}:primary 文字 / primary-t(選取列)≥ ${String(AA_TEXT)}:1`, () => {
      expect(contrast(token("primary", scope), token("primary-t", scope))).toBeGreaterThanOrEqual(
        AA_TEXT,
      )
    })

    it(`${theme}:primary / 卡片 ≥ ${String(AA_NON_TEXT)}:1(focus ring)`, () => {
      expect(contrast(token("primary", scope), token("card", scope))).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      )
    })
  }

  /* 推導本身要能被檢查:混合算錯的話上面九條可能仍然過(例如永遠回傳同一個值)。

     期望值**不是手算的** —— 初版憑手算寫下 `#eef2f7`,實測是 `#ebf0f4`。
     下列三組取自 Chromium 對同樣三個 `color-mix()` 宣告的 computed style
     (`color(srgb …)`,乘 255 後四捨五入):
       color-mix(in srgb, #22568a, black 20%) → 0.106667 0.269804 0.432941 → 27 69 110
       color-mix(in srgb, #22568a, white 91%) → 0.922    0.940353 0.958706 → 235 240 244
     即 CSS `in srgb` 是在 **gamma 編碼**的 sRGB 逐通道內插(非 linear-light),
     與本檔 `mix()` 同義。若日後改用 `in oklab` 之類的色彩空間,這裡會紅 —— 應該要紅。 */
  it("🔴 color-mix 的算法與瀏覽器一致(gamma 編碼 sRGB 逐通道內插)", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080")
    expect(mix("#22568a", "#000000", 0.2)).toBe("#1b456e")
    expect(mix("#22568a", "#ffffff", 0.91)).toBe("#ebf0f4")
  })

  it("🔴 三個主題確實只覆寫 base,沒有各自硬寫 primary", () => {
    for (const theme of ["teal", "graphite"] as const) {
      const block =
        new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`).exec(TOKENS)?.[1] ?? ""
      expect(block).toContain("--base-brand")
      expect(block).not.toContain("--color-primary-d")
    }
  })
})

/* 🔴 `@theme static` 的守門。

   `grid-tone.ts` 在**執行期**以 `getComputedStyle` 讀 24 個狀態色 —— Glide 網格吃 JS 物件,
   那裡用不了 class。而 Tailwind 4 的 `@theme` 預設**只輸出被 class 用到的變數**
   (4.3.3 實測),於是那 24 個變數存在與否,取決於「別處剛好也用了同名 class」。

   `static` 是唯一切斷這個隱性耦合的開關,而它看起來像個可以順手拿掉的關鍵字 ——
   拿掉之後不會有錯誤,只會有幾個顏色安靜地不見。 */
describe("🔴 tokens.css 必須用 @theme static", () => {
  it("執行期讀取的 token 不得依賴「別處剛好用了同名 class」", () => {
    expect(TOKENS).toMatch(/@theme\s+static\s*\{/)
  })
})
