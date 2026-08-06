import type { CSSProperties, ReactNode } from "react"
import { z } from "zod"

import { formatFieldValue } from "@/components/form/value"
import { BarcodeView } from "@/lib/engine/barcode"
import {
  FORM_COLS,
  FORM_ROW_H,
  breaksAfter,
  cellPosition,
  effectiveLayout,
  printRoleOf,
  usedRows,
} from "@/lib/engine/form-geometry"
import type { FieldDto, Layout } from "@/lib/engine/schemas"
import { fieldDtoSchema, layoutSchema, recordRowSchema } from "@/lib/engine/schemas"
import { fieldSymbology } from "@/lib/engine/symbology"

export const renderPayloadSchema = z.object({
  form: z.object({ id: z.number().int(), name: z.string() }),
  fields: z.array(fieldDtoSchema),
  /* M2:版面不再是 `unknown`。它**本來就存在**(設計器排的那一份),
     只是這頁一直沒讀 —— 見下方 `PrintDocument` 的說明。
     解析失敗時退回 null 而不是整份 PDF 失敗:版面是排版,值才是憑證。 */
  layout: layoutSchema.nullish().catch(null),
  records: z.array(recordRowSchema),
  linkLabels: z.record(z.string(), z.string()),
  members: z.record(z.string(), z.string()),
  lines: z
    .object({
      form: z.object({ id: z.number().int(), name: z.string() }),
      fields: z.array(fieldDtoSchema),
      byParent: z.record(z.string(), z.array(recordRowSchema)),
    })
    .nullable(),
  tenant: z.object({ name: z.string() }),
  /* R1·後續-2b M2 A3|租戶級浮水印(Ragic `doc/56` parity)。
     ⚠️ **只有文字**。圖片浮水印需要租戶級資產上傳,而那條路目前不存在
     (`tenants.logo_file_key` 至今零 writer)—— 在這裡先擺一個沒人寫的
     `imageDataUrl` 只是把同一個漂移再犯一次。詳見 migration 0063。 */
  watermark: z.object({ text: z.string().nullable() }).nullish().catch(null),
  ctx: z.object({ locale: z.string(), timeZone: z.string() }),
})

export type RenderPayload = z.infer<typeof renderPayloadSchema>

/* 沒有物理欄的互動型別:印在紙上是一團空白。
   ⚠️ `barcode` 已於 M2 移出 —— 它印得出來(見 `BarcodeView`),而條碼正是
   單據上最該印的東西之一。`image` / `signature` 仍不印:要把它們變成 data URI
   得為每筆記錄的每個檔案各抓一次,200 筆單據的 payload 會爆掉。列為殘留。 */
const SKIP_TYPES = new Set(["image", "signature"])

/* 🔴 R1·後續-2b M2|單據版面 —— **吃設計器排的那一份**。

   ## M1 是什麼樣子,為什麼要改

   M1 這裡是一張扁平的「欄名 / 值」兩欄表格,`layout` 宣告成 `z.unknown()`
   從頭到尾沒讀過。於是:使用者在設計器上把單號與日期排在同一列、把備註拉寬、
   在列印設定裡勾了「這一列之後換頁」—— 伺服器產的 PDF **一項都不採用**。

   M0 §2 把 A2 寫成「單據範本設計器」待建,那是錯的:設計器(`canvas.tsx`
   2D 畫布 + `print-settings.tsx` 列印設定)早就出貨了,缺的一直是這一端沒接上。
   所以 A2 的實作不是再做一個範本設計器 —— 那會變成第二套排版語言,
   而「使用者要學一套語言」正是第一約束擋掉的東西(M0 §0.3(b) 的 Word 參數)。

   ## 幾何一律來自 `form-geometry`

   `effectiveLayout` / `cellPosition` 與填單面板(`header-fields.tsx`)、設計畫布
   同源。沒排過版的欄位由 `effectiveLayout` 自動接一列,故**不需要**「沒有版面時
   走舊的扁平表格」這種分支 —— 那個分支就是第二份實作。

   ⚠️ 與螢幕唯一的刻意差異:欄寬用 `1fr` 而非固定 60px。畫布是 12×60=720px,
   而 A4 扣掉 12mm 邊界只有 ~703px —— 固定 px 會溢出右邊界。改成等分後
   **各欄比例與 colSpan 完全不變**,只是整體縮放到紙寬,那在紙上才是所見即所得。 */
export function PrintDocument({ payload }: { payload: RenderPayload }): ReactNode {
  const members = new Map(Object.entries(payload.members).map(([k, v]) => [Number(k), v]))
  const linkLabels = new Map(Object.entries(payload.linkLabels))
  const printable = payload.fields.filter((f) => !SKIP_TYPES.has(f.type))
  const source = payload.layout ?? null
  const layout = effectiveLayout(printable, source)
  const cols = layout.grid.cols || FORM_COLS
  const rows = usedRows(layout)
  const headerRows = rows.filter((r) => printRoleOf(source, r) === "header")
  const footerRows = rows.filter((r) => printRoleOf(source, r) === "footer")
  const bodyRows = rows.filter((r) => printRoleOf(source, r) === "body")
  const cell = { fields: printable, layout, members, linkLabels, ctx: payload.ctx, cols }

  return (
    <html lang={payload.ctx.locale}>
      <body className="bg-white text-ink">
        <Watermark watermark={payload.watermark ?? null} />
        {payload.records.map((record, index) => (
          <section
            key={record.id}
            /* 一筆一頁 —— 合併多筆時每張單據各自從新頁開始,
               而不是接在上一張的半頁上(那在實體單據上是不可接受的)。 */
            style={index === 0 ? undefined : { breakBefore: "page" }}
          >
            {/* 🔴 頁首 / 頁尾列走 `<thead>` / `<tfoot>`,不是 `break-inside: avoid`。

                列印設定面板寫的是「頁首」,而使用者對這兩個字的預期是**每頁重複**。
                記錄頁上它只做到「不被切斷」—— 螢幕沒有頁的概念,那是能做到的極限;
                但這裡是分頁媒體,`thead` / `tfoot` 是瀏覽器唯一原生支援跨頁重複的機制。
                同一份設定,在做得到的地方要做到它字面上的意思。 */}
            <table className="w-full border-collapse">
              {headerRows.length > 0 ? (
                <thead>
                  <tr>
                    <td className="p-0">
                      <RecordHeader payload={payload} record={record} />
                      <LayoutGrid {...cell} record={record} rows={headerRows} />
                    </td>
                  </tr>
                </thead>
              ) : null}
              {footerRows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td className="p-0">
                      <LayoutGrid {...cell} record={record} rows={footerRows} />
                    </td>
                  </tr>
                </tfoot>
              ) : null}
              <tbody>
                <tr>
                  <td className="p-0">
                    {headerRows.length === 0 ? (
                      <RecordHeader payload={payload} record={record} />
                    ) : null}
                    <LayoutGrid {...cell} record={record} rows={bodyRows} />
                    <LineTable payload={payload} parentId={record.id} />
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        ))}
      </body>
    </html>
  )
}

function RecordHeader({
  payload,
  record,
}: {
  readonly payload: RenderPayload
  readonly record: { readonly id: number; readonly updatedAt: string }
}): ReactNode {
  return (
    <header className="mb-4 flex items-baseline justify-between border-ink border-b pb-2">
      <div>
        <div className="font-semibold text-[16px]">{payload.form.name}</div>
        <div className="text-[12px] text-ink-3">{payload.tenant.name}</div>
      </div>
      <div className="text-right text-[12px] text-ink-3">
        <div>#{record.id}</div>
        {/* 🔴 列印時間用**租戶時區**(payload.ctx),不是伺服器時區。
            紙本單據上的日期差一天是實務上會出事的那種錯。 */}
        <div>{formatStamp(record.updatedAt, payload.ctx)}</div>
      </div>
    </header>
  )
}

/* 依 2D 座標把指定的列畫出來。欄位與靜態元素共用同一張格線 ——
   兩者在設計畫布上本來就是同一張格線上的東西。 */
function LayoutGrid({
  fields,
  layout,
  rows,
  record,
  members,
  linkLabels,
  ctx,
  cols,
}: {
  readonly fields: readonly FieldDto[]
  readonly layout: Layout
  readonly rows: readonly number[]
  readonly record: { readonly values: Record<string, unknown> }
  readonly members: ReadonlyMap<number, string>
  readonly linkLabels: ReadonlyMap<string, string>
  readonly ctx: { readonly locale: string; readonly timeZone: string }
  readonly cols: number
}): ReactNode {
  if (rows.length === 0) return null
  const wanted = new Set(rows)
  /* 🔴 子格線內**重新編號**。列號是整張版面的絕對座標,而頁首 / 內文 / 頁尾
     被拆進三張格線 —— 沿用絕對列號的話,每張格線都會在缺席的列號上留一條
     32px 的空列。2026-08-06 真的印出來才看到那兩段空白;`page.pdf()` 的
     產物不看一眼是發現不了的。 */
  const ordinal = new Map(rows.map((row, i) => [row, i]))
  const place = (el: {
    row: number
    col: number
    colSpan?: number | undefined
  }): CSSProperties => ({
    ...cellPosition({ ...el, row: ordinal.get(el.row) ?? 0 }),
    ...breakStyle(layout, el.row),
  })
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${String(cols)}, 1fr)`,
        gridAutoRows: `minmax(${String(FORM_ROW_H)}px, auto)`,
        gap: 0,
      }}
    >
      {layout.statics
        .filter((el) => wanted.has(el.row) && el.designOnly !== true)
        .map((el) => (
          <div
            key={el.id}
            style={place(el)}
            className="-mr-px -mb-px flex items-center overflow-hidden border border-line-2 px-2 py-1 text-[12px] text-ink-2"
          >
            {/* 靜態圖片是使用者填的任意 URL —— 渲染器的網路白名單只放行同源與
                data:,外連圖片會被 abort 成破圖。故列印時只印替代文字,
                不留一個空框讓人以為單據印壞了。 */}
            <span className="whitespace-pre-wrap">{el.text ?? ""}</span>
          </div>
        ))}
      {fields.map((field) => {
        const fl = layout.fields[String(field.id)]
        if (fl === undefined || !wanted.has(fl.row)) return null
        /* 版面上被設為隱藏的欄位不印 —— 螢幕上看不到的東西不該出現在紙本憑證上。
           ⚠️ 這是**靜態**隱藏;條件式規則的動態隱藏需要求值上下文,
           那條路 M2 尚未接進來,誠實列為殘留。 */
        if (fl.hidden === true) return null
        const symbology = fieldSymbology(field)
        return (
          <div
            key={field.id}
            style={place(fl)}
            className="-mr-px -mb-px grid grid-cols-[92px_1fr] border border-line-2"
          >
            <span className="flex items-center border-line-2 border-r bg-label px-2 py-1 text-[12px] text-ink-3">
              {field.name}
            </span>
            <span className="flex items-center px-2 py-1 text-[12px] text-ink">
              {symbology === null ? (
                formatFieldValue(field, record.values[field.name], members, ctx, linkLabels)
              ) : (
                <BarcodeView value={record.values[field.name]} symbology={symbology} size={56} />
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function breakStyle(layout: Layout, row: number): CSSProperties | undefined {
  return breaksAfter(layout, row) ? { breakAfter: "page" } : undefined
}

function LineTable({
  payload,
  parentId,
}: {
  readonly payload: RenderPayload
  readonly parentId: number
}): ReactNode {
  const lines = payload.lines
  const rows = lines?.byParent[String(parentId)] ?? []
  if (lines === null || rows.length === 0) return null

  const members = new Map(Object.entries(payload.members).map(([k, v]) => [Number(k), v]))
  const linkLabels = new Map(Object.entries(payload.linkLabels))
  /* 自動編號在紙上沒有意義(它是系統的序號不是單據的);
     與記錄頁的明細表格同一個取捨。 */
  const cols = lines.fields.filter((f) => f.type !== "autoNumber" && !SKIP_TYPES.has(f.type))

  return (
    <div className="mt-5">
      <div className="mb-1.5 font-semibold text-[12px] text-ink-3">{lines.form.name}</div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-ink border-b text-left">
            {cols.map((f) => (
              <th key={f.id} className="py-1 font-medium text-ink-3">
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((line) => (
            <tr key={line.id} className="border-line-2 border-b align-top">
              {cols.map((f) => (
                <td key={f.id} className="py-1 text-ink">
                  {formatFieldValue(f, line.values[f.name], members, payload.ctx, linkLabels)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* 🔴 浮水印。`position: fixed` 在 Chromium 的分頁媒體下**每頁重複** ——
   這正是浮水印要的行為,而且不必逐頁塞一份元素。

   Ragic 的 parity 是上傳商標(`doc/56` 逐字),我方先做文字
   (「作廢」「副本」「機密」是台灣單據實務上更常見的那一種);
   圖片那一版在等租戶級資產上傳,見 migration 0063。 */
function Watermark({
  watermark,
}: {
  readonly watermark: { readonly text: string | null } | null
}): ReactNode {
  if (watermark === null) return null
  const { text } = watermark
  if (text === null || text === "") return null
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        /* 印得出來但不遮住值。太深會讓掃描件的 OCR 讀錯金額。 */
        opacity: 0.1,
        transform: "rotate(-30deg)",
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 96, fontWeight: 700, whiteSpace: "nowrap" }}>{text}</span>
    </div>
  )
}

/* 只給頁首那一個時間戳 —— 欄位值的格式化一律走 `formatFieldValue`,
   不在這裡開第二條格式化路徑。 */
function formatStamp(iso: string, ctx: { locale: string; timeZone: string }): string {
  return new Intl.DateTimeFormat(ctx.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.timeZone,
  }).format(new Date(iso))
}
