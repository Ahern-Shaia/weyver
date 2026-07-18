import { ArrowRight } from "lucide-react"
import Link from "next/link"

const links = [
  { href: "/design-system", title: "設計系統", desc: "色彩 · 字型 · token · 元件 · Do & Don't" },
  { href: "/app", title: "App Shell 範例", desc: "頂欄 + 左導航 + 儀表板(表單引擎 / MES)" },
]

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-sm bg-brand text-[15px] font-bold tracking-tight text-white">
          W
        </div>
        <div>
          <div className="text-[15px] font-semibold tracking-tight">
            Weyver <span className="font-normal text-ink-3">織雲</span>
          </div>
          <div className="text-xs text-ink-3">企業級多產業製造平台 · 前端工作區</div>
        </div>
      </div>
      <div className="grid gap-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-center gap-4 rounded-md border border-border bg-card px-5 py-4 transition-[box-shadow,border-color] duration-[130ms] hover:border-brand-tint-2 hover:shadow-md"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">{link.title}</div>
              <div className="mt-0.5 text-[12.5px] text-ink-3">{link.desc}</div>
            </div>
            <ArrowRight
              className="size-4 text-ink-3 transition-colors group-hover:text-brand"
              strokeWidth={1.6}
            />
          </Link>
        ))}
      </div>
    </main>
  )
}
