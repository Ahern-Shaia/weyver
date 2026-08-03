"use client"

import { describeEngineError } from "@/lib/engine/client"
import {
  type Widget,
  useCreateWidget,
  useDeleteWidget,
  useWidgetRoleCandidates,
} from "@/lib/engine/hooks"
import type { FormDto } from "@/lib/engine/schemas"
import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { type ReactNode, useState } from "react"

/* 🔴 F-2 M4|小圖表的設定面板。

   **這不是「補一個 UI」,是補一條定位缺口。** 在此之前 widget **只能打 API 建立** ——
   而 `AGENTS.md` 第一約束逐字:「『有 API 可以做』不算解決。
   API / webhook / 腳本是**開發者的逃生口**,不得是**唯一**路徑」。

   **維度候選來自 `form.fields`**,而那份清單**已經過欄位級權限**
   (`toFormDto` 濾掉 hidden)—— 這就是 OQ-PC-11 = A 的「設計期擋」那一半:
   使用者**選不到**一個自己看不見的欄位,所以建不出一張必定失敗的圖。

   **可檢視群組候選走 `role-candidates`**,而它**先被來源表單權限過濾**
   (OQ-PC-12 = A)。前端過濾只是可用性 —— 後端建立時會再驗一次。 */

const CHART_LABEL: Record<string, string> = { bar: "長條", line: "折線", pie: "圓餅" }
const AGG_LABEL: Record<string, string> = { sum: "加總", avg: "平均", min: "最小", max: "最大" }

/* 可當維度的型別:排除聚合不了 / 分不了組的。與 kanban 分欄的取捨同源 */
const NON_GROUPABLE = new Set(["attachment", "image", "signature", "link", "longText"])

export function WidgetEditor({
  formId,
  form,
  widgets,
  onClose,
}: {
  readonly formId: number
  readonly form: FormDto
  readonly widgets: readonly Widget[]
  readonly onClose: () => void
}): ReactNode {
  const create = useCreateWidget(formId)
  const del = useDeleteWidget(formId)
  const roles = useWidgetRoleCandidates(formId, true)

  const groupable = form.fields.filter((f) => !NON_GROUPABLE.has(f.type))
  const numeric = form.fields.filter((f) =>
    ["number", "money", "percent", "rating"].includes(f.type),
  )

  const [name, setName] = useState("")
  const [chartType, setChartType] = useState<"bar" | "line" | "pie">("bar")
  const [dimension, setDimension] = useState(groupable[0]?.name ?? "")
  const [aggFn, setAggFn] = useState("")
  const [aggField, setAggField] = useState("")
  const [roleIds, setRoleIds] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    if (name.trim() === "" || dimension === "") {
      setError("請填寫名稱並選擇分類欄位")
      return
    }
    setError(null)
    create.mutate(
      {
        name: name.trim(),
        chartType,
        dimension,
        measure: aggFn === "" || aggField === "" ? null : { fn: aggFn, field: aggField },
        visibleRoleIds: roleIds,
      },
      {
        onSuccess: () => {
          setName("")
          setRoleIds([])
        },
        onError: (e) => setError(describeEngineError(e)),
      },
    )
  }

  return (
    <div className="border-b border-line bg-card px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">小圖表設定</span>
        <Button className="ml-auto" onClick={onClose}>
          收合
        </Button>
      </div>

      {widgets.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-1">
          {widgets.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-[12px] text-ink-2">
              <span className="min-w-0 flex-1 truncate">
                {w.name}(依「{w.dimension}」分類 · {CHART_LABEL[w.chartType] ?? w.chartType})
                {w.visibleRoleIds.length > 0 ? " · 限特定群組" : ""}
              </span>
              <Button disabled={del.isPending} onClick={() => del.mutate(w.id)}>
                移除
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {error !== null ? (
        <div className="mb-2 border border-er-line bg-er-t px-2 py-1 text-[12px] text-er">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[12px] text-ink-3">
          名稱
          <Input
            className="h-7 w-40"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例:各區筆數"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[12px] text-ink-3">
          類型
          <Select
            className="h-7 w-20"
            value={chartType}
            onChange={(e) => setChartType(e.target.value as "bar" | "line" | "pie")}
          >
            {(["bar", "line", "pie"] as const).map((t) => (
              <option key={t} value={t}>
                {CHART_LABEL[t]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-0.5 text-[12px] text-ink-3">
          分類欄位
          <Select
            className="h-7 w-32"
            value={dimension}
            onChange={(e) => setDimension(e.target.value)}
          >
            {groupable.map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-0.5 text-[12px] text-ink-3">
          統計(不選 = 計數)
          <div className="flex gap-1">
            <Select className="h-7 w-20" value={aggFn} onChange={(e) => setAggFn(e.target.value)}>
              <option value="">計數</option>
              {Object.entries(AGG_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Select
              className="h-7 w-28"
              value={aggField}
              disabled={aggFn === ""}
              onChange={(e) => setAggField(e.target.value)}
            >
              <option value="">選欄位</option>
              {numeric.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
        </label>
        <Button variant="primary" disabled={create.isPending} onClick={submit}>
          {create.isPending ? "建立中…" : "新增小圖表"}
        </Button>
      </div>

      {/* 🔴 OQ-PC-12:候選**已先被來源表單權限過濾** —— 選不到對來源表單沒權限的群組,
          故此欄結構上不可能放寬權限。不選 = 依來源表單權限(Ragic 語意),非「所有人可見」。 */}
      {(roles.data?.length ?? 0) > 0 ? (
        <div className="mt-2">
          <div className="mb-1 text-[12px] text-ink-3">可檢視群組(不選 = 依此表單本身的權限)</div>
          <div className="flex flex-wrap gap-1">
            {roles.data?.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={roleIds.includes(r.id)}
                onClick={() =>
                  setRoleIds((prev) =>
                    prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id],
                  )
                }
                className={`rounded-xs border px-1.5 py-0.5 text-[12px] ${
                  roleIds.includes(r.id)
                    ? "border-primary bg-primary-t text-primary"
                    : "border-line-2 bg-card text-ink-2 hover:bg-hover"
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
