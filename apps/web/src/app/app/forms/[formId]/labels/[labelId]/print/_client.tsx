"use client"

import { Printer } from "lucide-react"
import { useParams, useSearchParams } from "next/navigation"
import { type ReactNode, useMemo } from "react"
import { formatFieldValue } from "@/app/app/builder/_components/field-value"
import { BarcodeView, fieldSymbology } from "@/lib/engine/barcode"
import { useForm, useLabels, useRecords } from "@/lib/engine/hooks"
import {
  type FieldDto,
  type LabelConfig,
  MAX_COPIES_PER_RECORD,
  MAX_LABELS_PER_RUN,
  type RecordRow,
} from "@/lib/engine/schemas"

/* R1·後續-2 M3 標籤列印頁。A4 平舖(或一頁一標籤)+ `@page` 樣式 → 瀏覽器列印/另存 PDF
   (OQ-PM-3:紙張/邊界/方向委派瀏覽器)。批次來源 = ?ids= 勾選 或 當前表全部。
   硬上限 MAX_LABELS_PER_RUN,超量**明示不靜默截斷**(OQ-PM-7)。 */

interface LabelUnit {
  readonly key: string
  readonly record: RecordRow
}

function copiesOf(config: LabelConfig, record: RecordRow): number {
  if (config.copiesField === undefined) return 1
  const raw = record.values[config.copiesField]
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n)) return 1
  return Math.max(0, Math.min(MAX_COPIES_PER_RECORD, Math.floor(n)))
}

export function LabelPrintClient(): ReactNode {
  const params = useParams<{ formId: string; labelId: string }>()
  const search = useSearchParams()
  const formId = Number(params.formId)
  const labelId = Number(params.labelId)
  const idsParam = search.get("ids")

  const { data: form } = useForm(Number.isSafeInteger(formId) ? formId : null)
  const { data: labels } = useLabels(Number.isSafeInteger(formId) ? formId : null)
  const { data: resp, isPending } = useRecords(Number.isSafeInteger(formId) ? formId : null)

  const label = (labels ?? []).find((l) => l.id === labelId) ?? null
  const config = label?.config ?? null

  const selectedIds = useMemo(() => {
    if (idsParam === null || idsParam === "") return null
    return new Set(
      idsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isSafeInteger(n)),
    )
  }, [idsParam])

  const { units, truncated, total } = useMemo(() => {
    if (config === null) return { units: [] as LabelUnit[], truncated: false, total: 0 }
    const records = (resp?.records ?? []).filter(
      (r) => selectedIds === null || selectedIds.has(r.id),
    )
    const out: LabelUnit[] = []
    let count = 0
    for (const record of records) {
      const copies = copiesOf(config, record)
      for (let i = 0; i < copies; i++) {
        count += 1
        if (out.length < MAX_LABELS_PER_RUN) out.push({ key: `${record.id}-${i}`, record })
      }
    }
    return { units: out, truncated: count > MAX_LABELS_PER_RUN, total: count }
  }, [config, resp, selectedIds])

  if (form === undefined || label === null || config === null) {
    return (
      <div className="p-6 text-[12px] text-ink-3">{isPending ? "載入中…" : "找不到標籤定義"}</div>
    )
  }

  const fieldByName = new Map(form.fields.map((f) => [f.name, f]))
  const pageStyle = `@page { size: A4; margin: 8mm; }`

  return (
    <div className="min-h-dvh bg-surface">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 固定常數 @page 規則,無使用者輸入 */}
      <style dangerouslySetInnerHTML={{ __html: pageStyle }} />

      <div
        data-noprint
        className="flex items-center gap-3 border-b border-line bg-card px-4 py-2 text-[12px]"
      >
        <span className="font-semibold text-ink-2">{label.name}</span>
        <span className="font-mono text-[11px] text-ink-4">
          {units.length} 張{config.tile ? " · 平舖" : " · 一頁一張"}
        </span>
        {truncated ? (
          <span className="rounded-xs border border-warn-line bg-warn-t px-2 py-0.5 text-[11px] text-warn">
            共 {total} 張,超過單次上限 {MAX_LABELS_PER_RUN} 張 —— 僅顯示前 {MAX_LABELS_PER_RUN}{" "}
            張,請縮小篩選或分批列印
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-1 rounded-xs bg-primary px-3 py-1 text-[11.5px] font-medium text-white hover:bg-primary-d"
        >
          <Printer size={13} />
          列印
        </button>
      </div>

      {units.length === 0 ? (
        <div className="p-6 text-[12px] text-ink-4">無可列印的記錄。</div>
      ) : (
        <div
          data-testid="label-sheet"
          className="flex flex-wrap p-2 print:p-0"
          style={{ gap: `${config.gapMm}mm` }}
        >
          {units.map((u) => (
            <div
              key={u.key}
              data-testid="label-unit"
              className="flex flex-col justify-center overflow-hidden border border-line bg-card px-2 py-1 print:border-line-2"
              style={{
                width: `${config.size.widthMm}mm`,
                height: `${config.size.heightMm}mm`,
                ...(config.tile ? {} : { breakAfter: "page" }),
              }}
            >
              {config.items.map((item) => {
                const field = fieldByName.get(item.field)
                if (field === undefined) return null // 欄位已刪 → 略過(FMEA P5)
                return (
                  <LabelLine
                    key={item.field}
                    field={field}
                    item={item}
                    value={u.record.values[item.field]}
                    showName={config.showFieldNames}
                  />
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LabelLine({
  field,
  item,
  value,
  showName,
}: {
  readonly field: FieldDto
  readonly item: LabelConfig["items"][number]
  readonly value: unknown
  readonly showName: boolean
}): ReactNode {
  const asQr = item.asQr === true || field.type === "barcode"
  const style = item.style ?? {}
  if (asQr) {
    return (
      <span className="flex items-center gap-1">
        {showName ? <span className="text-[8px] text-ink-4">{field.name}</span> : null}
        <BarcodeView value={value} symbology={fieldSymbology(field) ?? "qr"} size={48} />
      </span>
    )
  }
  const display = formatFieldValue(field, value)
  return (
    <span
      className={style.wrap === true ? "break-words" : "truncate"}
      style={{
        fontSize: `${style.size ?? 11}px`,
        textAlign: style.align ?? "left",
        fontWeight: style.bold === true ? 600 : 400,
      }}
    >
      {showName ? <span className="mr-1 text-ink-4">{field.name}</span> : null}
      {display === "—" ? "" : display}
    </span>
  )
}
