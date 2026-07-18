import { type VariantProps, cva } from "class-variance-authority"
import type { ButtonHTMLAttributes, ReactElement } from "react"
import { cn } from "../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-colors duration-[130ms] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-white shadow-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-brand-hover",
        secondary: "bg-card text-ink-2 border border-border shadow-sm hover:bg-surface",
        ghost: "text-ink-2 hover:bg-surface",
        danger: "bg-danger text-white hover:brightness-95",
      },
      size: {
        md: "px-3.5 py-1.5 text-[13px]",
        sm: "px-2.5 py-1.5 text-xs",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
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
