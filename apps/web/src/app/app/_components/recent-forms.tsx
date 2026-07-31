"use client"

import { Clock, Table2 } from "lucide-react"
import Link from "next/link"
import { type ReactNode, useEffect, useState } from "react"
import { useForms } from "@/lib/engine/hooks"
import { readRecentFormIds } from "@/lib/recent-forms"
import { useTenantScope } from "@/lib/use-tenant-scope"

/* R1·UX-1 M4|最近使用(IA 三層防線之第二層:分類目錄 / **最近使用** / ⌘K)。

   🔴 安全性由建構保證:本地只存 formId,顯示前一律**對照 useForms() 的授權清單解析**。
   那份清單是 tenant-scoped 且經三態可見性過濾,故跨租戶 / 越權 / 已刪除的 id
   比對不到就不出現 —— 不是靠額外檢查擋掉的。

   無記錄 → 不渲染(與 PendingApprovals 同一原則:不佔位、不畫餅)。 */
export function RecentForms(): ReactNode {
  const scope = useTenantScope()
  const { data: forms } = useForms()
  const [ids, setIds] = useState<number[]>([])

  /* localStorage 只在 client 讀 —— 直接於 render 讀會造成 SSR 與首次 render 不一致 */
  useEffect(() => {
    setIds(readRecentFormIds(scope))
  }, [scope])

  if (ids.length === 0 || !forms) return null

  const visible = ids
    .map((id) => forms.find((f) => f.id === id && !f.locked))
    .filter((f): f is NonNullable<typeof f> => f !== undefined)
    .slice(0, 6)

  if (visible.length === 0) return null

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
          <Clock size={14} strokeWidth={1.9} className="text-ink-3" />
          最近使用
        </h3>
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-card">
        {visible.map((f, i) => (
          <Link
            key={f.id}
            href={`/app/forms/${f.id}`}
            className={`flex items-center gap-2.5 px-3 py-2 transition-colors duration-fast-01 ease-productive-exit hover:bg-primary-t ${
              i === 0 ? "" : "border-t border-line-2"
            }`}
          >
            <Table2 size={14} strokeWidth={1.9} className="shrink-0 text-ink-3" />
            <span className="truncate text-[13px] text-link">{f.name}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
