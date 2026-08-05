import { lexer } from "marked"
import type { Token, Tokens } from "marked"
import type { ReactNode } from "react"

/* 🔴 R1·FTP v1.6|Markdown 欄位的渲染。

   ## 🔴 整條路徑上不存在 HTML 字串

   常見做法是 `marked.parse()` 產生 HTML 再交給 `dangerouslySetInnerHTML`,
   然後補一層 sanitiser。本檔**不走那條路**:

   · `lexer()` 只做**解析**,回傳 token 樹
   · 由 token 直接產 **React 元素**
   · 白名單之外的 token 一律當**純文字**印出

   於是 XSS **在構造上不可能**,而不是靠淨化擋住 ——
   繞過 sanitiser 是一整個持續在進化的研究領域,而「不產生 HTML」不會被繞。
   代價是要自己列舉支援的 token,而那正好與下面那條 parity 對齊。

   ## 支援範圍照 Ragic(不是照 CommonMark)

   Ragic 官方逐字(`doc/27`「Markdown」):
   > 「透過簡單的語法,即可在欄位中加入**標題、清單、簡易表格與文字格式**」
   > 「此欄位**不支援**以 Markdown 語法插入**連結與圖片**」
   > 「Ragic 的 Markdown 表格**僅支援文字排版,不會顯示格線**」

   **「不支援連結與圖片」對我方剛好是安全邊界**:沒有 `<a href>` 就沒有
   `javascript:` 協定的問題,沒有 `<img src>` 就沒有外連追蹤與 SSRF 的問題。
   同一件事在它是產品取捨,在我方兼作構造上的防線 —— 但**不宣稱那是它的理由**。

   ⚠️ 原始碼中的 `marked` 為 **MIT**(讀 `LICENSE` 檔本文,18.0.6,查證 2026-08-06)。
   它是 `packages/ui` 的直接相依但**先前零使用** —— 又一個「裝了沒用」的套件。 */

/* 標題最多到 H3:欄位裡的標題是段落分隔,不是頁面層級。
   再大的字級會壓過表單本身的層級,而 docs/14 的字階只到 24px。 */
const HEADING_TAGS = ["h3", "h3", "h3", "h4", "h5", "h6"] as const

function renderInline(tokens: readonly Token[] | undefined, keyBase: string): ReactNode[] {
  if (tokens === undefined) return []
  return tokens.map((t, i) => {
    const key = `${keyBase}-${String(i)}`
    switch (t.type) {
      case "strong":
        return <strong key={key}>{renderInline((t as Tokens.Strong).tokens, key)}</strong>
      case "em":
        return <em key={key}>{renderInline((t as Tokens.Em).tokens, key)}</em>
      case "del":
        return <del key={key}>{renderInline((t as Tokens.Del).tokens, key)}</del>
      case "codespan":
        return (
          <code key={key} className="rounded-xs bg-label px-1 font-mono text-[12px]">
            {(t as Tokens.Codespan).text}
          </code>
        )
      case "br":
        return <br key={key} />
      case "text": {
        const tt = t as Tokens.Text
        /* 巢狀 token 要繼續往下走,否則 `**粗體**` 包在 text 裡時會被印成字面 */
        return tt.tokens === undefined ? (
          tt.text
        ) : (
          <span key={key}>{renderInline(tt.tokens, key)}</span>
        )
      }
      /* 🔴 白名單之外(link / image / html / …)一律印**原字**。
         不是丟掉 —— 使用者打的東西不該無聲消失;也不是渲染 —— 那是攻擊面。 */
      default:
        return "raw" in t ? String((t as { raw: unknown }).raw) : ""
    }
  })
}

function renderBlock(tokens: readonly Token[], keyBase: string): ReactNode[] {
  return tokens.map((t, i) => {
    const key = `${keyBase}-${String(i)}`
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading
        const Tag = HEADING_TAGS[Math.min(Math.max(h.depth, 1), 6) - 1] ?? "h6"
        return (
          <Tag key={key} className="mt-2 mb-1 font-semibold text-ink first:mt-0">
            {renderInline(h.tokens, key)}
          </Tag>
        )
      }
      case "paragraph":
        return (
          <p key={key} className="my-1 text-ink">
            {renderInline((t as Tokens.Paragraph).tokens, key)}
          </p>
        )
      case "list": {
        const l = t as Tokens.List
        const items = l.items.map((it, j) => (
          <li key={`${key}-${String(j)}`} className="ml-4 list-outside">
            {renderInline(it.tokens, `${key}-${String(j)}`)}
          </li>
        ))
        return l.ordered ? (
          <ol key={key} className="my-1 list-decimal text-ink">
            {items}
          </ol>
        ) : (
          <ul key={key} className="my-1 list-disc text-ink">
            {items}
          </ul>
        )
      }
      case "table": {
        const tb = t as Tokens.Table
        return (
          <table key={key} className="my-1.5 w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left">
                {tb.header.map((c, j) => (
                  <th key={`${key}-h${String(j)}`} className="py-1 font-medium text-ink-3">
                    {renderInline(c.tokens, `${key}-h${String(j)}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((row, r) => (
                <tr key={`${key}-r${String(r)}`} className="border-b border-line-2">
                  {row.map((c, j) => (
                    <td key={`${key}-r${String(r)}c${String(j)}`} className="py-1 text-ink">
                      {renderInline(c.tokens, `${key}-r${String(r)}c${String(j)}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
      case "code":
        /* 區塊程式碼**不做語法highlight** —— 那要另一個函式庫,而欄位裡的
           程式碼片段是給人看的不是給編譯器看的 */
        return (
          <pre
            key={key}
            className="my-1.5 overflow-x-auto rounded-xs bg-label p-2 font-mono text-[12px] text-ink"
          >
            {(t as Tokens.Code).text}
          </pre>
        )
      case "blockquote":
        return (
          <blockquote key={key} className="my-1.5 border-line border-l-2 pl-2 text-ink-2">
            {renderBlock((t as Tokens.Blockquote).tokens, key)}
          </blockquote>
        )
      case "hr":
        return <hr key={key} className="my-2 border-line" />
      case "space":
        return null
      default:
        return (
          <p key={key} className="my-1 whitespace-pre-wrap text-ink">
            {"raw" in t ? String((t as { raw: unknown }).raw) : ""}
          </p>
        )
    }
  })
}

export function MarkdownView({ text }: { text: string }): ReactNode {
  if (text.trim() === "") return null
  /* `lexer` 只解析不產生 HTML。`gfm` 給表格與刪除線(Ragic 的「簡易表格」)。 */
  const tokens = lexer(text, { gfm: true })
  return <div className="text-[12px] leading-relaxed">{renderBlock(tokens, "md")}</div>
}

/* 網格 / 匯出 / PDF 用:把 Markdown 攤成一行純文字。

   ⚠️ **不是把符號刪掉**,是取 token 的文字 —— 刪符號會把 `a*b` 的星號也刪掉。 */
export function markdownToPlain(text: string): string {
  const out: string[] = []
  const walk = (tokens: readonly Token[]): void => {
    for (const t of tokens) {
      if ("tokens" in t && Array.isArray(t.tokens) && t.tokens.length > 0) {
        walk(t.tokens as Token[])
      } else if (t.type === "list") {
        for (const it of (t as Tokens.List).items) walk(it.tokens)
      } else if (t.type === "table") {
        const tb = t as Tokens.Table
        for (const c of tb.header) walk(c.tokens)
        for (const row of tb.rows) for (const c of row) walk(c.tokens)
      } else if ("text" in t && typeof t.text === "string") {
        out.push(t.text)
      }
    }
  }
  walk(lexer(text, { gfm: true }))
  return out.join(" ").replace(/\s+/g, " ").trim()
}
