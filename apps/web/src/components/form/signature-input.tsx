"use client"

import { ImageThumb } from "@/components/form/image-input"
import { deleteFile, describeEngineError, uploadFile } from "@/lib/engine/client"
import type { AttachmentItem, FieldDto } from "@/lib/engine/schemas"
import { Eraser, PenLine } from "lucide-react"
import { type ReactNode, type PointerEvent as ReactPointerEvent, useRef, useState } from "react"

/* R1·UP-4b 簽名欄(OQ-IS-5=A canvas → PNG → 既有上傳管線;OQ-IS-6=A 自建零相依)。

   **這是「畫押圖片」,不是合規電子簽章**(OQ-IS-8=A)—— UI 刻意不出現「已簽署 / 具法律效力」
   等字樣,簽名亦可清除重簽(受欄位級權限與稽核約束)。不可否認性屬 R2 合規簽章(TWCA);
   核准流程之不可竄改另由 actions-approval 之記錄鎖負責。

   Pointer Events 統一滑鼠 / 觸控 / 手寫筆;`touch-action: none` 防畫線時頁面捲動(FMEA S5);
   canvas 依 devicePixelRatio 放大再以 CSS 縮回,避免高 DPI 模糊(S6)。 */

const DEFAULT_HEIGHT = 140
/* 🔴 canvas 要的是實際色值(不吃 CSS class),但**不代表要抄一份色碼**。
   原本 primary 寫死 `#0C5F73` —— 那是**深海青主題**的主色,於是不管使用者選哪個
   配色主題,簽名筆都是深海青。改讀同一組 CSS 變數,主題換了筆色跟著換。
   (同 grid-tone.ts 的處置;docs/28 §1.4) */
const PEN_VAR: Record<string, string> = { ink: "--color-ink", primary: "--color-primary" }

function penColor(key: string | undefined): string {
  const name = PEN_VAR[key ?? "ink"] ?? PEN_VAR.ink
  if (typeof window === "undefined") return "currentColor"
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name ?? "")
    .trim()
  return v === "" ? "currentColor" : v
}

function toItem(value: unknown): AttachmentItem | null {
  if (!Array.isArray(value)) return null
  const first = value[0]
  return typeof first === "object" &&
    first !== null &&
    typeof (first as { key?: unknown }).key === "string" &&
    typeof (first as { name?: unknown }).name === "string"
    ? (first as AttachmentItem)
    : null
}

export function SignatureInput({
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
  const existing = toItem(value)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const dirtyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = field.options as { penColor?: string; heightPx?: number }
  const height = options.heightPx ?? DEFAULT_HEIGHT
  const color = penColor(options.penColor)

  /* 首次互動時才依實際版面尺寸初始化(避免 SSR / 隱藏容器下寬度為 0) */
  const contextOf = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== Math.round(rect.width * ratio)) {
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
    }
    const ctx = canvas.getContext("2d")
    if (ctx === null) return null
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    return ctx
  }

  const pointAt = (canvas: HTMLCanvasElement, e: ReactPointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = contextOf(canvas)
    if (ctx === null) return
    canvas.setPointerCapture(e.pointerId)
    drawingRef.current = true
    dirtyRef.current = true
    const { x, y } = pointAt(canvas, e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext("2d")
    if (ctx === null) return
    const { x, y } = pointAt(canvas, e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const onUp = (): void => {
    drawingRef.current = false
  }

  const clear = (): void => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext("2d")
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
    dirtyRef.current = false
    setError(null)
  }

  const removeExisting = (): void => {
    if (existing !== null) void deleteFile(existing.key)
    onChange([])
    clear()
  }

  const save = (): void => {
    const canvas = canvasRef.current
    if (canvas === null || !dirtyRef.current) {
      setError("請先簽名")
      return
    }
    setBusy(true)
    setError(null)
    canvas.toBlob((blob) => {
      if (blob === null) {
        setBusy(false)
        setError("簽名轉檔失敗,請重試")
        return
      }
      const file = new File([blob], `signature-${String(field.id)}.png`, { type: "image/png" })
      uploadFile(formId, field.id, file)
        .then((uploaded) => {
          // 單張語意:新簽名取代舊的(舊檔軟刪,逾期由孤兒回收)
          if (existing !== null) void deleteFile(existing.key)
          onChange([{ key: uploaded.key, name: uploaded.name }])
          clear()
        })
        .catch((e: unknown) => setError(describeEngineError(e)))
        .finally(() => setBusy(false))
    }, "image/png")
  }

  if (existing !== null) {
    return (
      <div className="flex items-start gap-2">
        <ImageThumb item={existing} maxHeight={72} />
        <button
          type="button"
          onClick={removeExisting}
          className="flex items-center gap-1 rounded-xs bg-card px-2 py-1 text-[12px] text-ink-2 hover:bg-hover"
        >
          <Eraser size={12} strokeWidth={1.9} />
          重新簽名
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        aria-label={`${field.name} 簽名板`}
        className="w-full max-w-sm cursor-crosshair border border-line bg-card"
        style={{ height, touchAction: "none" }}
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex items-center gap-1 rounded-xs bg-primary px-2 py-1 text-[12px] font-medium text-white hover:bg-primary-d disabled:opacity-40"
        >
          <PenLine size={12} strokeWidth={1.9} />
          {busy ? "儲存中…" : "確認簽名"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="flex items-center gap-1 rounded-xs bg-card px-2 py-1 text-[12px] text-ink-2 hover:bg-hover"
        >
          <Eraser size={12} strokeWidth={1.9} />
          清除
        </button>
      </div>
      {error !== null ? <span className="text-[13px] text-er">{error}</span> : null}
      {/* 🔴 OQ-IS-8=A′(2026-08-03 重裁):**不宣稱**之外還要**明示邊界**。

          原裁定的「明文化」只落在 design doc 與元件註解 —— 使用者看不到,
          而風險發生在使用者端。本平台定位是取代 ERP,簽名欄的自然場景就是
          驗收單 / 領料單 / 點交單,把它當正式簽核憑證使用**是可預見的**。

          刻意用次要文字級、無驚嘆號、無警示色、無彈窗 ——
          那些會製造「有密碼學支撐」的錯覺,正是 OQ-IS-8 一開始就拒絕的東西。 */}
      <span className="max-w-sm text-[12px] text-ink-3">
        本欄儲存手寫簽名圖片,不含數位憑證。需具法律推定效力之簽署請改用合規電子簽章(尚未提供)。
      </span>
    </div>
  )
}
