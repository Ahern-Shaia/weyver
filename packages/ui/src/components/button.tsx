import { type VariantProps, cva } from "class-variance-authority"
import type { ButtonHTMLAttributes, ReactElement } from "react"
import { cn } from "../lib/utils"

/* 精緻資料工具按鈕(tokens v3.0):柔角、平滑 hover、主色克制;subtle 供 row 微動作降噪 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
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
        sm: "h-[26px] px-2 text-[11.5px] [&_svg]:size-3",
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
