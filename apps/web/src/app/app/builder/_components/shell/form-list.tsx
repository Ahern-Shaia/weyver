"use client"

import { describeEngineError } from "@/lib/engine/client"
import { useCategories, useForms } from "@/lib/engine/hooks"
import { Input } from "@weyver/ui/input"
import { cn } from "@weyver/ui/lib/utils"
import { useMemo, useState } from "react"

const STATE_MARK: Record<string, string> = {
  ready: "●",
  pending: "◐",
  failed: "✕",
}

const STATE_COLOR: Record<string, string> = {
  ready: "text-ok",
  pending: "text-warn",
  failed: "text-er",
}

/* 🔴 OQ-FDW-14 = A|**分類提到頂部橫列,左欄變成搜尋 / 篩選面板**。

   起因是實走時一眼可見的問題:這條軌把**全部**表單平鋪(dev 租戶已有 80+ 張),
   而它是設計器唯一的導航。要找一張表只能用眼睛掃 —— 那不是「清單長」的問題,
   是**沒有導航**。

   ⚠️ 分類**不用頁籤元件**而用一列可捲動的 chip:頁籤語意是「同一份內容的不同視圖」,
   而這裡是**篩選**。用錯語意的元件會讓鍵盤與螢幕閱讀器得到錯的模型。 */
export function FormListRail({
  activeFormId,
  onSelect,
  onNew,
  onImport,
}: {
  activeFormId: number | null
  onSelect: (formId: number) => void
  onNew: () => void
  onImport: () => void
}) {
  const forms = useForms()
  const categories = useCategories()
  const [q, setQ] = useState("")
  const [catId, setCatId] = useState<number | null>(null)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (forms.data ?? []).filter(
      (f) =>
        (catId === null || f.categoryId === catId) &&
        (needle === "" || f.name.toLowerCase().includes(needle)),
    )
  }, [forms.data, q, catId])

  /* 空分類不顯示 —— 與工作區首頁同一條規則(不洩業務域,也不給點了沒東西的入口) */
  const usedCats = useMemo(() => {
    const ids = new Set((forms.data ?? []).map((f) => f.categoryId))
    return (categories.data ?? []).filter((c) => ids.has(c.id))
  }, [forms.data, categories.data])

  return (
    <div className="flex w-[228px] shrink-0 flex-col border-r border-line bg-card">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="text-[14px] font-semibold text-ink">我的表單</span>
        <button
          type="button"
          onClick={onImport}
          className="ml-auto rounded-xs px-2 py-0.5 text-[12px] font-medium text-ink-2 hover:bg-hover"
        >
          匯入 Excel
        </button>
        <button
          type="button"
          onClick={onNew}
          className="rounded-xs border border-primary bg-primary px-2 py-0.5 text-[12px] font-medium text-white"
        >
          + 新增
        </button>
      </div>

      <div className="border-b border-line-2 px-2 py-1.5">
        <Input
          className="h-7"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋表單…"
          aria-label="搜尋表單"
        />
      </div>
      {usedCats.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b border-line-2 px-2 py-1.5">
          <CatChip active={catId === null} onClick={() => setCatId(null)}>
            全部
          </CatChip>
          {usedCats.map((c) => (
            <CatChip key={c.id} active={catId === c.id} onClick={() => setCatId(c.id)}>
              {c.name}
            </CatChip>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {forms.isLoading ? (
          <div className="p-3 text-[14px] text-ink-3">載入中…</div>
        ) : forms.isError ? (
          <div className="p-3 text-[13px] text-er">
            無法連線引擎:{describeEngineError(forms.error)}
          </div>
        ) : (forms.data?.length ?? 0) === 0 ? (
          <div className="p-3 text-[14px] text-ink-3">尚無表單。點「+ 新增」建立第一張。</div>
        ) : shown.length === 0 ? (
          /* 有表單但篩不出來 —— 與「尚無表單」是兩件事,講成同一句會讓人以為表不見了 */
          <div className="p-3 text-[13px] text-ink-3">沒有符合的表單。清除搜尋或改選分類。</div>
        ) : (
          <ul>
            {shown.map((form) => {
              const active = form.id === activeFormId
              return (
                <li key={form.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(form.id)}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-line-2 px-3 py-2 text-left text-[13px]",
                      active ? "bg-primary-t font-medium text-ink" : "text-ink-2 hover:bg-head",
                    )}
                  >
                    <span
                      className={cn("font-mono text-[12px]", STATE_COLOR[form.provisionState])}
                      title={form.provisionState}
                    >
                      {STATE_MARK[form.provisionState] ?? "●"}
                    </span>
                    <span className="flex-1 truncate">{form.name}</span>
                    {form.parentFormId !== null ? (
                      <span className="shrink-0 text-[12px] text-ink-3">子表</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function CatChip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xs border px-1.5 py-0.5 text-[12px]",
        active
          ? "border-primary bg-primary-t text-primary"
          : "border-line-2 bg-card text-ink-2 hover:bg-hover",
      )}
    >
      {children}
    </button>
  )
}
