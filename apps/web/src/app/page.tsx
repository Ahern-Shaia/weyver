import Link from "next/link"

const links = [
  {
    href: "/app",
    title: "表單記錄(flagship)",
    desc: "採購單 · 全框線欄位表 + 子表 + 簽核 + GL 過帳 + 三主題切換",
  },
  {
    href: "/design-system",
    title: "設計系統 v2.1",
    desc: "token · 三配色主題 · 全部元件 showcase",
  },
]

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-sm bg-primary text-[13px] font-bold text-white">
          W
        </div>
        <div>
          <div className="text-[14px] font-semibold">
            Weyver <span className="font-normal text-ink-3">織雲</span>
          </div>
          <div className="text-[12px] text-ink-3">前端工作區 · 嚴謹企業級 v2.1</div>
        </div>
      </div>
      <div className="grid gap-2">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="bg-card px-4 py-3 hover:bg-hover">
            <div className="text-[13px] font-semibold">{link.title}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">{link.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  )
}
