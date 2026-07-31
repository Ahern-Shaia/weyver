"use client"
import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react"
import { type ReactNode, useState } from "react"
import {
  ACTION_LABEL,
  FORM_ACTIONS,
  type FormAction,
  useCreateCategory,
  useDefaultActions,
  useDeleteCategory,
  useResources,
  useSetDefaultActions,
  useSetFormCategory,
  useSetFormSensitive,
} from "@/lib/engine/authz"

/* 租戶級資源設定(admin):分類 CRUD + 表單歸類/敏感 + 未授權非敏感表之預設 profile。
   收合於權限頁頂;分類為矩陣「分類分組」之來源。 */
export function ResourceSettings(): ReactNode {
  const [open, setOpen] = useState(false)
  const { data: resources } = useResources()
  const createCategory = useCreateCategory()
  const deleteCategory = useDeleteCategory()
  const setFormCategory = useSetFormCategory()
  const setFormSensitive = useSetFormSensitive()
  const [name, setName] = useState("")

  const categories = resources?.categories ?? []
  const forms = resources?.forms ?? []

  const addCategory = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    createCategory.mutate(trimmed, { onSuccess: () => setName("") })
  }

  return (
    <div className="shrink-0 border-b border-line bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-[12px] font-medium text-ink-2 hover:bg-head"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        分類與預設設定
        <span className="text-[11px] font-normal text-ink-3">
          {categories.length} 分類 · 授權設在分類、表單繼承
        </span>
      </button>
      {open ? (
        <div className="grid grid-cols-2 gap-5 px-4 pt-1 pb-4">
          <div>
            <div className="mb-2 text-[11px] font-semibold text-ink-3">分類</div>
            <div className="mb-2 flex gap-1.5">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCategory()
                }}
                placeholder="新分類名稱,Enter 建立"
              />
              <Button onClick={addCategory} disabled={createCategory.isPending}>
                新增
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {categories.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-sm border border-line-2 px-2.5 py-1.5 text-[12px] text-ink-2"
                >
                  {c.name}
                  <button
                    type="button"
                    onClick={() => deleteCategory.mutate(c.id)}
                    title="刪除分類(表單回退未分類)"
                    className="ml-auto text-ink-3 hover:text-er"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
              {categories.length === 0 ? (
                <li className="px-1 text-[11px] text-ink-3">尚無分類</li>
              ) : null}
            </ul>
            <DefaultProfile />
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold text-ink-3">表單歸類 / 敏感</div>
            <ul className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
              {forms.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded-sm border border-line-2 px-2.5 py-1.5 text-[12px]"
                >
                  <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                  <Select
                    value={f.categoryId ?? ""}
                    onChange={(e) =>
                      setFormCategory.mutate({
                        formId: f.id,
                        categoryId: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="h-7 w-32 shrink-0"
                    aria-label={`${f.name} 分類`}
                  >
                    <option value="">未分類</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-3">
                    <input
                      type="checkbox"
                      checked={f.isSensitive}
                      onChange={(e) =>
                        setFormSensitive.mutate({ formId: f.id, isSensitive: e.target.checked })
                      }
                      className="accent-(--color-er)"
                    />
                    敏感
                  </label>
                </li>
              ))}
              {forms.length === 0 ? (
                <li className="px-1 text-[11px] text-ink-3">尚無表單</li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* 未分類且無授權之非敏感表 baseline(空=deny;可設 view 作遷移期軟 allow)。 */
function DefaultProfile(): ReactNode {
  const { data } = useDefaultActions()
  const setDefault = useSetDefaultActions()
  const current = new Set<FormAction>(data?.actions ?? [])

  const toggle = (action: FormAction): void => {
    const next = new Set(current)
    if (next.has(action)) next.delete(action)
    else {
      next.add(action)
      next.add("view")
    }
    setDefault.mutate([...next])
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11px] font-semibold text-ink-3">
        未分類表預設(空=deny;遷移期可開 檢視)
      </div>
      <div className="flex flex-wrap gap-1">
        {FORM_ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => toggle(a)}
            disabled={setDefault.isPending}
            className={
              current.has(a)
                ? "rounded-sm border border-primary bg-primary px-2 py-1 text-[11px] font-medium text-white"
                : "rounded-sm border border-line bg-card px-2 py-1 text-[11px] text-ink-3 hover:border-primary disabled:opacity-50"
            }
          >
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>
    </div>
  )
}
