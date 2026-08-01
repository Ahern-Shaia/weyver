"use client"

import { deleteFile, describeEngineError, uploadFile } from "@/lib/engine/client"
import type { AttachmentItem, FieldDto } from "@/lib/engine/schemas"
import { useFilePreview } from "@/lib/engine/use-file-preview"
import { ImagePlus, X } from "lucide-react"
import { type ReactNode, useId, useRef, useState } from "react"

/* R1·UP-4b 圖片欄輸入(OQ-IS-1=A 獨立於附件)。
   值契約與 attachment 相同 `[{key,name}]`;差別在**呈現**:縮圖網格而非檔名清單。
   預覽走 fetch→blob→objectURL(OQ-IS-3;下載端點固定 attachment disposition 不放寬)。 */

const MAX_ITEMS = 20
const DEFAULT_MAX_HEIGHT = 96

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

export function ImageThumb({
  item,
  maxHeight,
  onRemove,
}: {
  readonly item: AttachmentItem
  readonly maxHeight: number
  readonly onRemove?: () => void
}): ReactNode {
  const url = useFilePreview(item.key)
  return (
    <figure className="relative m-0 inline-flex flex-col gap-0.5">
      {url === null ? (
        <span
          className="flex w-24 items-center justify-center border border-line bg-head text-[12px] text-ink-2"
          style={{ height: maxHeight }}
        >
          載入中…
        </span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- blob objectURL 為執行期產生,
           無法走 next/image 的優化管線(其需可被伺服器取得的 URL);且圖片本就已受尺寸與張數上限約束 */
        <img
          src={url}
          alt={item.name}
          className="border border-line object-contain"
          style={{ maxHeight, maxWidth: maxHeight * 2 }}
        />
      )}
      <figcaption className="max-w-24 truncate text-[12px] text-ink-3">{item.name}</figcaption>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除 ${item.name}`}
          className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center bg-card text-ink-3 hover:text-er hover:bg-hover"
        >
          <X size={10} />
        </button>
      ) : null}
    </figure>
  )
}

export function ImageInput({
  field,
  formId,
  value,
  onChange,
}: {
  readonly field: FieldDto
  readonly formId: number
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}): ReactNode {
  const items = toItems(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const maxHeight = (field.options as { maxHeightPx?: number }).maxHeightPx ?? DEFAULT_MAX_HEIGHT

  const pick = async (files: FileList | null): Promise<void> => {
    setError(null)
    const list = files === null ? [] : [...files]
    if (list.length === 0) return
    if (items.length + list.length > MAX_ITEMS) {
      setError(`單一欄位最多 ${MAX_ITEMS} 張圖片`)
      return
    }
    setBusy(true)
    const added: AttachmentItem[] = []
    try {
      for (const file of list) {
        const uploaded = await uploadFile(formId, field.id, file)
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
    // 未綁記錄之檔案即刻軟刪;失敗不阻擋編輯(逾期未綁者由孤兒回收兜底)
    void deleteFile(key)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <ImageThumb
              key={item.key}
              item={item}
              maxHeight={maxHeight}
              onRemove={() => remove(item.key)}
            />
          ))}
        </div>
      ) : null}

      <label
        htmlFor={inputId}
        className="flex w-fit cursor-pointer items-center gap-1 rounded-xs bg-card px-2 py-1 text-[12px] text-ink-2 hover:bg-hover"
      >
        <ImagePlus size={12} strokeWidth={1.9} />
        {busy ? "上傳中…" : "選擇圖片"}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        /* F-7 OQ-IP-1=A:accept **刻意不含 image/heic** —— iOS Safari 在此情況下會自動把
           HEIC 轉成 JPEG 才送出,把解碼移到使用者裝置(伺服器端不碰 HEVC,避開專利池)。 */
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        disabled={busy}
        onChange={(e) => void pick(e.target.files)}
        className="hidden"
      />
      {error !== null ? <span className="text-[13px] text-er">{error}</span> : null}
    </div>
  )
}
