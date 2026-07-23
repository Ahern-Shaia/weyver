"use client"
import { Check, RotateCcw } from "lucide-react"
import { type ReactNode, useMemo } from "react"
import {
  ACTION_LABEL,
  FORM_ACTIONS,
  type FormAction,
  type FormResource,
  type RolePermissions,
  useResources,
  useSetCategoryActions,
  useSetFormActions,
} from "@/lib/engine/authz"

/* 表單 × 動作矩陣「分類分組」(資源軸繼承)。分類列=授權(繼承來源);
   表單列=繼承(虛線)/ 覆寫(琥珀)/ 敏感(不繼承);對照 permissions-resource-inheritance.html。 */
export function FormMatrix({
  roleId,
  perms,
}: {
  readonly roleId: number
  readonly perms: RolePermissions
}): ReactNode {
  const { data: resources } = useResources()
  const setForm = useSetFormActions(roleId)
  const setCategory = useSetCategoryActions(roleId)

  const overrideByForm = useMemo(() => {
    const m = new Map<number, Set<FormAction>>()
    for (const f of perms.forms) m.set(f.formId, new Set(f.actions))
    return m
  }, [perms.forms])
  const grantByCategory = useMemo(() => {
    const m = new Map<number, Set<FormAction>>()
    for (const c of perms.categories) m.set(c.categoryId, new Set(c.actions))
    return m
  }, [perms.categories])

  const groups = useMemo(() => buildGroups(resources), [resources])

  const inheritedFor = (form: FormResource): Set<FormAction> | undefined =>
    !form.isSensitive && form.categoryId !== null ? grantByCategory.get(form.categoryId) : undefined

  const toggleCategory = (categoryId: number, action: FormAction): void => {
    const cur = new Set(grantByCategory.get(categoryId) ?? [])
    if (cur.has(action)) cur.delete(action)
    else {
      cur.add(action)
      cur.add("view")
    }
    setCategory.mutate({ categoryId, actions: [...cur] })
  }
  const toggleForm = (form: FormResource, action: FormAction): void => {
    const cur = new Set(overrideByForm.get(form.id) ?? inheritedFor(form) ?? [])
    if (cur.has(action)) cur.delete(action)
    else {
      cur.add(action)
      cur.add("view")
    }
    setForm.mutate({ formId: form.id, actions: [...cur] }) // 空集 → 後端刪覆寫 → 還原繼承
  }
  const busy = setForm.isPending || setCategory.isPending

  return (
    <>
      <p className="mb-3 border-l-2 border-primary py-0.5 pl-3 text-[11.5px] text-ink-3">
        授權設在<b className="text-ink-2">分類</b>,表單預設<b className="text-ink-2">繼承</b>
        (虛線,點格即覆寫);<b className="text-ink-2">敏感表</b>
        不吃繼承,只認明確覆寫。deny-by-default。
      </p>
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-head">
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-3">
                分類 / 表單
              </th>
              {FORM_ACTIONS.map((a) => (
                <th
                  key={a}
                  className="w-[48px] px-1 py-2 text-center text-[11px] font-semibold text-ink-3"
                >
                  {ACTION_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <CategoryGroup
                key={g.categoryId ?? "uncat"}
                group={g}
                grant={g.categoryId !== null ? grantByCategory.get(g.categoryId) : undefined}
                overrideByForm={overrideByForm}
                inheritedFor={inheritedFor}
                busy={busy}
                onToggleCategory={toggleCategory}
                onToggleForm={toggleForm}
                onRevert={(formId) => setForm.mutate({ formId, actions: [] })}
              />
            ))}
            {groups.length === 0 ? (
              <tr>
                <td colSpan={FORM_ACTIONS.length + 1} className="px-3 py-4 text-[12px] text-ink-4">
                  尚無表單。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-ink-4">
        點分類列格子=設分類授權(藍);點表單列格子=建立該表覆寫(琥珀);覆寫列可「還原繼承」。
      </p>
    </>
  )
}

interface Group {
  readonly categoryId: number | null
  readonly name: string
  readonly forms: readonly FormResource[]
}

function buildGroups(resources: ReturnType<typeof useResources>["data"]): Group[] {
  if (!resources) return []
  const groups: Group[] = resources.categories.map((c) => ({
    categoryId: c.id,
    name: c.name,
    forms: resources.forms.filter((f) => f.categoryId === c.id),
  }))
  const uncat = resources.forms.filter((f) => f.categoryId === null)
  if (uncat.length > 0) groups.push({ categoryId: null, name: "未分類", forms: uncat })
  return groups
}

function CategoryGroup({
  group,
  grant,
  overrideByForm,
  inheritedFor,
  busy,
  onToggleCategory,
  onToggleForm,
  onRevert,
}: {
  readonly group: Group
  readonly grant: Set<FormAction> | undefined
  readonly overrideByForm: Map<number, Set<FormAction>>
  readonly inheritedFor: (form: FormResource) => Set<FormAction> | undefined
  readonly busy: boolean
  readonly onToggleCategory: (categoryId: number, action: FormAction) => void
  readonly onToggleForm: (form: FormResource, action: FormAction) => void
  readonly onRevert: (formId: number) => void
}): ReactNode {
  return (
    <>
      <tr className="border-t border-line-2 bg-label">
        <td className="px-3 py-2 font-semibold text-ink">
          {group.name}
          {group.categoryId !== null ? <Tag tone="grant">分類授權</Tag> : null}
        </td>
        {FORM_ACTIONS.map((a) => (
          <td key={a} className="px-1 py-2 text-center">
            {group.categoryId !== null ? (
              <CheckBox
                variant="grant"
                on={grant?.has(a) ?? false}
                disabled={busy}
                onClick={() => onToggleCategory(group.categoryId as number, a)}
              />
            ) : (
              <span className="text-[11px] text-ink-4">—</span>
            )}
          </td>
        ))}
      </tr>
      {group.forms.map((form) => {
        const override = overrideByForm.get(form.id)
        const inherited = inheritedFor(form)
        const display = override ?? inherited ?? new Set<FormAction>()
        const source = override ? "override" : inherited && inherited.size > 0 ? "inherit" : "none"
        return (
          <tr key={form.id} className="border-t border-line-2 hover:bg-surface">
            <td className="py-2 pr-3 pl-7 text-ink">
              <span className="text-ink-4">└ </span>
              {form.name}
              {form.isSensitive ? <Tag tone="sensitive">敏感</Tag> : null}
              {source === "inherit" ? <Tag tone="inherit">繼承</Tag> : null}
              {source === "override" ? (
                <>
                  <Tag tone="override">覆寫</Tag>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRevert(form.id)}
                    className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[10.5px] text-ink-4 hover:text-primary disabled:opacity-50"
                  >
                    <RotateCcw size={11} strokeWidth={1.9} />
                    還原繼承
                  </button>
                </>
              ) : null}
            </td>
            {FORM_ACTIONS.map((a) => (
              <td key={a} className="px-1 py-2 text-center">
                <CheckBox
                  variant={source === "inherit" ? "inherit" : "override"}
                  on={display.has(a)}
                  disabled={busy}
                  onClick={() => onToggleForm(form, a)}
                />
              </td>
            ))}
          </tr>
        )
      })}
    </>
  )
}

function Tag({
  tone,
  children,
}: {
  readonly tone: "grant" | "inherit" | "override" | "sensitive"
  readonly children: ReactNode
}): ReactNode {
  const cls = {
    grant: "border-primary/30 bg-primary-t text-primary",
    inherit: "border-fx/30 bg-fx-bg text-fx",
    override: "border-wn-line bg-wn-t text-wn",
    sensitive: "border-er-line bg-er-t text-er",
  }[tone]
  return (
    <span
      className={`ml-1.5 rounded-xs border px-1 align-middle font-mono text-[9px] font-semibold ${cls}`}
    >
      {children}
    </span>
  )
}

function CheckBox({
  variant,
  on,
  disabled,
  onClick,
}: {
  readonly variant: "grant" | "override" | "inherit"
  readonly on: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}): ReactNode {
  const base =
    "inline-flex size-5 items-center justify-center rounded-sm border transition-colors disabled:opacity-50"
  const onCls =
    variant === "grant"
      ? "border-primary bg-primary text-white"
      : variant === "override"
        ? "border-wn bg-wn text-white"
        : "border-fx/40 border-dashed bg-fx-bg text-fx"
  const cls = on ? onCls : "border-line bg-card text-transparent hover:border-primary"
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`${base} ${cls}`}>
      <Check size={12} strokeWidth={2.6} />
    </button>
  )
}
