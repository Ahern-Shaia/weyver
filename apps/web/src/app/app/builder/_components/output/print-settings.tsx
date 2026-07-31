"use client"

import { X } from "lucide-react"
import type { ReactNode } from "react"
import type { FieldDto, Layout, LayoutPrint } from "@/lib/engine/schemas"

/* R1·後續-2 M4 列印設定(OQ-PM-6=A 列範圍語意,承 Ragic doc/149)。
   紙張/邊界/方向刻意不提供 —— 委派瀏覽器列印對話框(OQ-PM-3)。 */

const EMPTY: LayoutPrint = { headerRows: [], footerRows: [], pageBreakAfterRows: [] }

function toggle(list: readonly number[], row: number): number[] {
  return list.includes(row) ? list.filter((r) => r !== row) : [...list, row].sort((a, b) => a - b)
}

export function PrintSettingsPanel({
  fields,
  layout,
  onChange,
  onClose,
}: {
  readonly fields: readonly FieldDto[]
  readonly layout: Layout
  readonly onChange: (print: LayoutPrint) => void
  readonly onClose: () => void
}): ReactNode {
  const print = layout.print ?? EMPTY
  // 版面上實際使用到的列(依欄位座標),供選取
  const rows = [
    ...new Set(
      fields
        .map((f) => layout.fields[String(f.id)]?.row)
        .filter((r): r is number => r !== undefined),
    ),
  ].sort((a, b) => a - b)

  const fieldNamesAt = (row: number): string =>
    fields
      .filter((f) => layout.fields[String(f.id)]?.row === row)
      .map((f) => f.name)
      .join("、") || "(空列)"

  return (
    <div className="flex w-64 shrink-0 flex-col border-l border-line bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[12px] font-semibold text-ink">列印設定</span>
        <button type="button" onClick={onClose} className="ml-auto text-ink-3 hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-[11.5px]">
        <p className="mb-2 text-[10.5px] text-ink-3">
          紙張大小 / 邊界 / 直橫向由瀏覽器列印對話框設定。
        </p>
        {rows.length === 0 ? (
          <span className="text-ink-3">尚無欄位列。</span>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 text-[10px] text-ink-3">
              <span>列</span>
              <span>頁首</span>
              <span>頁尾</span>
              <span>換頁</span>
            </div>
            {rows.map((row) => (
              <div
                key={row}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 border-b border-line-2 pb-1"
              >
                <span className="truncate text-ink-2" title={fieldNamesAt(row)}>
                  {row + 1}. {fieldNamesAt(row)}
                </span>
                <input
                  type="checkbox"
                  aria-label={`第${row + 1}列設為列印頁首`}
                  checked={print.headerRows.includes(row)}
                  onChange={() => onChange({ ...print, headerRows: toggle(print.headerRows, row) })}
                  className="accent-(--color-primary)"
                />
                <input
                  type="checkbox"
                  aria-label={`第${row + 1}列設為列印頁尾`}
                  checked={print.footerRows.includes(row)}
                  onChange={() => onChange({ ...print, footerRows: toggle(print.footerRows, row) })}
                  className="accent-(--color-primary)"
                />
                <input
                  type="checkbox"
                  aria-label={`第${row + 1}列後換頁`}
                  checked={print.pageBreakAfterRows.includes(row)}
                  onChange={() =>
                    onChange({
                      ...print,
                      pageBreakAfterRows: toggle(print.pageBreakAfterRows, row),
                    })
                  }
                  className="accent-(--color-primary)"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
