import { ChevronDown } from "lucide-react"
import type { ReactElement, ReactNode, SelectHTMLAttributes } from "react"
import { cn } from "../lib/utils"

/* docs/14 §2.6|統一下拉。styled native <select>(保原生 a11y / 鍵盤 / 表單語意)+ 自訂 chevron。
   高 27px、方角 2px、框線,對齊 Input;className 覆寫走 tailwind-merge(可改高度/寬/opacity)。
   選項少改用 Segmented;此為選項多(如表單/型別清單)之標準下拉。 */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly className?: string
  readonly children?: ReactNode
}

export function Select({ className, children, ...props }: SelectProps): ReactElement {
  return (
    <div
      className={cn(
        "relative inline-flex min-h-[27px] items-center rounded-xs border border-line-input bg-card",
        /* 🔴 2026-08-08|與 Input 同一套(brand-pilot 輸入矩陣):
           focus = outline 2px 主色(不換框色)· 停用 = 壓固定灰(不降透明度)。
           兩者常並排在同一張表單上,狀態語彙不一致會被當成 bug。
           ⚠️ 框線同樣維持 prod 的 `line-input` 不照稿 —— 稿的 `Ink /.14` 實測僅 1.32:1。 */
        "focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary",
        "has-[select:disabled]:bg-head has-[select:disabled]:text-ink-disabled",
        className,
      )}
    >
      <select
        className="h-full w-full cursor-pointer appearance-none bg-transparent pl-2 pr-6 text-[12px] text-ink focus:outline-none disabled:cursor-not-allowed"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-1.5 size-3 text-ink-3"
        strokeWidth={2}
      />
    </div>
  )
}
