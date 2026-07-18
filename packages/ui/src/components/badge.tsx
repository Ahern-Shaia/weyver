import { type VariantProps, cva } from "class-variance-authority"
import type { HTMLAttributes, ReactElement } from "react"
import { cn } from "../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        success: "bg-success-tint text-success-dark",
        warning: "bg-warning-tint text-warning-dark",
        danger: "bg-danger-tint text-danger-dark",
        info: "bg-info-tint text-info-dark",
        brand: "bg-brand-tint text-brand",
        neutral: "bg-border-2 text-ink-2",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
)

const dotColor: Record<NonNullable<VariantProps<typeof badgeVariants>["variant"]>, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  brand: "bg-brand",
  neutral: "bg-ink-3",
}

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  readonly dot?: boolean
}

export function Badge({
  className,
  variant = "neutral",
  dot = true,
  children,
  ...props
}: BadgeProps): ReactElement {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span aria-hidden className={cn("size-1.5 rounded-full", dotColor[variant ?? "neutral"])} />
      ) : null}
      {children}
    </span>
  )
}

export { badgeVariants }
