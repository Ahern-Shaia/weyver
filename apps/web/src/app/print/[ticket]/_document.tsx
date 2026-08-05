import type { ReactNode } from "react"
import { z } from "zod"

import { formatFieldValue } from "@/components/form/value"
import { fieldDtoSchema, recordRowSchema } from "@/lib/engine/schemas"

export const renderPayloadSchema = z.object({
  form: z.object({ id: z.number().int(), name: z.string() }),
  fields: z.array(fieldDtoSchema),
  layout: z.unknown(),
  records: z.array(recordRowSchema),
  linkLabels: z.record(z.string(), z.string()),
  members: z.record(z.string(), z.string()),
  tenant: z.object({ name: z.string() }),
  ctx: z.object({ locale: z.string(), timeZone: z.string() }),
})

export type RenderPayload = z.infer<typeof renderPayloadSchema>

/* 讀時計算的欄位在 PDF 上照印(它們是值),但**沒有物理欄的 stub 型別**
   不印 —— 那些在畫面上是互動元件,印在紙上是一團空白。 */
const SKIP_TYPES = new Set(["attachment", "image", "signature", "barcode"])

/* 🔴 R1·後續-2b M1|單據版面。

   本檔**刻意只做排版**。值的格式化一律走 `formatFieldValue` 且帶滿五個參數
   (members / ctx / linkLabels)—— 那是會漏東西的地方,而 `display-outlets.test.ts`
   會在 CI 檢查本檔也帶滿。

   ⚠️ 這是記錄頁之外的第二份**排版**實作,誠實記在這裡:統一列 M2。
   選擇先共用「值」而非「版」的理由 —— 版漂了是難看,值漂了是印錯或外洩。 */
export function PrintDocument({ payload }: { payload: RenderPayload }): ReactNode {
  const members = new Map(Object.entries(payload.members).map(([k, v]) => [Number(k), v]))
  const linkLabels = new Map(Object.entries(payload.linkLabels))
  const printable = payload.fields
    .filter((f) => !SKIP_TYPES.has(f.type))
    .sort((a, b) => a.position - b.position)

  return (
    <html lang={payload.ctx.locale}>
      <body className="bg-white text-ink">
        {payload.records.map((record, index) => (
          <section
            key={record.id}
            /* 一筆一頁 —— 合併多筆時每張單據各自從新頁開始,
               而不是接在上一張的半頁上(那在實體單據上是不可接受的)。 */
            style={index === 0 ? undefined : { breakBefore: "page" }}
            className="px-0 py-0"
          >
            <header className="mb-4 flex items-baseline justify-between border-b border-ink pb-2">
              <div>
                <div className="text-[16px] font-semibold">{payload.form.name}</div>
                <div className="text-[12px] text-ink-3">{payload.tenant.name}</div>
              </div>
              <div className="text-right text-[12px] text-ink-3">
                <div>#{record.id}</div>
                {/* 🔴 列印時間用**租戶時區**(payload.ctx),不是伺服器時區。
                    紙本單據上的日期差一天是實務上會出事的那種錯。 */}
                <div>{formatStamp(record.updatedAt, payload.ctx)}</div>
              </div>
            </header>

            <table className="w-full text-[12px]">
              <tbody>
                {printable.map((field) => (
                  <tr key={field.id} className="border-b border-line-2 align-top">
                    <th className="w-40 py-1 text-left font-medium text-ink-3">{field.name}</th>
                    <td className="py-1 text-ink">
                      {formatFieldValue(
                        field,
                        record.values[field.name],
                        members,
                        payload.ctx,
                        linkLabels,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </body>
    </html>
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
