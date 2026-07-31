"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

/* R1·UX-1 M7|載入指示。

   ## 時間門檻(有出處)

   - NN/g:**<2s 不需任何載入指示**;2–10s 用指示器;>10s 須 percent-done
   - SAP Fiori:**延遲後才顯示 + 最短顯示時間**,防止一閃而過的閃爍
   - Salesforce:>300ms 才顯示

   延遲 400ms / 最短 500ms 為**本專案取值**(兩者無共識,誠實標注)。
   <400ms 完成者完全不顯示 —— 那個區間人本來就感覺是瞬時的,顯示指示器反而製造閃爍。

   ## 🔴 為什麼不用骨架屏

   Viget(n=136)三組對照中 skeleton 組**全面最差**(任務時間最久、主觀評價最負面);
   且高密度表格的骨架列高若與真實列不符,**自己就製造 CLS**。
   本專案改用「保留舊內容 + 細進度條」——不阻斷、不位移。 */

const SHOW_DELAY_MS = 400
const MIN_VISIBLE_MS = 500

export function useDelayedBusy(busy: boolean): boolean {
  const [visible, setVisible] = useState(false)
  const shownAt = useRef<number | null>(null)

  useEffect(() => {
    if (busy) {
      const t = setTimeout(() => {
        shownAt.current = Date.now()
        setVisible(true)
      }, SHOW_DELAY_MS)
      return () => clearTimeout(t)
    }
    if (shownAt.current === null) {
      setVisible(false)
      return
    }
    /* 已經顯示過 → 至少撐滿最短顯示時間再收,否則會閃一下 */
    const elapsed = Date.now() - shownAt.current
    const remain = Math.max(0, MIN_VISIBLE_MS - elapsed)
    const t = setTimeout(() => {
      shownAt.current = null
      setVisible(false)
    }, remain)
    return () => clearTimeout(t)
  }, [busy])

  return visible
}

/* 🔴 absolute 定位 —— 進度條本身不得佔版面流,否則它自己就造成位移(FMEA U8)。
   置於 relative 容器內(通常是工具列 / 區塊標頭)的底緣。 */
export function BusyBar({ busy }: { readonly busy: boolean }): ReactNode {
  const visible = useDelayedBusy(busy)
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-line-2 transition-opacity duration-[110ms] ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className="block h-full w-1/3 animate-[busyslide_1.1s_cubic-bezier(0,0,.38,.9)_infinite] bg-primary" />
    </span>
  )
}

/* 首次載入(尚無任何資料可保留)才用的佔位。
   不做骨架屏 —— 高度鎖不準會自製 CLS(見上)。純文字且保留容器高度。 */
export function FirstLoad({ label = "載入中…" }: { readonly label?: string }): ReactNode {
  return (
    <div className="flex min-h-[120px] items-center justify-center text-[13px] text-ink-3">
      {label}
    </div>
  )
}
