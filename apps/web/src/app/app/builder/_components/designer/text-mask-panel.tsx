"use client"

import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { z } from "zod"

import { describeEngineError, engineFetch } from "@/lib/engine/client"
import type { FieldDto } from "@/lib/engine/schemas"
import { maskText } from "@weyver/rules"
import { Select } from "@weyver/ui/select"

/* 🔴 R1·FTP v1.7|文字遮罩的設定面板。

   在此之前 `mode` / `keep` / `revealRoleIds` **只能打 API 設** ——
   而第一約束逐字說「有 API 可以做」不算解決。

   尤其 `revealRoleIds`:不設的話預設只有 admin 能揭露,
   等於這個欄位對一般使用者永遠是遮的,而管理員**無從調整** ——
   那不是體驗差,是功能不完整。

   ⚠️ 獨立檔案:`field-settings.tsx` 已 624 行(紅線 400),不再往裡面塞。 */

const OPTIONS = z.array(z.object({ id: z.number(), name: z.string() }))

const MODE_LABEL = {
  last: "顯示末幾碼",
  first: "顯示前幾碼",
  cjkName: "中文姓名(遮中間)",
} as const

export function TextMaskPanel({
  formId,
  field,
  onSaved,
}: {
  readonly formId: number
  readonly field: FieldDto
  readonly onSaved: () => void
}): ReactNode {
  const opts = field.options as { mode?: string; keep?: number; revealRoleIds?: number[] }
  const mode = (opts.mode ?? "last") as keyof typeof MODE_LABEL
  const keep = opts.keep ?? 4
  const reveal = opts.revealRoleIds ?? []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: groups } = useQuery({
    queryKey: ["authz", "preview", "groups"] as const,
    queryFn: () => engineFetch("/forms/access-preview/groups", OPTIONS),
    staleTime: 60_000,
  })

  const save = (body: Record<string, unknown>): void => {
    setBusy(true)
    setError(null)
    void engineFetch(`/forms/${String(formId)}/fields/${String(field.id)}/display`, z.unknown(), {
      method: "PATCH",
      body,
    })
      .then(() => onSaved())
      .catch((e: unknown) => setError(describeEngineError(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="border-t border-line p-3 text-[12px]">
      <div className="mb-1 text-ink-3">遮罩方式</div>
      <Select
        className="h-7 w-full"
        aria-label="遮罩方式"
        value={mode}
        disabled={busy}
        onChange={(e) => save({ maskMode: e.target.value })}
      >
        {Object.entries(MODE_LABEL).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </Select>

      {mode === "cjkName" ? null : (
        <>
          <div className="mt-2 mb-1 text-ink-3">保留幾碼</div>
          <Select
            className="h-7 w-full"
            aria-label="保留碼數"
            value={String(keep)}
            disabled={busy}
            onChange={(e) => save({ maskKeep: Number(e.target.value) })}
          >
            {[0, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={String(n)}>
                {n === 0 ? "全部遮住" : `${String(n)} 碼`}
              </option>
            ))}
          </Select>
        </>
      )}

      {/* 🔴 **所見即後果**:直接給一個範例,讓設計者當下就看到存下去會長什麼樣。
          用的是與伺服器**同一支** `maskText`(`@weyver/rules`),不是自己拼一份。 */}
      <div className="mt-2 text-ink-3">
        範例:<span className="font-mono text-ink">{maskText("A123456789", { mode, keep })}</span>
      </div>

      <div className="mt-3 mb-1 text-ink-3">可看完整內容的群組</div>
      {/* 🔴 講清楚沒選的後果。不講的話設計者以為「沒選 = 大家都能看」,
          而實際上相反 —— 那種誤會要到有人抱怨看不到才會發現。 */}
      <p className="mb-1.5 text-ink-3">未選任何群組時,只有系統管理員能按眼睛看完整內容。</p>
      <div className="flex flex-col gap-1">
        {(groups ?? []).map((g) => {
          const checked = reveal.includes(g.id)
          return (
            <label key={g.id} className="flex items-center gap-1.5 text-ink-2">
              <input
                type="checkbox"
                checked={checked}
                disabled={busy}
                className="accent-(--color-primary)"
                onChange={() =>
                  save({
                    revealRoleIds: checked ? reveal.filter((r) => r !== g.id) : [...reveal, g.id],
                  })
                }
              />
              {g.name}
            </label>
          )
        })}
      </div>
      {error === null ? null : <div className="mt-1.5 text-er">{error}</div>}
    </div>
  )
}
