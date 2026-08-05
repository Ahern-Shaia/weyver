import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MarkdownView, markdownToPlain } from "./markdown-view"

/* 🔴 R1·FTP v1.6|Markdown 欄位。

   本檔的主軸是那條**構造性**保證:整條路徑上不存在 HTML 字串,
   所以 XSS 不是「擋住了」而是「做不出來」。

   支援範圍照 Ragic(`doc/27`):標題 / 清單 / 簡易表格 / 文字格式,
   **不支援連結與圖片** —— 在它是產品取捨,在我方兼作安全邊界。

   ⚠️ 用 `renderToStaticMarkup` 而不是 Testing Library:後者未安裝,
   而且對「不產生 script」這條斷言,**直接看產出的 HTML 字串更直接** ——
   那正是使用者瀏覽器會拿到的東西。

   ⚠️ 本檔是 `.ts` 不是 `.tsx`:web 的 vitest 沒有掛 JSX transform
   (既有測試全是純邏輯的 `.ts`)。直接呼叫元件函式即可 —— 它沒有 hook。 */

const html = (text: string): string => renderToStaticMarkup(MarkdownView({ text }))

describe("Markdown 渲染", () => {
  it("標題 / 清單 / 粗體 / 表格照 Ragic 的支援範圍", () => {
    const out = html("## 規格\n- 甲\n- 乙\n\n**重點**\n\n| a | b |\n| --- | --- |\n| 1 | 2 |")
    expect(out).toMatch(/<h[1-6][^>]*>規格<\/h[1-6]>/)
    expect(out.match(/<li/g) ?? []).toHaveLength(2)
    expect(out).toContain("<strong>重點</strong>")
    expect(out).toContain("<table")
    expect(out).toContain("<td")
  })

  /* 🔴 這一組是本檔存在的理由。 */
  it("🔴 不產生任何 script / 事件屬性 —— 原字照印,不渲染", () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
    /* 🔴 直接看送到瀏覽器的字串:沒有真的標籤,只有被跳脫的字面 */
    expect(out).not.toContain("<script")
    expect(out).not.toContain("<img")
    /* ⚠️ **不能斷言「不含 onerror=」** —— 跳脫後的文字裡本來就會有那幾個字元,
       而那是無害的。第一版這樣寫直接紅,而功能是對的。
       要驗的是「**有沒有被跳脫**」,不是「有沒有出現這串字」。 */
    expect(out).toContain("&lt;script&gt;")
    expect(out).toContain("&lt;img")
    /* 使用者打的東西**不該無聲消失**:白名單之外印原字(跳脫後) */
    expect(out).toContain("alert(1)")
  })

  it("🔴 連結不渲染成 `<a>`(Ragic 不支援,而我方靠這一點擋掉 javascript: 協定)", () => {
    const out = html("[點我](javascript:alert(1)) 與 ![圖](http://x/y.png)")
    expect(out).not.toContain("<a ")
    expect(out).not.toContain("<a>")
    expect(out).not.toContain("<img")
    expect(out).toContain("點我")
  })

  it("空字串不渲染任何東西", () => {
    expect(html("   ")).toBe("")
  })
})

describe("markdownToPlain(網格 / 匯出 / PDF)", () => {
  it("攤成一行,不留 Markdown 符號", () => {
    const out = markdownToPlain("## 規格\n- 甲\n- 乙\n\n**重點**")
    expect(out).toContain("規格")
    expect(out).toContain("甲")
    expect(out).toContain("重點")
    expect(out).not.toContain("##")
    expect(out).not.toContain("**")
    expect(out).not.toContain("\n")
  })

  /* 🔴 取 token 的文字,**不是把符號刪掉** —— 刪符號會把不是語法的星號也刪掉。 */
  it("🔴 不是「刪符號」:非語法的星號要留著", () => {
    expect(markdownToPlain("公式 a*b 的結果")).toContain("a*b")
  })

  it("表格取得到內容", () => {
    expect(markdownToPlain("| 品名 | 數量 |\n| --- | --- |\n| 醬油 | 12 |")).toContain("醬油")
  })
})
