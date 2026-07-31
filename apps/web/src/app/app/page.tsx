"use client"

import { Lock, Plus, Table2 } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { useActiveOrganization, useSession } from "@/lib/auth/client"
import { useCategories, useForms } from "@/lib/engine/hooks"
import type { FormSummary } from "@/lib/engine/schemas"
import { PendingApprovals } from "./_components/pending-approvals"
import { RecentForms } from "./_components/recent-forms"

/* R1·UP-1 工作區首頁 = 分類目錄(取代卡牆;docs/27 D3)。表單依 form_categories 分組密集列出,
   未分類殿後,空分類隱藏(不洩業務域);三態:可讀→可點、鎖定→顯示不可點、敏感→後端已隱藏。 */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 11) return "早安"
  if (h < 18) return "午安"
  return "晚安"
}

function fmtUpdated(iso: string | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return `更新 ${d.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" })}`
}

function FormCard({ form }: { readonly form: FormSummary }): ReactNode {
  if (form.locked) {
    return (
      <div
        title="無存取權,請洽管理員授予"
        className="cursor-not-allowed rounded-md border border-dashed border-line bg-surface px-3 py-2.5 opacity-70"
      >
        <div className="flex items-center gap-2">
          <Lock size={14} strokeWidth={1.9} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-3">
            {form.name}
          </span>
        </div>
        <div className="mt-0.5 pl-6 font-mono text-[10.5px] text-ink-3">無存取權</div>
      </div>
    )
  }
  return (
    <Link
      href={`/app/forms/${form.id}`}
      className="group rounded-md border border-line bg-card px-3 py-2.5 transition-colors duration-fast-01 ease-productive-exit hover:border-primary hover:bg-primary-t"
    >
      <div className="flex items-center gap-2">
        <Table2
          size={14}
          strokeWidth={1.9}
          className="shrink-0 text-ink-3 group-hover:text-primary"
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
          {form.name}
        </span>
      </div>
      <div className="mt-0.5 pl-6 font-mono text-[10.5px] text-ink-3">
        {fmtUpdated(form.updatedAt)}
      </div>
    </Link>
  )
}

function Section({
  title,
  forms,
}: {
  readonly title: string
  readonly forms: readonly FormSummary[]
}): ReactNode {
  if (forms.length === 0) return null
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink-2">{title}</h3>
        <span className="font-mono text-[11px] text-ink-3">{forms.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {forms.map((f) => (
          <FormCard key={f.id} form={f} />
        ))}
      </div>
    </section>
  )
}

export default function WorkspaceHome(): ReactNode {
  const { data: session } = useSession()
  const { data: org } = useActiveOrganization()
  const { data: forms, isPending, isError } = useForms()
  const { data: categories } = useCategories()

  const name = session?.user.name ?? session?.user.email ?? ""
  const roots = (forms ?? []).filter((f) => f.parentFormId === null)
  const cats = [...(categories ?? [])].sort((a, b) => a.position - b.position || a.id - b.id)
  const uncat = roots.filter((f) => f.categoryId == null)
  const visibleCats = cats
    .map((c) => ({ c, forms: roots.filter((f) => f.categoryId === c.id) }))
    .filter((g) => g.forms.length > 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-7">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[21px] font-semibold tracking-[-0.015em] text-ink">
            {greeting()}
            {name ? `,${name}` : ""}
          </h2>
          <span className="text-[12.5px] text-ink-3">
            {org?.name ?? "你的工作區"}
            {forms ? ` · ${roots.length} 張表單` : ""}
          </span>
          <Link
            href="/app/builder"
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-medium text-white transition-colors duration-fast-01 ease-productive-exit hover:bg-primary-d"
          >
            <Plus size={14} strokeWidth={2} />
            新增表單
          </Link>
        </div>

        <p className="mt-4 border-l-2 border-primary py-0.5 pl-3 text-[12.5px] text-ink-3">
          <span className="font-semibold text-ink-2">
            採購、財會、生產、品保 —— 散落的線頭,織成同一朵雲。
          </span>{" "}
          同一個工作區、同一套權限與稽核,切換像切分頁。
        </p>

        {isPending ? (
          <div className="mt-6 text-[12px] text-ink-3">載入表單…</div>
        ) : isError ? (
          <div className="mt-6 rounded-md border border-er-line bg-er-t px-3 py-2.5 text-[14px] text-er">
            無法載入表單。請確認引擎服務已啟動。
          </div>
        ) : roots.length === 0 ? (
          <p className="mt-6 text-[12px] text-ink-3">
            還沒有表單。點「新增表單」用設計器建立,或從 Excel 匯入。
          </p>
        ) : (
          <>
            <PendingApprovals />
            <RecentForms />
            {visibleCats.map((g) => (
              <Section key={g.c.id} title={g.c.name} forms={g.forms} />
            ))}
            <Section title={visibleCats.length > 0 ? "未分類" : "你的表單"} forms={uncat} />
          </>
        )}
      </div>
    </div>
  )
}
