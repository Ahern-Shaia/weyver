"use client"

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Trash2, X } from "lucide-react"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import type { ReactNode } from "react"
import { ConvertTypePanel } from "./convert-type-panel"
import { OptionsEditorPanel } from "./options-editor-panel"
import {
  DEFAULT_VARIABLES,
  type DefaultValue,
  type FieldDto,
  type FieldLayout,
  type StaticElement,
} from "@/lib/engine/schemas"

/* R1·UP-3 M3 欄位設定面板(placeholder/help/readonly/hidden/colSpan/預設值)。編輯 layout 草稿;
   hidden 為排版層(≠權限 D4)。預設值變數對映 M1 後端 create-time 解析。 */
/* 🔴 WCAG 2.2 SC 2.5.7 拖曳替代(AA):所有用拖曳完成的功能,
   都必須能以**單一指標且不需拖曳**完成。鍵盤可操作(2.1.1)是另一條,不能互相取代 ——
   手部精細動作受限但使用滑鼠的人,兩者都需要。 */
function MoveButtons({
  layout,
  cols,
  onChange,
}: {
  readonly layout: FieldLayout
  readonly cols: number
  readonly onChange: (patch: Partial<FieldLayout>) => void
}): ReactNode {
  const span = layout.colSpan ?? 6
  const move = (dCol: number, dRow: number): void =>
    onChange({
      col: Math.max(0, Math.min(cols - span, layout.col + dCol)),
      row: Math.max(0, layout.row + dRow),
    })
  const atLeft = layout.col <= 0
  const atRight = layout.col >= cols - span
  const atTop = layout.row <= 0

  return (
    <div className="flex flex-col gap-1">
      <span className="text-ink-3">位置(第 {layout.row + 1} 列、第 {layout.col + 1} 欄)</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => move(-1, 0)}
          disabled={atLeft}
          aria-label="左移一欄"
          className="flex size-7 items-center justify-center rounded-xs border border-line text-ink-3 hover:border-primary hover:text-primary disabled:opacity-40"
        >
          <ChevronLeft size={13} />
        </button>
        <button
          type="button"
          onClick={() => move(0, -1)}
          disabled={atTop}
          aria-label="上移一列"
          className="flex size-7 items-center justify-center rounded-xs border border-line text-ink-3 hover:border-primary hover:text-primary disabled:opacity-40"
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          onClick={() => move(0, 1)}
          aria-label="下移一列"
          className="flex size-7 items-center justify-center rounded-xs border border-line text-ink-3 hover:border-primary hover:text-primary"
        >
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          onClick={() => move(1, 0)}
          disabled={atRight}
          aria-label="右移一欄"
          className="flex size-7 items-center justify-center rounded-xs border border-line text-ink-3 hover:border-primary hover:text-primary disabled:opacity-40"
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}

export function FieldSettingsPanel({
  field,
  formId,
  cols,
  layout,
  onChange,
  onClose,
  onOptionsSaved,
}: {
  readonly field: FieldDto
  readonly formId: number
  readonly cols: number
  readonly layout: FieldLayout
  readonly onChange: (patch: Partial<FieldLayout>) => void
  readonly onClose: () => void
  readonly onOptionsSaved: () => void
}): ReactNode {
  /* 🔴 選項編輯只在此(#105)。layout 那些是**草稿**、隨畫布一起存;
     選項會改寫**既有記錄的資料**,所以是自己送出、自己確認,兩者不混。 */
  const choices = (field.options as { choices?: { id: string; name: string }[] } | undefined)
    ?.choices
  const dv = layout.defaultValue
  const dvKind = dv?.kind ?? "none"

  const setDvKind = (kind: string): void => {
    if (kind === "none") return onChange({ defaultValue: undefined })
    if (kind === "literal") return onChange({ defaultValue: { kind: "literal", value: "" } })
    if (kind === "formula") return onChange({ defaultValue: { kind: "formula", value: "" } })
    onChange({ defaultValue: { kind: "variable", value: "$DATE" } })
  }
  const setDvValue = (value: string): void => {
    if (dv === undefined) return
    onChange({ defaultValue: { ...dv, value } as DefaultValue })
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-l border-line bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="truncate text-[12px] font-semibold text-ink">{field.name}</span>
        <span className="font-mono text-[10px] text-ink-4">設定</span>
        <button type="button" onClick={onClose} className="ml-auto text-ink-4 hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3 text-[11.5px]">
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">提示文字(placeholder)</span>
            <Input
              className="h-7"
              value={layout.placeholder ?? ""}
              onChange={(e) => onChange({ placeholder: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">欄位說明（? 圖示)</span>
            <Input
              className="h-7"
              value={layout.help ?? ""}
              onChange={(e) => onChange({ help: e.target.value || undefined })}
            />
          </label>
          <MoveButtons layout={layout} cols={cols} onChange={onChange} />
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">跨欄數(colSpan)</span>
            <Input
              className="h-7 w-20"
              type="number"
              min={1}
              max={12}
              value={layout.colSpan ?? 6}
              onChange={(e) =>
                onChange({ colSpan: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })
              }
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={layout.readonly ?? false}
              onChange={(e) => onChange({ readonly: e.target.checked || undefined })}
              className="accent-(--color-primary)"
            />
            <span className="text-ink-2">唯讀</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={layout.hidden ?? false}
              onChange={(e) => onChange({ hidden: e.target.checked || undefined })}
              className="accent-(--color-primary)"
            />
            <span className="text-ink-2">隱藏（排版層,非權限)</span>
          </label>

          <div className="border-t border-line-2 pt-2.5">
            <div className="mb-1 text-ink-3">預設值</div>
            <Select
              className="h-7 w-full"
              value={dvKind}
              onChange={(e) => setDvKind(e.target.value)}
            >
              <option value="none">無</option>
              <option value="literal">固定文字</option>
              <option value="variable">變數</option>
              <option value="formula">公式（P1,暫不套)</option>
            </Select>
            {dv?.kind === "literal" ? (
              <Input
                className="mt-1.5 h-7"
                value={dv.value}
                onChange={(e) => setDvValue(e.target.value)}
                placeholder="固定預設值"
              />
            ) : null}
            {dv?.kind === "variable" ? (
              <Select
                className="mt-1.5 h-7 w-full"
                value={dv.value}
                onChange={(e) => setDvValue(e.target.value)}
              >
                {DEFAULT_VARIABLES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            ) : null}
            {dv?.kind === "formula" ? (
              <Input
                className="mt-1.5 h-7 font-mono"
                value={dv.value}
                onChange={(e) => setDvValue(e.target.value)}
                placeholder="公式(P1)"
              />
            ) : null}
          </div>
        </div>
      </div>
      <ConvertTypePanel
        formId={formId}
        fieldId={field.id}
        currentType={field.type}
        onConverted={onOptionsSaved}
      />

      {choices !== undefined ? (
        <OptionsEditorPanel
          formId={formId}
          fieldId={field.id}
          fieldName={field.name}
          initial={choices}
          onSaved={onOptionsSaved}
        />
      ) : null}
    </div>
  )
}

/* 靜態元素設定(文字/圖片;text=Markdown+href、image=imageUrl;designOnly=僅設計模式可見) */
export function StaticSettingsPanel({
  element,
  onChange,
  onDelete,
  onClose,
}: {
  readonly element: StaticElement
  readonly onChange: (patch: Partial<StaticElement>) => void
  readonly onDelete: () => void
  readonly onClose: () => void
}): ReactNode {
  return (
    <div className="flex w-64 shrink-0 flex-col border-l border-line bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[12px] font-semibold text-ink">
          {element.kind === "text" ? "文字元素" : "圖片元素"}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto text-ink-4 hover:text-er"
          aria-label="刪除元素"
        >
          <Trash2 size={13} />
        </button>
        <button type="button" onClick={onClose} className="text-ink-4 hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 text-[11.5px]">
        {element.kind === "text" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-ink-3">文字內容</span>
              <textarea
                value={element.text ?? ""}
                onChange={(e) => onChange({ text: e.target.value })}
                rows={4}
                className="rounded-xs border border-line bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-primary"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={element.markdown ?? false}
                onChange={(e) => onChange({ markdown: e.target.checked || undefined })}
                className="accent-(--color-primary)"
              />
              <span className="text-ink-2">Markdown</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-3">超連結（https/相對)</span>
              <Input
                className="h-7"
                value={element.href ?? ""}
                onChange={(e) => onChange({ href: e.target.value || undefined })}
                placeholder="https://…"
              />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">圖片網址(https/相對)</span>
            <Input
              className="h-7"
              value={element.imageUrl ?? ""}
              onChange={(e) => onChange({ imageUrl: e.target.value || undefined })}
              placeholder="https://…/logo.png"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-ink-3">跨欄數(colSpan)</span>
          <Input
            className="h-7 w-20"
            type="number"
            min={1}
            max={12}
            value={element.colSpan ?? 4}
            onChange={(e) =>
              onChange({ colSpan: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })
            }
          />
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={element.designOnly ?? false}
            onChange={(e) => onChange({ designOnly: e.target.checked || undefined })}
            className="accent-(--color-primary)"
          />
          <span className="text-ink-2">僅設計模式可見</span>
        </label>
      </div>
    </div>
  )
}
