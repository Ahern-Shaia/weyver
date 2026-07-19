"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { useMemo, useState } from "react"
import { cn } from "@weyver/ui/lib/utils"

/* S3 表單設計器(Ragic「自己建」核心):左 欄位型別 palette · 中 表單畫布(點選)· 右 屬性面板 */
const FIELD_TYPES = [
  { id: "text", mark: "A", label: "自由輸入" },
  { id: "number", mark: "#", label: "數值" },
  { id: "money", mark: "$", label: "金額" },
  { id: "date", mark: "◷", label: "日期" },
  { id: "select", mark: "▾", label: "從選單選擇" },
  { id: "link", mark: "↗", label: "從其它表單選擇" },
  { id: "formula", mark: "fx", label: "公式" },
  { id: "auto", mark: "№", label: "自動編號" },
  { id: "batch", mark: "BN", label: "批號" },
  { id: "sign", mark: "✍", label: "簽名" },
] as const

type FieldTypeId = (typeof FIELD_TYPES)[number]["id"]

interface DesignField {
  readonly id: string
  label: string
  type: FieldTypeId
  required: boolean
}

interface DesignSection {
  readonly id: string
  title: string
  fields: DesignField[]
}

const INITIAL: readonly DesignSection[] = [
  {
    id: "s1",
    title: "基本資料",
    fields: [
      { id: "f1", label: "單號", type: "auto", required: false },
      { id: "f2", label: "單據日期", type: "date", required: true },
      { id: "f3", label: "採購人", type: "text", required: false },
      { id: "f4", label: "當班批號", type: "batch", required: false },
    ],
  },
  {
    id: "s2",
    title: "供應商與交貨",
    fields: [
      { id: "f5", label: "供應商", type: "link", required: true },
      { id: "f6", label: "交期", type: "date", required: false },
      { id: "f7", label: "金額", type: "formula", required: false },
    ],
  },
]

let nextId = 100

export function PoDesignerView() {
  const [sections, setSections] = useState<DesignSection[]>(() =>
    INITIAL.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({ ...field })),
    })),
  )
  const [selectedId, setSelectedId] = useState<string>("f1")

  const selected = useMemo(
    () => sections.flatMap((section) => section.fields).find((field) => field.id === selectedId),
    [sections, selectedId],
  )

  const updateSelected = (patch: Partial<Omit<DesignField, "id">>) => {
    setSections((previous) =>
      previous.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.id === selectedId ? { ...field, ...patch } : field,
        ),
      })),
    )
  }

  const addField = (type: FieldTypeId) => {
    const meta = FIELD_TYPES.find((fieldType) => fieldType.id === type)
    const id = `f${nextId++}`
    setSections((previous) =>
      previous.map((section, index) =>
        index === 0
          ? {
              ...section,
              fields: [
                ...section.fields,
                { id, label: `新${meta?.label ?? "欄位"}`, type, required: false },
              ],
            }
          : section,
      ),
    )
    setSelectedId(id)
  }

  const removeSelected = () => {
    setSections((previous) =>
      previous.map((section) => ({
        ...section,
        fields: section.fields.filter((field) => field.id !== selectedId),
      })),
    )
  }

  const typeMark = (type: FieldTypeId) => FIELD_TYPES.find((t) => t.id === type)?.mark ?? "A"

  return (
    <div className="flex h-full min-h-0">
      {/* 欄位型別 palette */}
      <div className="w-[168px] shrink-0 overflow-y-auto border-r border-line bg-card p-2">
        <div className="px-1 pb-1.5 text-[10.5px] font-semibold text-ink-3">欄位型別(點擊加入)</div>
        <div className="flex flex-col gap-1">
          {FIELD_TYPES.map((fieldType) => (
            <button
              key={fieldType.id}
              type="button"
              onClick={() => addField(fieldType.id)}
              className="flex items-center gap-2 rounded-xs border border-line bg-card px-2 py-1 text-left text-[11.5px] text-ink-2 hover:bg-head"
            >
              <span className="inline-flex h-4 w-5 items-center justify-center rounded-xs bg-label font-mono text-[9.5px] font-semibold text-ink-3">
                {fieldType.mark}
              </span>
              {fieldType.label}
            </button>
          ))}
        </div>
      </div>

      {/* 表單畫布 */}
      <div className="min-w-0 flex-1 overflow-y-auto bg-surface p-3.5">
        <div className="mx-auto max-w-[620px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] text-ink-3">設計模式 · 點欄位編輯屬性 · 變更即時反映</span>
            <Button variant="primary">發布表單</Button>
          </div>
          {sections.map((section) => (
            <section key={section.id} className="mb-3 border border-line bg-card">
              <header className="bg-primary px-3 py-1.5 text-[12px] font-semibold text-white">
                {section.title}
              </header>
              <div className="grid grid-cols-[112px_1fr]">
                {section.fields.map((field, index) => {
                  const isLast = index === section.fields.length - 1
                  const active = field.id === selectedId
                  return (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => setSelectedId(field.id)}
                      className="contents"
                    >
                      <span
                        className={cn(
                          "flex min-h-[32px] items-center justify-end gap-1 border-r border-cell bg-label px-2.5 text-right text-[11.5px] text-ink-2",
                          !isLast && "border-b",
                          active && "outline-2 -outline-offset-2 outline-primary",
                        )}
                      >
                        {field.required ? <span className="font-semibold text-er">*</span> : null}
                        {field.label}
                      </span>
                      <span
                        className={cn(
                          "flex min-h-[32px] items-center gap-1.5 border-cell bg-card px-2.5 text-[11px] text-ink-4",
                          !isLast && "border-b",
                          active && "bg-primary-t",
                        )}
                      >
                        <span className="inline-flex h-4 w-5 items-center justify-center rounded-xs bg-label font-mono text-[9.5px] font-semibold text-ink-3">
                          {typeMark(field.type)}
                        </span>
                        {FIELD_TYPES.find((t) => t.id === field.type)?.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* 屬性面板 */}
      <div className="w-[240px] shrink-0 overflow-y-auto border-l border-line bg-card p-3">
        <div className="pb-2 text-[10.5px] font-semibold text-ink-3">欄位屬性</div>
        {selected ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-ink-2">
              欄位名稱
              <Input
                value={selected.label}
                onChange={(event) => updateSelected({ label: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-2">
              型別
              <select
                value={selected.type}
                onChange={(event) => updateSelected({ type: event.target.value as FieldTypeId })}
                className="h-[27px] rounded-xs border border-line bg-card px-1.5 text-[12px]"
              >
                {FIELD_TYPES.map((fieldType) => (
                  <option key={fieldType.id} value={fieldType.id}>
                    {fieldType.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={selected.required}
                onChange={(event) => updateSelected({ required: event.target.checked })}
                className="accent-(--color-primary)"
              />
              必填
            </label>
            <Button variant="danger" onClick={removeSelected}>
              刪除欄位
            </Button>
          </div>
        ) : (
          <p className="text-[11.5px] text-ink-4">點選畫布上的欄位以編輯屬性。</p>
        )}
      </div>
    </div>
  )
}
