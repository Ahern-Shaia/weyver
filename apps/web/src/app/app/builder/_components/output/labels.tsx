"use client"

import { Plus, Printer, Trash2, X } from "lucide-react"
import Link from "next/link"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { type ReactNode, useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { useCreateLabel, useDeleteLabel, useLabels } from "@/lib/engine/hooks"
import type { FormDto, LabelItem } from "@/lib/engine/schemas"

/* R1·後續-2 M3 標籤設計器(in-app 設定,零上傳;OQ-PM-2 欄位堆疊序模型)。
   選欄 + 順序 + 尺寸 mm + 平舖/一頁一張 + 數量參照欄 → label_def;列印走獨立標籤列印頁。 */
export function LabelsPanel({
  formId,
  form,
}: {
  readonly formId: number
  readonly form: FormDto
}): ReactNode {
  const { data: labels = [] } = useLabels(formId)
  const createLabel = useCreateLabel(formId)
  const deleteLabel = useDeleteLabel(formId)
  const [name, setName] = useState("")
  const [widthMm, setWidthMm] = useState(50)
  const [heightMm, setHeightMm] = useState(30)
  const [tile, setTile] = useState(true)
  const [showFieldNames, setShowFieldNames] = useState(false)
  const [copiesField, setCopiesField] = useState("")
  const [items, setItems] = useState<LabelItem[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const numericFields = form.fields.filter((f) =>
    ["number", "money", "percent", "rating", "formula", "rollup"].includes(f.type),
  )

  const addItem = (): void => {
    const first = form.fields[0]
    if (first === undefined) return
    setItems([...items, { field: first.name }])
  }

  const submit = (): void => {
    setMsg(null)
    if (name.trim() === "" || items.length === 0) return setMsg("請填名稱並至少加一個欄位")
    createLabel.mutate(
      {
        name: name.trim(),
        config: {
          size: { widthMm, heightMm },
          tile,
          gapMm: 2,
          showFieldNames,
          ...(copiesField === "" ? {} : { copiesField }),
          items,
        },
      },
      {
        onSuccess: () => {
          setName("")
          setItems([])
          setMsg("已建立標籤")
        },
        onError: (e) => setMsg(describeEngineError(e)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3 text-[12px]">
      {labels.length > 0 ? (
        <div className="flex flex-col gap-1">
          {labels.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 rounded-xs border border-line px-2 py-1"
            >
              <span className="truncate text-ink">{l.name}</span>
              <span className="font-mono text-[12px] text-ink-3">
                {l.config.size.widthMm}×{l.config.size.heightMm}mm
              </span>
              <Link
                href={`/app/forms/${formId}/labels/${l.id}/print`}
                target="_blank"
                className="ml-auto text-ink-3 hover:text-primary"
                aria-label={`列印 ${l.name}`}
                title="開啟標籤列印頁"
              >
                <Printer size={12} />
              </Link>
              <button
                type="button"
                onClick={() => deleteLabel.mutate(l.id)}
                className="text-ink-3 hover:text-er"
                aria-label={`刪除 ${l.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-line-2 pt-2.5">
        <span className="text-ink-3">新增標籤</span>
        <Input
          className="h-7"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="標籤名稱"
        />
        <div className="flex items-center gap-1.5">
          <Input
            className="h-7 w-16"
            type="number"
            value={String(widthMm)}
            onChange={(e) => setWidthMm(Number(e.target.value) || 50)}
          />
          <span className="text-ink-3">×</span>
          <Input
            className="h-7 w-16"
            type="number"
            value={String(heightMm)}
            onChange={(e) => setHeightMm(Number(e.target.value) || 30)}
          />
          <span className="text-ink-3">mm</span>
        </div>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={tile}
            onChange={(e) => setTile(e.target.checked)}
            className="accent-(--color-primary)"
          />
          <span className="text-ink-2">A4 平舖(取消 = 一頁一張)</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showFieldNames}
            onChange={(e) => setShowFieldNames(e.target.checked)}
            className="accent-(--color-primary)"
          />
          <span className="text-ink-2">顯示欄位名稱</span>
        </label>
        <Select
          className="h-7"
          value={copiesField}
          onChange={(e) => setCopiesField(e.target.value)}
        >
          <option value="">每筆 1 張</option>
          {numericFields.map((f) => (
            <option key={f.id} value={f.name}>
              張數依:{f.name}
            </option>
          ))}
        </Select>

        {items.map((it, i) => (
          <div key={`${it.field}-${i}`} className="flex items-center gap-1.5">
            <Select
              className="h-7 flex-1"
              value={it.field}
              onChange={(e) =>
                setItems(items.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))
              }
            >
              {form.fields.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1 text-[12px] text-ink-3">
              <input
                type="checkbox"
                checked={it.asQr === true}
                onChange={(e) =>
                  setItems(
                    items.map((x, j) =>
                      j === i ? (e.target.checked ? { ...x, asQr: true } : { field: x.field }) : x,
                    ),
                  )
                }
                className="accent-(--color-primary)"
              />
              QR
            </label>
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              className="text-ink-3 hover:text-er"
              aria-label={`移除第${i + 1}項`}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="flex w-fit items-center gap-1 text-[12px] text-primary hover:underline"
        >
          <Plus size={12} />
          加欄位
        </button>

        <button
          type="button"
          onClick={submit}
          disabled={createLabel.isPending}
          className="flex items-center justify-center gap-1 rounded-xs bg-primary px-2 py-1 text-[12px] font-medium text-white hover:bg-primary-d disabled:opacity-40"
        >
          <Plus size={13} />
          建立標籤
        </button>
        {msg !== null ? <span className="text-ink-2">{msg}</span> : null}
      </div>
    </div>
  )
}
