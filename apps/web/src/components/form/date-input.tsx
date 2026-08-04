"use client"

import {
  dateFormatOfField,
  formatYmd,
  monthGrid,
  parseLooseDate,
  shiftDays,
  shiftMonths,
  todayYmd,
} from "@/lib/engine/date-parse"
import { useDisplayCtx } from "@/lib/engine/use-settings"
import { CalendarDays } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"

/* 🔴 R1·FMT M3|自製日期輸入。**取代原生 `<input type="date">`。**

   原生控件同時輸掉兩件事:
   1. **格式不在我們手上** —— 量測(模組文件 §0.3-bis):同一份 HTML 只換瀏覽器語系,
      zh-TW 顯示 `2026/03/05`、en-US 顯示 `03/05/2026`、de-DE 顯示 `05.03.2026`。
      頁面的 `lang` 完全不影響它,`navigator.language` 甚至可能與控件實際格式不一致。
   2. **不能打字** —— 只能一格一格填或用選擇器點。

   Ragic 的日期欄兩件都有:接受 `20151022` / `1022` / `22`,顯示依欄位格式。

   ⚠️ **窄螢幕保留原生控件**(§9 D2):行動裝置的原生日期輪盤是系統級體驗,
   自製的比不上,而**本模組沒有在行動裝置上量測過** —— 沒量過就不要換掉。 */

const CELL =
  "flex h-7 w-7 items-center justify-center rounded-xs text-[12px] text-ink hover:bg-hover"

export function DateInput({
  value,
  onChange,
  options,
  className,
  placeholder,
}: {
  /* 對外契約是正規 `yyyy-MM-dd`,與原生控件相同 —— `toSubmitValue` 不必改 */
  readonly value: string
  readonly onChange: (next: string) => void
  readonly options: unknown
  readonly className?: string
  readonly placeholder?: string | undefined
}): ReactNode {
  const { timeZone, locale } = useDisplayCtx()
  const format = dateFormatOfField(options)
  const boxRef = useRef<HTMLDivElement>(null)

  /* `text` = 使用者正在打的字;`null` = 沒在編輯,顯示由 value 推導。
     🔴 **解析失敗時保留使用者打的字**,不清空也不改寫 —— 見下方 commit()。 */
  const [text, setText] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(value)
  const gridRef = useRef<HTMLDivElement>(null)

  /* 🔴 只在**開啟的那一次**聚焦。寫成 `ref={(el) => el?.focus()}` 會在每次 render
     都搶一次焦點 —— 使用者按方向鍵時的重繪就會把焦點搶回去,鍵盤操作變成間歇失靈。 */
  useEffect(() => {
    if (open) gridRef.current?.focus()
  }, [open])

  const shown = text ?? (value === "" ? "" : formatYmd(value, format, locale))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const commit = (raw: string): void => {
    if (raw.trim() === "") {
      setText(null)
      setBad(false)
      onChange("")
      return
    }
    const parsed = parseLooseDate(raw, todayYmd(timeZone))
    if (!parsed.ok) {
      /* 🔴 **不清空、不猜**。同 `field-types-parity.md:409` 對 text→date 的裁定:
         「無法以指定格式解析者一律計入 will_be_nulled,即使 PG 自己猜得出來」。
         清空的話使用者打的東西就這樣不見了,而他不會知道發生什麼事。 */
      setBad(true)
      return
    }
    setBad(false)
    setText(null)
    onChange(parsed.value)
  }

  const pick = (v: string): void => {
    setBad(false)
    setText(null)
    onChange(v)
    setOpen(false)
  }

  const base = cursor === "" ? todayYmd(timeZone) : cursor
  const [gy = 0, gm = 0] = base.split("-").map(Number)
  const cells = monthGrid(gy, gm)

  /* W3C ARIA APG「Date Picker Dialog」之鍵盤配置。
     與 `frontend-uplift` M5 的 grid / listbox 同一套做法:焦點留在容器,
     用 `aria-activedescendant` 指向目前的格子,不逐格搬 DOM 焦點。 */
  const onGridKey = (e: React.KeyboardEvent): void => {
    const move = (next: string): void => {
      e.preventDefault()
      setCursor(next)
    }
    switch (e.key) {
      case "ArrowLeft":
        return move(shiftDays(base, -1))
      case "ArrowRight":
        return move(shiftDays(base, 1))
      case "ArrowUp":
        return move(shiftDays(base, -7))
      case "ArrowDown":
        return move(shiftDays(base, 7))
      case "PageUp":
        return move(shiftMonths(base, e.shiftKey ? -12 : -1))
      case "PageDown":
        return move(shiftMonths(base, e.shiftKey ? 12 : 1))
      case "Home":
        return move(`${base.slice(0, 8)}01`)
      case "End": {
        const last = cells.filter((c) => c !== null).at(-1)
        return last === undefined ? undefined : move(last)
      }
      case "Enter":
      case " ":
        e.preventDefault()
        return pick(base)
      case "Escape":
        e.preventDefault()
        setOpen(false)
        return
      default:
        return
    }
  }

  return (
    <>
      {/* 🔴 §9 D2:窄螢幕保留原生控件。行動裝置的日期輪盤是系統級體驗,自製的比不上,
          而**本模組沒有在行動裝置上量測過** —— 沒量過就不要換掉。
          兩者的對外契約相同(`yyyy-MM-dd`),所以可以純用 CSS 分流,
          與 `record-list.tsx` 的 `hidden md:flex` 同一套做法。 */}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`md:hidden ${className ?? ""}`}
      />
      <div ref={boxRef} className={`relative hidden items-center md:flex ${className ?? ""}`}>
        <input
          type="text"
          inputMode="numeric"
          value={shown}
          aria-invalid={bad}
          placeholder={placeholder ?? "例:20260305 或 3/5"}
          onChange={(e) => {
            setText(e.target.value)
            setBad(false)
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit(e.currentTarget.value)
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        <button
          type="button"
          aria-label="開啟日曆"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setCursor(value)
            setOpen((v) => !v)
          }}
          className="shrink-0 px-1 text-ink-3 hover:text-primary"
        >
          <CalendarDays size={14} />
        </button>

        {/* 🔴 解析失敗要**講出來**。原生控件在這種情況是靜默不接受,
          而使用者只會看到自己打的字沒有變成日期,不知道為什麼。 */}
        {bad ? (
          <span className="absolute top-full left-0 z-10 mt-0.5 whitespace-nowrap border border-er-line bg-er-t px-1.5 py-0.5 text-[12px] text-er">
            看不懂這個日期。可以打 20260305、3/5 或 5
          </span>
        ) : null}

        {open ? (
          <div
            role="dialog"
            aria-label="選擇日期"
            className="absolute top-full right-0 z-20 mt-1 w-[232px] rounded-md border border-line bg-card p-2 shadow-overlay"
          >
            <div className="mb-1 flex items-center gap-1">
              <button
                type="button"
                aria-label="上個月"
                onClick={() => setCursor(shiftMonths(base, -1))}
                className="px-1.5 text-[12px] text-ink-3 hover:text-primary"
              >
                ‹
              </button>
              <span className="flex-1 text-center text-[12px] font-medium text-ink">
                {gy} 年 {gm} 月
              </span>
              <button
                type="button"
                aria-label="下個月"
                onClick={() => setCursor(shiftMonths(base, 1))}
                className="px-1.5 text-[12px] text-ink-3 hover:text-primary"
              >
                ›
              </button>
            </div>
            <div className="mb-0.5 grid grid-cols-7 text-center text-[12px] text-ink-3">
              {["日", "一", "二", "三", "四", "五", "六"].map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: APG 之 grid 由容器接鍵盤 */}
            <div
              role="grid"
              aria-label="日期"
              tabIndex={0}
              aria-activedescendant={`d-${base}`}
              onKeyDown={onGridKey}
              ref={gridRef}
              className="grid grid-cols-7 gap-px outline-none focus:ring-1 focus:ring-primary"
            >
              {cells.map((c, i) =>
                c === null ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 空白格沒有其他穩定鍵
                  <span key={`x${String(i)}`} className={CELL} />
                ) : (
                  <button
                    key={c}
                    id={`d-${c}`}
                    type="button"
                    role="gridcell"
                    tabIndex={-1}
                    aria-selected={c === value}
                    onClick={() => pick(c)}
                    className={`${CELL} ${
                      c === value
                        ? "bg-primary text-white"
                        : c === base
                          ? "ring-1 ring-primary ring-inset"
                          : ""
                    }`}
                  >
                    {Number(c.slice(8))}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
