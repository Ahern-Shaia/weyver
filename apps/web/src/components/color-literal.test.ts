import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/* 🔴 禁止色碼字面值(docs/28 §1.4)。

   ## 為什麼補這一支

   「禁在元件硬編 hex,一律走語意 token」在 `tokens.css` 檔頭與 docs/14 都寫了,
   但**沒有任何檢查** —— 而字階當初也是「文件有寫」,結果漏到 16 種才被抓回 6 階。
   同一種破口不該留第二個。

   加上這條檢查的當下就照出三個**已經在線上的**不一致:
   · `theme-switcher` 的色塊寫死舊值 `#1E4E79`,而 tokens.css 已是 `#22568a`
     → **點下去的顏色和切出來的主題不同**
   · `grid-tone` 抄了一份 12 組狀態色,檔頭自白「異動需同步」
   · 簽名筆寫死 `#0C5F73`(深海青),不管使用者選哪個主題都畫出深海青

   三者都是「沒人會發現」的那種 —— 正是要靠機器擋的東西。

   ## 對照 Metabase(docs/28 §1.4)

   其自寫規則 `metabase/no-color-literals` 的訊息逐字:
   「Color literals forbidden. Import colors from 'metabase/ui/colors'.」
   嚴格到自家 theme 的三個陰影值都要逐行 eslint-disable。本檢查取同一立場。

   ## 為什麼是掃檔而不是 ESLint 規則

   與既有的 `type-scale.test.ts` / `contrast.test.ts` 同機制,零新工具鏈;
   失敗訊息直接指到檔案與該行。日後若要更精準(只看 AST 的字串節點),
   再升級成 ESLint plugin 不遲。 */

const ROOTS = [join(process.cwd(), "src"), join(process.cwd(), "..", "..", "packages", "ui", "src")]

/* 唯一豁免:token 定義本身(色值總得有個地方寫),與設計系統展示頁(它的內容就是色票)。
 **新增豁免必須寫理由** —— 沒有理由的豁免會讓這條檢查慢慢變成裝飾。 */
const EXEMPT = [
  "packages/ui/src/styles/tokens.css", // 色值的唯一來源
  "apps/web/src/app/design-system/page.tsx", // 設計系統展示頁:內容即色票
  "apps/web/src/components/color-literal.test.ts", // 本檢查自身:內含比對用素材
  /* 對比檢查:它的工作就是**對色值做算術**(解析 `color-mix`、比對推導結果、
     以純白/純黑當對比基準)。這些不是「硬編在畫面上的顏色」,是斷言的素材本身。
     ⚠️ 界線:此豁免僅限測試檔;任何會被 render 的程式碼都不得援引。 */
  "apps/web/src/components/contrast.test.ts",
]

/* 🔴 只抓**六碼**與 Tailwind 的任意色語法。
   三碼式 `#abc` 與本庫大量出現的議題編號(`#105` / `#106` / `#96`)無法區分 ——
   `106` 本身就是合法的 hex 字元。Metabase 的規則有同樣的弱點,他們靠逐行
   eslint-disable 收拾;我方選擇縮小 pattern,寧可漏抓罕見的三碼寫法,
   也不要製造一堆假警報 —— 假警報會讓人習慣性忽略,那等於沒有檢查。 */
const HEX = /#[0-9a-fA-F]{6}\b|\[#[0-9a-fA-F]{3,8}\]/
const RGB_HSL = /\b(?:rgb|hsl)a?\(\s*\d/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue
      walk(full, out)
    } else if (/\.(tsx?|css)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/* 只看程式碼,不看註解 —— 註解裡引用舊色碼來說明「為什麼不能這樣寫」是合理的。
   Metabase 的規則同樣只檢查 AST 的字串節點。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("🔴 禁色碼字面值(docs/28 §1.4)", () => {
  const offenders: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = relative(join(process.cwd(), "..", ".."), file)
      if (EXEMPT.some((e) => rel.endsWith(e) || rel === e)) continue
      const lines = stripComments(readFileSync(file, "utf8")).split("\n")
      lines.forEach((line, i) => {
        if (HEX.test(line) || RGB_HSL.test(line)) {
          offenders.push(`${rel}:${String(i + 1)}  ${line.trim().slice(0, 90)}`)
        }
      })
    }
  }

  it("色值一律走語意 token,不得硬編", () => {
    expect(offenders).toEqual([])
  })

  /* 🔴 檢查本身要能被檢查:規則若失效(例如 regex 寫壞),上面那條會永遠是綠的。 */
  it("🔴 regex 確實抓得到各種寫法", () => {
    expect(HEX.test('color: "#1E4E79"')).toBe(true)
    expect(HEX.test("bg-[#abc]")).toBe(true)
    /* 議題編號不得被誤判為色碼 —— 本庫到處都是 `#105` 這種引用 */
    expect(HEX.test("追溯稽核 #106")).toBe(false)
    expect(RGB_HSL.test("rgba(0, 0, 0, 0.1)")).toBe(true)
    expect(RGB_HSL.test("hsl(208, 72%, 60%)")).toBe(true)
    /* 不該誤判:CSS 變數、Tailwind class、雜湊字串 */
    expect(HEX.test("var(--color-primary)")).toBe(false)
    expect(HEX.test('className="bg-primary"')).toBe(false)
  })

  it("🔴 註解裡的色碼不算違規(說明用途)", () => {
    expect(stripComments("/* 原本是 #1E4E79 */\nconst a = 1").includes("#1E4E79")).toBe(false)
    expect(stripComments("// 舊值 #0C5F73\nconst b = 2").includes("#0C5F73")).toBe(false)
  })
})
