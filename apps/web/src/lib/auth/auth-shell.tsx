import type { ReactNode } from "react"

/* 登入 / 註冊共用外框:置中卡片 + 織雲品牌塊(嚴謹企業級:全框線、方角、無陰影,docs/14)。 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  readonly title: string
  readonly subtitle: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-6">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-sm bg-primary text-[13px] font-bold text-white">
          W
        </div>
        <div>
          <div className="text-[14px] font-semibold">
            Weyver <span className="font-normal text-ink-3">織雲</span>
          </div>
          <div className="text-[11px] text-ink-3">{subtitle}</div>
        </div>
      </div>
      <div className="rounded-sm border border-line bg-card p-5">
        <h1 className="mb-4 text-[15px] font-semibold text-ink">{title}</h1>
        {children}
      </div>
    </main>
  )
}

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  )
}
