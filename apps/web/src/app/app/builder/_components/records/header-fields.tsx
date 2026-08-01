"use client"

import { FieldCellPair } from "@weyver/ui/field-grid"
import type { ReactElement, ReactNode } from "react"
import {
  cellPosition,
  effectiveLayout,
  FORM_COL_W,
  FORM_COLS,
  FORM_ROW_H,
} from "@/lib/engine/form-geometry"
import type { FieldDto, Layout } from "@/lib/engine/schemas"

/* 🔴 R1·UP-3c M1|填單表頭吃**設計器排的版面**。

   改動前這裡是 `grid-cols-[136px_1fr]` 的平鋪清單 —— 設計器排的兩欄並排、欄寬、位置
   在填單一律看不到,等於設計白排。form-designer-2d D1「畫布 = 填單畫面本身」只成立一半。

   幾何全部來自 form-geometry(設計器同源),此處不重新定義任何節距。

   ⚠️ 與設計畫布唯一的刻意差異:列高用 `minmax(ROW_H, auto)` 而非固定 ROW_H。
   設計時看的是版面(截斷即可),填單時使用者真的要打字 —— 多行文字 / 附件 / 簽名
   必須撐得開。欄的幾何完全一致,只有列會長高。 */

export function HeaderFields({
  fields,
  layout,
  renderInput,
}: {
  readonly fields: readonly FieldDto[]
  readonly layout: Layout | null
  readonly renderInput: (field: FieldDto) => ReactNode
}): ReactElement {
  const effective = effectiveLayout(fields, layout)
  const cols = layout?.grid.cols ?? FORM_COLS

  return (
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
      {fields.map((field) => {
        const fl = effective.fields[String(field.id)]
        if (fl === undefined || fl.hidden === true) return null
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
                required: field.required,
                help: fl.help !== undefined && fl.help !== "",
                value: renderInput(field),
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
