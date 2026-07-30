"use client"

import { Select } from "@weyver/ui/select"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { formatFieldValue } from "@/components/form/value"
import { useMemberNames } from "@/lib/engine/authz"
import { useCalendarRange } from "@/lib/engine/hooks"
import type { FieldDto, FormDto, RecordRow } from "@/lib/engine/schemas"

/* 🔴 F-1 M4 行事曆。**不是 group-by** —— 是區間重疊查詢,一筆可橫跨多格。

   **時區**|以 RFC 5545 為錨:`date` 欄是全天事件、無時區(floating);
   `dateTime` 由後端依**租戶時區**分桶(不是瀏覽器時區)。
   Airtable 依瀏覽器時區導致的「差一天」是這類功能的經典抱怨,故日期一律以
   字串 `YYYY-MM-DD` 在前後端之間傳遞,前端不做任何 Date 物件的時區轉換。

   **範圍**|半開區間 `[from, to)`,to 排他(同 Google Calendar API)。 */

export function canUseAsCalendarField(f: FieldDto): boolean {
  return f.type === "date" || f.type === "dateTime"
}

/* 以純字串運算月曆格,完全避開 Date 的時區陷阱 */
function ymd(y: number, m: number, d: number): string {
  return `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
function weekdayOfFirst(y: number, m: number): number {
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
}

const MAX_PER_DAY = 3

export function CalendarView({
  formId,
  form,
  onOpen,
}: {
  readonly formId: number
  readonly form: FormDto
  readonly onOpen: (id: number) => void
}): ReactNode {
  const dateFields = form.fields.filter(canUseAsCalendarField)
  const [startName, setStartName] = useState(dateFields[0]?.name ?? "")
  const [endName, setEndName] = useState("")
  const now = new Date()
  const [year, setYear] = useState(now.getUTCFullYear())
  const [month, setMonth] = useState(now.getUTCMonth() + 1)
  const memberNames = useMemberNames(form.fields)

  const from = ymd(year, month, 1)
  const to =
    month === 12 ? ymd(year + 1, 1, 1) : ymd(year, month + 1, 1) /* 排他上界 */

  const params =
    startName === ""
      ? null
      : { startField: startName, endField: endName === "" ? undefined : endName, from, to }
  const { data, isPending } = useCalendarRange(formId, params)

  /* 把記錄攤到每一天 —— 跨日事件會出現在多格(這正是 group-by 做不到的) */
  const byDay = useMemo(() => {
    const m = new Map<string, RecordRow[]>()
    for (const r of data?.records ?? []) {
      const s = String(r.values[startName] ?? "").slice(0, 10)
      if (s === "") continue
      const e = endName === "" ? s : String(r.values[endName] ?? s).slice(0, 10) || s
      for (let d = 1; d <= daysInMonth(year, month); d++) {
        const key = ymd(year, month, d)
        if (key >= s && key <= e) {
          const list = m.get(key) ?? []
          list.push(r)
          m.set(key, list)
        }
      }
    }
    return m
  }, [data, startName, endName, year, month])

  if (dateFields.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-ink-3">
        行事曆需要一個「日期」或「日期時間」欄位。
        <br />
        請先到設計器新增,例如「下單日」或「到期日」。
      </div>
    )
  }

  const lead = weekdayOfFirst(year, month)
  const total = daysInMonth(year, month)
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ]

  const shift = (delta: number): void => {
    const m = month + delta
    if (m < 1) {
      setYear(year - 1)
      setMonth(12)
    } else if (m > 12) {
      setYear(year + 1)
      setMonth(1)
    } else setMonth(m)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-card px-4">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="上個月"
          className="text-ink-3 hover:text-primary"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="w-24 text-center font-mono text-[12px] text-ink">
          {year} / {String(month).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="下個月"
          className="text-ink-3 hover:text-primary"
        >
          <ChevronRight size={15} />
        </button>

        <span className="ml-3 text-[11.5px] text-ink-2">日期欄</span>
        <Select
          className="h-7 w-32"
          aria-label="行事曆日期欄"
          value={startName}
          onChange={(e) => setStartName(e.target.value)}
        >
          {dateFields.map((f) => (
            <option key={f.id} value={f.name}>
              {f.name}
            </option>
          ))}
        </Select>
        <span className="text-[11.5px] text-ink-2">結束</span>
        <Select
          className="h-7 w-32"
          aria-label="行事曆結束欄"
          value={endName}
          onChange={(e) => setEndName(e.target.value)}
        >
          <option value="">(單日)</option>
          {dateFields
            .filter((f) => f.name !== startName)
            .map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
        </Select>
        {data?.truncated === true ? (
          <span className="ml-auto text-[11px] text-warn">
            本月事件過多,僅顯示前 1000 筆
          </span>
        ) : null}
      </div>

      {isPending ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-ink-4">載入…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="grid grid-cols-7 gap-px bg-line">
            {["日", "一", "二", "三", "四", "五", "六"].map((w) => (
              <div key={w} className="bg-head px-2 py-1 text-center text-[11px] text-ink-3">
                {w}
              </div>
            ))}
            {cells.map((d, i) => {
              const key = d === null ? `blank-${String(i)}` : ymd(year, month, d)
              const rows = d === null ? [] : (byDay.get(key) ?? [])
              return (
                <div
                  key={key}
                  className={`min-h-20 bg-card p-1 ${d === null ? "opacity-40" : ""}`}
                >
                  {d === null ? null : (
                    <>
                      <div className="mb-0.5 text-right font-mono text-[10.5px] text-ink-4">{d}</div>
                      {rows.slice(0, MAX_PER_DAY).map((r) => (
                        <button
                          key={`${key}-${String(r.id)}`}
                          type="button"
                          onClick={() => onOpen(r.id)}
                          className="mb-0.5 block w-full truncate border border-line bg-surface px-1 py-0.5 text-left text-[10.5px] text-ink hover:border-primary"
                        >
                          {formatFieldValue(
                            form.fields[0] as FieldDto,
                            r.values[form.fields[0]?.name ?? ""],
                            memberNames,
                          ) || `#${String(r.id)}`}
                        </button>
                      ))}
                      {/* 每日顯示上限 + N more(對齊 Airtable / NocoDB) */}
                      {rows.length > MAX_PER_DAY ? (
                        <div className="text-[10px] text-ink-4">
                          +{rows.length - MAX_PER_DAY} 筆
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
