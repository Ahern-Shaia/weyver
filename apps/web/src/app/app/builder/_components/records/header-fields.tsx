import { useRuleContext } from "@/lib/engine/authz"
;("use client")

import { RuleMessages } from "@/components/form/rule-messages"
import {
  evaluateFieldStates,
  evaluateMessages,
  resolveFieldAttrs,
  sectionMembers,
} from "@/lib/engine/conditional-format"
import {
  FORM_COLS,
  FORM_COL_W,
  FORM_ROW_H,
  cellPosition,
  effectiveLayout,
} from "@/lib/engine/form-geometry"
import type { FieldDto, Layout } from "@/lib/engine/schemas"
import { FieldCellPair } from "@weyver/ui/field-grid"
import type { ReactElement, ReactNode } from "react"

/* 🔴 R1·UP-3c M1|填單表頭吃**設計器排的版面**。

   改動前這裡是 `grid-cols-[136px_1fr]` 的平鋪清單 —— 設計器排的兩欄並排、欄寬、位置
   在填單一律看不到,等於設計白排。form-designer-2d D1「畫布 = 填單畫面本身」只成立一半。

   幾何全部來自 form-geometry(設計器同源),此處不重新定義任何節距。

   ⚠️ 與設計畫布唯一的刻意差異:列高用 `minmax(ROW_H, auto)` 而非固定 ROW_H。
   設計時看的是版面(截斷即可),填單時使用者真的要打字 —— 多行文字 / 附件 / 簽名
   必須撐得開。欄的幾何完全一致,只有列會長高。 */

/* 🔴 值格自帶 `<label>` 的型別 —— 巢狀 label 是無效 HTML,實測會讓上傳失效。
   新增自帶 label 的輸入元件時要一併加進來(見 `field-grid.tsx` 的 `noLabelWrap`)。 */
const SELF_LABELLED = new Set(["attachment", "image", "signature"])

/* 版面圖片是使用者填的任意 URL(schema 只放行 https 與相對路徑),
   不走 `next/image` 的最佳化管線 —— 那需要網域白名單,而白名單是使用者資料。 */
function StaticImage({ url }: { readonly url: string | undefined }): ReactElement | null {
  if (url === undefined || url === "") return null
  return <img src={url} alt="" className="max-h-full object-contain" />
}

export function HeaderFields({
  fields,
  layout,
  values,
  renderInput,
}: {
  readonly fields: readonly FieldDto[]
  readonly layout: Layout | null
  /* 🔴 C-2:條件式規則要吃當前填寫值 —— 隱藏 / 唯讀是**隨著使用者邊填邊變**的,
     不是載入時算一次。傳當前 state 而非記錄快照。 */
  readonly values: Record<string, unknown>
  /* 🔴 2026-08-03:第二參數是**唯讀**。設計器的「唯讀」勾選框自出貨以來零 reader,
     勾了照樣能改 —— 使用者以為欄位保護住了。
     刻意不把 readonly 當 prop 傳進 FieldInput:那要穿過二十幾個型別分支,
     任何一支忽略它就又破功。改成**唯讀時根本不渲染編輯控制項**,沒有分支能繞過。 */
  readonly renderInput: (field: FieldDto, readonly: boolean, placeholder?: string) => ReactNode
}): ReactElement {
  const effective = effectiveLayout(fields, layout)
  const cols = layout?.grid.cols ?? FORM_COLS
  /* 記錄頁的規則(非列表頁)—— 這是填單畫面 */
  const rules = layout?.conditionalFormats?.record ?? []
  const fieldNames = fields.map((f) => f.name)
  /* 分段成員以列區間推導(OQ-CF-9)—— 名稱 → 列,取自生效版面而非原始 layout,
     因為未擺過的欄位由 `effectiveLayout` 自動排位,那也算在分段區間裡。 */
  const members = sectionMembers(
    effective.sections,
    new Map(fields.map((f) => [f.name, effective.fields[String(f.id)]?.row ?? 0])),
  )
  const ruleCtx = useRuleContext()
  const states = evaluateFieldStates(rules, values, fieldNames, members, ruleCtx)
  const messages = evaluateMessages(rules, values, fieldNames)

  return (
    <>
      <RuleMessages messages={messages} />
      <div
        style={{
          display: "grid",
          /* 固定 px 不是 fr:設計畫布是固定 720px,填單若改成撐滿視窗,
           同一個 colSpan 兩邊寬度就不同 —— 「設計即所見」會在寬螢幕上失效。
           右側留白兩邊一模一樣,那是刻意的(表單是文件不是儀表板)。 */
          gridTemplateColumns: `repeat(${String(cols)}, ${String(FORM_COL_W)}px)`,
          gridAutoRows: `minmax(${String(FORM_ROW_H)}px, auto)`,
          gap: 0,
          width: cols * FORM_COL_W,
        }}
      >
        {/* 🔴 audit-D §2.5|靜態敘述與圖片。`layout.statics[]` 出貨兩個月以來
            **只有設計器畫布讀得到** —— 設計者放了說明文字,填單的人看不到,
            而那正是 `form-designer-2d` §1.1 目標 2 的整個用意。

            `designOnly` 為真時**刻意不畫**:那是給設計者自己看的註記
            (欄位對照、待辦),不是給填單的人看的。 */}
        {effective.statics.map((el) =>
          el.designOnly === true ? null : (
            <div
              key={el.id}
              style={cellPosition(el)}
              className="-mr-px -mb-px flex items-center overflow-hidden border border-cell px-2.5 py-1 text-[13px] text-ink-2"
            >
              {el.kind === "image" ? (
                <StaticImage url={el.imageUrl} />
              ) : el.href !== undefined && el.href !== "" ? (
                <a href={el.href} className="truncate text-primary hover:underline">
                  {el.text ?? el.href}
                </a>
              ) : (
                /* 純文字 —— `markdown` 旗標目前無渲染器,原樣顯示不解析
                   (與條件式訊息同一條原則:不可信輸入不做標記解析) */
                <span className="whitespace-pre-wrap">{el.text ?? ""}</span>
              )}
            </div>
          ),
        )}

        {fields.map((field) => {
          const fl = effective.fields[String(field.id)]
          if (fl === undefined) return null
          /* S4 仲裁:靜態屬性 × 條件式規則(見 resolveFieldAttrs 之逐字依據) */
          /* 必填在**欄位**上、隱藏與唯讀在**版面**上 —— 兩者要一起交給仲裁,
             否則 `attrs.required` 只會反映規則,靜態必填的星號會憑空消失。 */
          const attrs = resolveFieldAttrs(
            { ...fl, required: field.required },
            states.get(field.name),
          )
          if (attrs.hidden) return null
          return (
            <div
              key={field.id}
              style={{ ...cellPosition(fl), display: "grid", gridTemplateColumns: "112px 1fr" }}
              className="-mr-px -mb-px border border-cell"
            >
              <FieldCellPair
                borderB={false}
                borderR={false}
                flush
                item={{
                  label: field.name,
                  /* 唯讀欄不標必填星號 —— 標了等於要求使用者填一個他填不了的欄 */
                  /* 唯讀欄不標必填星號;**因條件式被隱藏者亦略過必填**
                   —— 官方逐字:「當欄位因條件式格式被隱藏時,系統會略過檢查必填及輸入檢查」。
                   要求使用者填一個看不見的欄位會讓他直接卡死。 */
                  /* 🔴 C-3|必填吃**解析後**的值:靜態必填與規則必填的聯集,
                   且被規則隱藏時整個放掉(官方逐字「略過檢查必填」)。
                   唯讀欄不標星號 —— 標了等於要求使用者填一個他填不了的欄。 */
                  required: attrs.required && !attrs.readonly,
                  help: fl.help !== undefined && fl.help !== "" ? fl.help : false,
                  /* 這三型的輸入元件**自帶 `<label>`**(「選擇檔案」),外層不能再包一層 */
                  noLabelWrap: SELF_LABELLED.has(field.type),
                  value: renderInput(field, attrs.readonly, fl.placeholder),
                }}
              />
            </div>
          )
        })}
      </div>
    </>
  )
}
