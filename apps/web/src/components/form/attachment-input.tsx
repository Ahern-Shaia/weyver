"use client"

import { deleteFile, describeEngineError, downloadFile, uploadFile } from "@/lib/engine/client"
import type { AttachmentItem } from "@/lib/engine/schemas"
import { Paperclip, X } from "lucide-react"
import { type ReactNode, useId, useRef, useState } from "react"

/* F-5 M4 附件欄輸入。上傳即產生 pending 檔(記錄存檔時後端轉 bound);
   欄值維持 [{key,name}] 契約 —— 前端不持有 mime/size,顯示只需檔名。 */

const MAX_ITEMS = 50

function toItems(value: unknown): AttachmentItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is AttachmentItem =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as { key?: unknown }).key === "string" &&
      typeof (v as { name?: unknown }).name === "string",
  )
}

export function AttachmentInput({
  formId,
  fieldId,
  value,
  onChange,
}: {
  readonly formId: number
  readonly fieldId: number
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}): ReactNode {
  const items = toItems(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (files: FileList | null): Promise<void> => {
    setError(null)
    const list = files === null ? [] : [...files]
    if (list.length === 0) return
    if (items.length + list.length > MAX_ITEMS) {
      setError(`單一欄位最多 ${MAX_ITEMS} 個附件`)
      return
    }
    setBusy(true)
    const added: AttachmentItem[] = []
    try {
      for (const file of list) {
        const uploaded = await uploadFile(formId, fieldId, file)
        added.push({ key: uploaded.key, name: uploaded.name })
      }
    } catch (e) {
      setError(describeEngineError(e))
    } finally {
      setBusy(false)
      if (added.length > 0) onChange([...items, ...added])
      if (inputRef.current !== null) inputRef.current.value = ""
    }
  }

  const remove = (key: string): void => {
    onChange(items.filter((i) => i.key !== key))
    // 未綁記錄之檔案即刻軟刪(釋放配額);失敗亦不阻擋編輯 —— 逾期未綁者由孤兒回收兜底
    void deleteFile(key)
  }

  const open = async (item: AttachmentItem): Promise<void> => {
    setError(null)
    try {
      await downloadFile(item.key, item.name)
    } catch (e) {
      setError(describeEngineError(e))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void open(item)}
                className="flex min-w-0 items-center gap-1 text-[12px] text-primary hover:underline"
              >
                <Paperclip size={11} strokeWidth={1.9} />
                <span className="truncate">{item.name}</span>
              </button>
              <button
                type="button"
                onClick={() => remove(item.key)}
                aria-label={`移除 ${item.name}`}
                className="text-ink-3 hover:text-er"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label
        htmlFor={inputId}
        className="flex w-fit cursor-pointer items-center gap-1 rounded-xs bg-card px-2 py-1 text-[12px] text-ink-2 hover:bg-hover"
      >
        <Paperclip size={12} strokeWidth={1.9} />
        {busy ? "上傳中…" : "選擇檔案"}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        multiple
        disabled={busy}
        onChange={(e) => void pick(e.target.files)}
        className="hidden"
      />
      {error !== null ? <span className="text-[13px] text-er">{error}</span> : null}
    </div>
  )
}
