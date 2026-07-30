"use client"

import { Button } from "@weyver/ui/button"
import { Select } from "@weyver/ui/select"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { type ReactNode, useState } from "react"
import { z } from "zod"
import { describeEngineError, engineFetch } from "@/lib/engine/client"
import { BUILDABLE_TYPES, fieldTypeMeta } from "@/lib/engine/field-types"

/* 🔴 型別轉換(#105 四態)。

   **兩個數字分開顯示,不合併** —— Airtable 的真實事故不是清空而是**靜默改值**
   (大整數被 JS 精度改掉),使用者根本不會發現。把兩者併成一個 N 等於把最危險的
   那一類藏起來。樣本值同理:讓人看見「哪些值會不見」,而不只是一個數字。

   **可還原** —— Ragic 的型別轉換是非破壞性的(改回去值就回來),客戶的心智是
   「改型別可以隨便試」。我們的物理型別真的變了,靠快照補回這個體驗。 */

const previewSchema = z.object({
  kind: z.enum(["safe-metadata", "safe-rewrite", "lossy", "forbidden"]),
  note: z.string().optional(),
  totalNonNull: z.number(),
  willBeNulled: z.number(),
  willBeAltered: z.number(),
  samples: z.array(z.string()),
})
type Preview = z.infer<typeof previewSchema>

const DATE_FORMATS = ["YYYY-MM-DD", "YYYY/MM/DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const

const KIND_LABEL: Record<Preview["kind"], string> = {
  "safe-metadata": "可直接轉換(不動資料)",
  "safe-rewrite": "可轉換(需重寫欄位,資料不會遺失)",
  lossy: "會影響既有資料",
  forbidden: "不支援此轉換",
}

export function ConvertTypePanel({
  formId,
  fieldId,
  currentType,
  onConverted,
}: {
  readonly formId: number
  readonly fieldId: number
  readonly currentType: string
  readonly onConverted: () => void
}): ReactNode {
  const [target, setTarget] = useState("")
  const [dateFormat, setDateFormat] = useState<string>(DATE_FORMATS[0])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [lastConversion, setLastConversion] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsDateFormat = target === "date" || target === "dateTime"
  const body = (): Record<string, unknown> => ({
    type: target,
    ...(needsDateFormat ? { dateFormat } : {}),
  })

  const run = async (path: string): Promise<unknown> => {
    setBusy(true)
    setError(null)
    try {
      return await engineFetch(path, z.unknown(), { method: "POST", body: body() })
    } finally {
      setBusy(false)
    }
  }

  const doPreview = async (): Promise<void> => {
    try {
      setPreview(
        previewSchema.parse(
          await run(`/forms/${formId}/fields/${fieldId}/convert/preview`),
        ),
      )
    } catch (e) {
      setError(describeEngineError(e))
    }
  }

  const doConvert = async (): Promise<void> => {
    try {
      const res = (await run(`/forms/${formId}/fields/${fieldId}/convert`)) as {
        conversionId?: number
      }
      setLastConversion(res.conversionId ?? null)
      setPreview(null)
      setTarget("")
      onConverted()
    } catch (e) {
      setError(describeEngineError(e))
    }
  }

  const doRevert = async (): Promise<void> => {
    if (lastConversion === null) return
    setBusy(true)
    setError(null)
    try {
      await engineFetch(
        `/forms/${formId}/fields/${fieldId}/convert/${lastConversion}/revert`,
        z.unknown(),
        { method: "POST" },
      )
      setLastConversion(null)
      onConverted()
    } catch (e) {
      setError(describeEngineError(e))
    } finally {
      setBusy(false)
    }
  }

  const blocked = preview?.kind === "forbidden"

  return (
    <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
      <span className="text-[10.5px] text-ink-4">變更欄位型別</span>

      {error !== null ? (
        <div className="border border-er/40 bg-er/5 px-2 py-1 text-[10.5px] text-er">{error}</div>
      ) : null}

      <div className="flex items-center gap-1.5">
        <Select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value)
            setPreview(null)
          }}
          className="h-7 flex-1"
          aria-label="目標型別"
        >
          <option value="">選擇型別…</option>
          {BUILDABLE_TYPES.filter((t) => t !== currentType).map((t) => (
            <option key={t} value={t}>
              {fieldTypeMeta(t).label}
            </option>
          ))}
        </Select>
        <Button onClick={() => void doPreview()} disabled={target === "" || busy}>
          {busy ? "檢查中…" : "預覽"}
        </Button>
      </div>

      {needsDateFormat ? (
        <label className="flex items-center gap-1.5 text-[11px] text-ink-2">
          日期格式
          <Select
            value={dateFormat}
            onChange={(e) => {
              setDateFormat(e.target.value)
              setPreview(null)
            }}
            className="h-7 w-36"
            aria-label="日期格式"
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {preview !== null ? (
        <div
          className={`space-y-1.5 border px-2.5 py-2 text-[11px] ${
            preview.kind === "lossy" || blocked
              ? "border-warn/40 bg-warn/5"
              : "border-line bg-surface"
          }`}
        >
          <div className="flex items-center gap-1.5 text-ink">
            {preview.kind === "lossy" || blocked ? (
              <AlertTriangle size={12} className="shrink-0 text-warn" />
            ) : null}
            {KIND_LABEL[preview.kind]}
          </div>
          {preview.note !== undefined ? (
            <div className="text-ink-3">{preview.note}</div>
          ) : null}

          {blocked ? null : (
            <div className="flex flex-wrap gap-3 text-ink-2">
              {/* 🔴 兩個數字分開 —— 「被清空」與「被改變」的嚴重度不同 */}
              <span>
                將被清空 <b className={preview.willBeNulled > 0 ? "text-er" : ""}>{preview.willBeNulled}</b>
              </span>
              <span>
                值會被改變 <b className={preview.willBeAltered > 0 ? "text-warn" : ""}>{preview.willBeAltered}</b>
              </span>
              <span className="text-ink-4">共 {preview.totalNonNull} 筆有值</span>
            </div>
          )}

          {preview.samples.length > 0 ? (
            <div className="text-ink-4">
              會不見的值:{preview.samples.slice(0, 5).join("、")}
              {preview.samples.length > 5 ? "…" : ""}
            </div>
          ) : null}

          {blocked ? null : (
            <Button variant="primary" onClick={() => void doConvert()} disabled={busy}>
              {preview.kind === "lossy" ? "我了解,仍要轉換" : "確認轉換"}
            </Button>
          )}
        </div>
      ) : null}

      {lastConversion !== null ? (
        <button
          type="button"
          onClick={() => void doRevert()}
          disabled={busy}
          className="flex w-fit items-center gap-1 text-[11.5px] text-primary hover:underline"
        >
          <RotateCcw size={12} />
          還原上次轉換(原值保留 30 天)
        </button>
      ) : null}
    </div>
  )
}
