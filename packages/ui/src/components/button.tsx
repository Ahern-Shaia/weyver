import { type VariantProps, cva } from "class-variance-authority"
import type { ButtonHTMLAttributes, ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.8|帶框工具列按鈕;每畫面單一 primary */
const buttonVariants = cva(
  "inline-flex h-[27px] items-center justify-center gap-1.5 rounded-xs border px-2.5 text-[12px] whitespace-nowrap transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[11px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border-primary bg-primary font-semibold text-white hover:bg-primary-d",
        default: "border-line bg-card text-ink-2 hover:bg-head",
        danger: "border-er-line bg-card text-er hover:bg-er-t",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  type = "button",
  ...props
}: ButtonProps): ReactElement {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />
}

export { buttonVariants }
