import { type VariantProps, cva } from "class-variance-authority"
import type { ButtonHTMLAttributes, ReactElement } from "react"
import { cn } from "../lib/utils"

/* 精緻資料工具按鈕(tokens v3.0):柔角、平滑 hover、主色克制;subtle 供 row 微動作降噪

   🔴 2026-08-08|停用態由 **降透明度** 改為 **壓成固定灰**,依據是 `brand-pilot.html`
   的 Button 狀態矩陣(四變體 × rest/hover/focus/disabled),實測:
   四個變體的 disabled **完全相同** —— 底 #edeef1(≈ `head`)、字 #7d8086(`ink-disabled`)、
   **無框**、opacity 1。

   為什麼固定灰比透明度對|
   ① 半透明會**透出底色**,同一顆停用按鈕在白底與灰底面板上長得不一樣;固定灰到哪都一致。
   ② 稿刻意讓四個變體停用後**長得完全一樣**;用透明度則 primary 停用是淡藍、
      danger 停用是淡紅,等於告訴使用者「停用的東西還保有原本的個性」。
   ⚠️ 稿上 disabled **沒有框**(實測 border-width 0 / style none)——
   第一次量到 `bd:#7d8086` 是無框時 fallback 到 currentColor 的假值,差點多加一條框。
   ⚠️ `--opacity-disabled` **保留**:圖示按鈕 / 連結 / checkbox 稿上沒涵蓋,
   維持透明度並明確標為推導,不把只驗過按鈕的規則硬套到全部。 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border font-medium transition-colors duration-fast-01 ease-productive-exit disabled:pointer-events-none disabled:border-transparent disabled:bg-head disabled:text-ink-disabled [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
  {
    variants: {
      variant: {
        primary: "border-primary bg-primary text-white hover:bg-primary-d",
        default: "border-line bg-card text-ink-2 hover:bg-head hover:text-ink",
        subtle: "border-transparent bg-transparent text-ink-3 hover:bg-head hover:text-ink",
        danger: "border-er-line bg-card text-er hover:bg-er-t",
      },
      size: {
        default: "h-7 px-2.5 text-[12px] [&_svg]:size-[13px]",
        sm: "h-[26px] px-2 text-[12px] [&_svg]:size-3",
        icon: "size-7 [&_svg]:size-[14px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps): ReactElement {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}

export { buttonVariants }
