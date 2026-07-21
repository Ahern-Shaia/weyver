"use client"

import { FileText, Plus, Table2 } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { useActiveOrganization, useSession } from "@/lib/auth/client"
import { useForms } from "@/lib/engine/hooks"

/* 登入後主頁「你的工作區」—— Ragic 範式的表單工作區(非 KPI 儀表板)。
   greeting + Signature(織成一朵雲,純文案)+ 你的表單(真 useForms,點進 builder 填/設計)+ 新增。
   phase / 待辦計數等未有真實資料者不放進畫面(feedback:產品畫面不放 roadmap/虛榮數字)。 */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 11) return "早安"
  if (h < 18) return "午安"
  return "晚安"
}

function FormCard({
  id,
  name,
  isSub,
}: {
  readonly id: number
  readonly name: string
  readonly isSub: boolean
}): ReactNode {
  return (
    <Link
      href={`/app/builder?form=${id}`}
      className="group rounded-lg border border-line bg-card p-3 transition-colors duration-150 hover:border-primary hover:bg-primary-t"
    >
      <div className="mb-2 flex size-7 items-center justify-center rounded-md bg-head text-ink-3 transition-colors duration-150 group-hover:bg-primary group-hover:text-white">
        {isSub ? <FileText size={15} strokeWidth={1.9} /> : <Table2 size={15} strokeWidth={1.9} />}
      </div>
      <div className="mb-0.5 truncate text-[13px] font-semibold text-ink">{name}</div>
      <div className="font-mono text-[11px] text-ink-4">{isSub ? "子表單" : "表單"}</div>
    </Link>
  )
}

export default function WorkspaceHome(): ReactNode {
  const { data: session } = useSession()
  const { data: org } = useActiveOrganization()
  const { data: forms, isPending, isError } = useForms()

  const name = session?.user.name ?? session?.user.email ?? ""
  const roots = (forms ?? []).filter((f) => f.parentFormId === null)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-7">
        {/* greeting */}
        <h2 className="text-[21px] font-semibold tracking-[-0.015em] text-ink">
          {greeting()}
          {name ? `,${name}` : ""}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          {org?.name ?? "你的工作區"}
          {forms ? ` · ${roots.length} 張表單` : ""}
        </p>

        {/* Signature —— 織成一朵雲(純文案,不裝飾) */}
        <p className="mt-5 border-l-2 border-primary py-0.5 pl-3 text-[12.5px] text-ink-3">
          <span className="font-semibold text-ink-2">
            採購、財會、生產、品保 —— 散落的線頭,織成同一朵雲。
          </span>{" "}
          同一個工作區、同一套權限與稽核,切換像切分頁。
        </p>

        {/* 你的表單 */}
        <div className="mt-7 mb-2.5 flex items-baseline gap-2.5">
          <h3 className="text-[13px] font-semibold text-ink">你的表單</h3>
          <span className="text-[11.5px] text-ink-4">自己建、自己填的表單資料庫</span>
        </div>

        {isPending ? (
          <div className="text-[12px] text-ink-3">載入表單…</div>
        ) : isError ? (
          <div className="rounded-lg border border-er-line bg-er-t px-3 py-2.5 text-[12px] text-er">
            無法載入表單。請確認引擎服務已啟動。
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {roots.map((f) => (
              <FormCard key={f.id} id={f.id} name={f.name} isSub={false} />
            ))}
            <Link
              href="/app/builder"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-3 transition-colors duration-150 hover:border-primary hover:bg-primary-t hover:text-primary"
            >
              <Plus size={14} strokeWidth={2} />
              新增表單
            </Link>
          </div>
        )}

        {forms && roots.length === 0 ? (
          <p className="mt-3 text-[12px] text-ink-4">
            還沒有表單。點「新增表單」用設計器建立,或從 Excel 匯入。
          </p>
        ) : null}
      </div>
    </div>
  )
}
