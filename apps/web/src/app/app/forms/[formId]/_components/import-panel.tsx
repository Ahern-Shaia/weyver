"use client"

import { analyzeImport, describeEngineError, engineFetch } from "@/lib/engine/client"
import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { AlertTriangle, Download, Upload, X } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import { z } from "zod"
import { downloadErrorsCsv } from "./import-errors-csv"

/* 🔴 匯入既有表單(#106 M2)。入口在**記錄列表頁**而非設計器 ——
   Ragic 官方的匯入主入口就是「既有 sheet 的列表頁 → Tools → Import Data From File」,
   遷移之後客戶每天在做的是這件事。

   解析在後端(OQ-IMP-6),前端只上傳、顯示對映、跑 dry-run、確認。 */

const analyzeSchema = z.object({
  sheetNames: z.array(z.string()),
  sheetName: z.string(),
  headerRowIndex: z.number(),
  columns: z.array(z.string()),
  totalRows: z.number(),
  truncated: z.boolean(),
  mergedCells: z.number().default(0),
  maxRows: z.number(),
  preview: z.array(z.record(z.string(), z.string())),
  rows: z.array(z.record(z.string(), z.string())),
  suggestedMapping: z.record(z.string(), z.string()),
  fields: z.array(z.string()),
})
type Analyzed = z.infer<typeof analyzeSchema>

const planSchema = z.object({
  planHash: z.string(),
  totals: z.object({
    rows: z.number(),
    toInsert: z.number(),
    toUpdate: z.number(),
    unchanged: z.number(),
    errors: z.number(),
    skipped: z.number(),
  }),
  impact: z.object({
    fieldsToClear: z.number(),
    recordsAffected: z.number(),
    existingTotal: z.number(),
    needsConfirm: z.boolean(),
  }),
  blockers: z.array(z.object({ code: z.string(), message: z.string() })),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  rowErrors: z.array(
    z.object({
      sourceRowNo: z.number(),
      errorCode: z.string().optional(),
      errorMessage: z.string().optional(),
    }),
  ),
})
type Planned = z.infer<typeof planSchema>

const POLICIES = [
  { value: "upsert", label: "更新既有並新增" },
  { value: "insert_only", label: "只新增" },
  { value: "update_only", label: "只更新不新增" },
  { value: "insert_new_only", label: "只匯入新的" },
] as const

const SKIP = "__skip__"

export function ImportPanel({
  formId,
  formName,
  onDone,
  onClose,
}: {
  readonly formId: number
  readonly formName: string
  readonly onDone: () => void
  readonly onClose: () => void
}): ReactNode {
  const [file, setFile] = useState<File | null>(null)
  const [sheet, setSheet] = useState<Analyzed | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [policy, setPolicy] = useState<string>("upsert")
  const [matchField, setMatchField] = useState("")
  const [blankPolicy, setBlankPolicy] = useState<"keep" | "clear">("keep")
  const [clearConfirm, setClearConfirm] = useState("")
  const [impactAck, setImpactAck] = useState(false)
  const [planned, setPlanned] = useState<Planned | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async (picked: File, wanted?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setPlanned(null)
    try {
      const parsed = analyzeSchema.parse(await analyzeImport(formId, picked, wanted))
      setSheet(parsed)
      setFile(picked)
      setMapping(parsed.suggestedMapping)
      const firstMapped = Object.values(parsed.suggestedMapping)[0]
      setMatchField(firstMapped ?? "")
    } catch (e) {
      setError(describeEngineError(e))
    } finally {
      setBusy(false)
    }
  }

  const buildPlan = (): Record<string, unknown> => ({
    policy,
    matchFields: policy === "insert_only" || matchField === "" ? [] : [matchField],
    mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== SKIP && v !== "")),
    blankPolicy,
    rows: sheet?.rows ?? [],
  })

  const preview = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setImpactAck(false)
      setPlanned(
        planSchema.parse(
          await engineFetch(`/forms/${formId}/import/plan`, z.unknown(), {
            method: "POST",
            body: buildPlan(),
          }),
        ),
      )
    } catch (e) {
      setError(describeEngineError(e))
    } finally {
      setBusy(false)
    }
  }

  const run = async (): Promise<void> => {
    if (planned === null) return
    setBusy(true)
    setError(null)
    try {
      const done = (await engineFetch(`/forms/${formId}/import/commit`, z.unknown(), {
        method: "POST",
        /* confirmFormName 後端也驗 —— 前端的確認對話框擋不住直接打 API 的人。
           idempotencyKey:網路重試不該匯入兩次(planHash 相同即同一份計畫)。 */
        body: {
          planHash: planned.planHash,
          plan: buildPlan(),
          ...(blankPolicy === "clear" ? { confirmFormName: clearConfirm } : {}),
        },
        idempotencyKey: `import:${String(formId)}:${planned.planHash}`,
      })) as { inserted: number; updated: number; unchanged: number }
      setResult(
        `完成:新增 ${String(done.inserted)} 筆、更新 ${String(done.updated)} 筆、未變動 ${String(done.unchanged)} 筆`,
      )
      onDone()
    } catch (e) {
      setError(describeEngineError(e))
    } finally {
      setBusy(false)
    }
  }

  /* 🔴 清空既有值需打字輸入表單名稱(OQ-IMP-2)。
     Shopify 無任何確認就把空白欄覆蓋掉,是其商家大量中招的來源。 */
  const clearBlocked = blankPolicy === "clear" && clearConfirm.trim() !== formName
  /* §4.2「更新影響 >20% 或 >1000 筆 → 警 + 二次確認」。
     大量更新與少量更新在畫面上長得一模一樣,不擋一下使用者不會發現動到了大半張表。 */
  const impactBlocked = planned?.impact.needsConfirm === true && !impactAck
  const canRun =
    planned !== null &&
    planned.blockers.length === 0 &&
    !clearBlocked &&
    !impactBlocked &&
    !busy &&
    result === null

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <b className="text-[13px] font-semibold text-ink">匯入資料到「{formName}」</b>
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="ml-auto text-ink-3 hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[860px] space-y-4">
          {error !== null ? (
            <div className="border border-er/40 bg-er/5 px-3 py-2 text-[14px] text-er">{error}</div>
          ) : null}
          {result !== null ? (
            <div className="border border-ok/40 bg-ok/5 px-3 py-2 text-[12px] text-ink">
              {result}
            </div>
          ) : null}

          {sheet === null ? (
            <div className="flex flex-col items-center gap-3 border border-dashed border-line py-12">
              <Upload size={20} className="text-ink-3" />
              <p className="text-[12px] text-ink-3">選擇 Excel(.xlsx / .xls)檔案</p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0]
                  if (picked !== undefined) void load(picked)
                }}
              />
              <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? "解析中…" : "選擇檔案"}
              </Button>
            </div>
          ) : (
            <>
              {/* 工作表 + 標題列偵測結果 */}
              <div className="flex flex-wrap items-end gap-3">
                {sheet.sheetNames.length > 1 ? (
                  <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                    工作表
                    <Select
                      value={sheet.sheetName}
                      onChange={(e) => {
                        if (file !== null) void load(file, e.target.value)
                      }}
                      className="h-7 w-48"
                    >
                      {sheet.sheetNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : null}
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  匯入方式
                  <Select
                    value={policy}
                    onChange={(e) => {
                      setPolicy(e.target.value)
                      setPlanned(null)
                    }}
                    className="h-7 w-44"
                    aria-label="匯入方式"
                  >
                    {POLICIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </label>
                {policy === "insert_only" ? null : (
                  <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                    比對欄位
                    <Select
                      value={matchField}
                      onChange={(e) => {
                        setMatchField(e.target.value)
                        setPlanned(null)
                      }}
                      className="h-7 w-44"
                      aria-label="比對欄位"
                    >
                      <option value="">請選擇</option>
                      {sheet.fields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
              </div>

              <div className="space-y-1 text-[12px] text-ink-3">
                <div>
                  共 {sheet.totalRows} 列;標題在第 {sheet.headerRowIndex} 列。
                </div>
                {sheet.truncated ? (
                  <div className="flex items-center gap-1.5 text-warn">
                    <AlertTriangle size={12} />
                    超過單次上限 {sheet.maxRows} 列,本次只會匯入前 {sheet.maxRows} 列。
                  </div>
                ) : null}
              </div>

              {/* 欄位對映 */}
              <div className="border border-line">
                <div className="grid grid-cols-[1fr_1fr_2fr] gap-2 border-b border-line bg-label px-3 py-1.5 text-[12px] text-ink-3">
                  <span>檔案欄位</span>
                  <span>對應到</span>
                  <span>資料範例</span>
                </div>
                {sheet.columns.map((column) => (
                  <div
                    key={column}
                    className="grid grid-cols-[1fr_1fr_2fr] items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0"
                  >
                    <span className="truncate text-[12px] text-ink">{column}</span>
                    <Select
                      value={mapping[column] ?? SKIP}
                      onChange={(e) => {
                        setMapping((prev) => ({ ...prev, [column]: e.target.value }))
                        setPlanned(null)
                      }}
                      className="h-7"
                      aria-label={`${column} 對應欄位`}
                    >
                      <option value={SKIP}>不匯入</option>
                      {sheet.fields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                    <span className="truncate text-[12px] text-ink-3">
                      {sheet.preview
                        .slice(0, 3)
                        .map((r) => r[column] ?? "")
                        .filter((v) => v !== "")
                        .join("、")}
                    </span>
                  </div>
                ))}
              </div>

              {/* 空白格政策 */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={blankPolicy === "clear"}
                    onChange={(e) => {
                      setBlankPolicy(e.target.checked ? "clear" : "keep")
                      setClearConfirm("")
                      setPlanned(null)
                    }}
                    className="accent-(--color-primary)"
                  />
                  檔案中留空的格子,清空既有記錄的該欄位
                </label>
                <p className="text-[12px] text-ink-3">
                  預設不清空 —— 留空多半代表「這次沒有要改這一欄」,而不是「要把它清掉」。
                </p>
                {blankPolicy === "clear" ? (
                  <div className="space-y-1 border border-warn/40 bg-warn/5 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[12px] text-ink">
                      <AlertTriangle size={12} className="text-warn" />
                      這會刪除既有資料且無法從檔案還原。請輸入表單名稱「{formName}」以確認。
                    </div>
                    <Input
                      value={clearConfirm}
                      onChange={(e) => setClearConfirm(e.target.value)}
                      placeholder={formName}
                      className="h-7 max-w-[280px]"
                      aria-label="輸入表單名稱以確認清空"
                    />
                  </div>
                ) : null}
              </div>

              {/* dry-run 結果 */}
              {planned !== null ? (
                <div className="space-y-2 border border-line p-3">
                  <div className="flex flex-wrap gap-4 text-[12px] text-ink">
                    <span>
                      將新增 <b>{planned.totals.toInsert}</b>
                    </span>
                    <span>
                      將更新 <b>{planned.totals.toUpdate}</b>
                    </span>
                    <span className="text-ink-3">未變動 {planned.totals.unchanged}</span>
                    <span className="text-ink-3">略過 {planned.totals.skipped}</span>
                    {planned.totals.errors > 0 ? (
                      <span className="text-er">錯誤 {planned.totals.errors}</span>
                    ) : null}
                  </div>
                  {planned.impact.fieldsToClear > 0 ? (
                    <div className="text-[12px] text-warn">
                      將清空 {planned.impact.fieldsToClear} 個欄位值。
                    </div>
                  ) : null}
                  {planned.blockers.map((b) => (
                    <div key={b.code} className="text-[13px] text-er">
                      {b.message}
                    </div>
                  ))}
                  {sheet.mergedCells > 0 ? (
                    <div className="text-[12px] text-warn">
                      偵測到 {sheet.mergedCells} 個合併儲存格,已用左上角的值填滿 ——
                      請確認下方預覽是否符合預期。
                    </div>
                  ) : null}
                  {planned.warnings.map((w) => (
                    <div key={w.code} className="text-[12px] text-warn">
                      {w.message}
                    </div>
                  ))}
                  {planned.impact.needsConfirm ? (
                    <label className="flex items-start gap-1.5 border border-warn/40 bg-warn/5 px-3 py-2 text-[12px] text-ink">
                      <input
                        type="checkbox"
                        checked={impactAck}
                        onChange={(e) => setImpactAck(e.target.checked)}
                        className="mt-0.5 accent-(--color-primary)"
                      />
                      <span>
                        我確認要更新 {planned.totals.toUpdate} 筆
                        {planned.impact.existingTotal > 0
                          ? `(既有共 ${planned.impact.existingTotal} 筆)`
                          : ""}
                      </span>
                    </label>
                  ) : null}
                  {planned.rowErrors.slice(0, 5).map((r) => (
                    <div key={r.sourceRowNo} className="text-[12px] text-ink-3">
                      第 {r.sourceRowNo} 列:{r.errorMessage ?? r.errorCode}
                    </div>
                  ))}
                  {/* 🔴 錯誤列可下載:只顯示前 5 列等於叫使用者自己去猜其餘幾百列是哪些。
                      要修檔案就得知道全部,這是 Excel 遷移的實際工作方式。 */}
                  {planned.rowErrors.length > 0 ? (
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => downloadErrorsCsv(planned.rowErrors)}
                    >
                      <Download size={11} className="mr-1" />
                      下載錯誤列(共 {planned.rowErrors.length} 列)
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {sheet !== null ? (
        <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line px-4">
          <Button onClick={onClose}>取消</Button>
          <Button onClick={() => void preview()} disabled={busy || result !== null}>
            {busy ? "檢查中…" : "預覽結果"}
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={!canRun}>
            確認匯入
          </Button>
        </div>
      ) : null}
    </div>
  )
}
