import type { InputHTMLAttributes, ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §2.6|輸入高 26-28px、方角 2px、框線 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly icon?: ReactNode
}

export function Input({ className, icon, type = "text", ...props }: InputProps): ReactElement {
  return (
    <div
      className={cn(
        /* min-h 而非 h —— WCAG 1.4.12:使用者加大行高/字距時版面不得裁切 */
        "flex min-h-[27px] items-center gap-1.5 rounded-xs border border-line-input bg-card px-2 text-[13px]",
        /* 🔴 2026-08-08|focus 由「換框色」改為 **outline 2px 主色**(brand-pilot 輸入矩陣)。
           換框色的問題是它與 rest 只差一個顏色,在 1px 上幾乎看不出來;
           outline 疊在框外,不動盒模型也不會讓內容位移。
           ⚠️ 框線**維持 prod 的 `line-input`(#8d8d8d,3.26:1)不照稿** ——
           稿的框是 `Ink /.14`,疊在卡片上實測僅 **1.32:1**,
           低於 WCAG 1.4.11 非文字元件的 3:1。`contrast.test.ts:121` 正是擋這件事的守衛。 */
        "focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary",
        /* 🔴 2026-08-08 M3:原本只有 rest 與 focus 兩態,停用與錯誤都沒有。
           後果不是「少了樣式」而是**呼叫端各自發明** —— date-input 自己造了一套
           錯誤框,其他呼叫端則什麼都沒有。元件不給的狀態,漂移就從那裡進來。 */
        /* 停用同 Button:壓成固定灰而非降透明度(半透明會透出底色,同一顆在不同底上長不一樣)。 */
        "has-[input:disabled]:bg-head has-[input:disabled]:text-ink-disabled",
        "has-[input[aria-invalid=true]]:border-er",
        className,
      )}
    >
      {icon ? <span className="text-ink-3 [&_svg]:size-3">{icon}</span> : null}
      <input
        type={type}
        /* placeholder 用 `ink-disabled`(Neutral 3.85:1)照稿 —— 它是「還沒填」不是「說明文字」,
           與 `ink-3`(輔助說明)分開才看得出差別。 */
        className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-disabled focus:outline-none"
        {...props}
      />
    </div>
  )
}
