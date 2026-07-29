"use client"
import { Check, UserCheck, RotateCcw } from "lucide-react"
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
  const scopedByForm = useMemo(() => {
    const m = new Map<number, Set<FormAction>>()
    for (const f of perms.forms) m.set(f.formId, new Set(f.scopedActions ?? []))
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
  /* 三態循環:未授權 → 全部 → 只限自己的 → 未授權。
     不可設範圍的動作(design / approve / export)維持兩態。 */
  const toggleForm = (form: FormResource, action: FormAction): void => {
    const cur = new Set(overrideByForm.get(form.id) ?? inheritedFor(form) ?? [])
    const curScoped = new Set(scopedByForm.get(form.id) ?? [])
    const canScope = SCOPEABLE.has(action)

    if (!cur.has(action)) {
      cur.add(action)
      cur.add("view")
    } else if (canScope && !curScoped.has(action)) {
      curScoped.add(action)
    } else {
      cur.delete(action)
      curScoped.delete(action)
    }
    setForm.mutate({
      formId: form.id,
      actions: [...cur],
      scopedActions: [...curScoped].filter((a) => cur.has(a)),
    }) // 空集 → 後端刪覆寫 → 還原繼承
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
                scopedByForm={scopedByForm}
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
        <br />
        表單列的檢視/新增/編輯/刪除可再點一次切成 <UserCheck size={11} className="inline" />{" "}
        <b className="text-ink-2">只限自己的</b>(自己建立的 + 被指派的);再點一次取消授權。
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
  scopedByForm,
  inheritedFor,
  busy,
  onToggleCategory,
  onToggleForm,
  onRevert,
}: {
  readonly group: Group
  readonly grant: Set<FormAction> | undefined
  readonly overrideByForm: Map<number, Set<FormAction>>
  readonly scopedByForm: Map<number, Set<FormAction>>
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
                  scoped={scopedByForm.get(form.id)?.has(a) === true}
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

/* 🔴 三態格子(#96):空 → 全部記錄 → **只限自己的** → 空。
   範圍是**動作的修飾**而非另一個動作 —— 拆成兩欄會讓 7 動作變 14 欄,
   而且看不出「這是同一個授權的兩種強度」。
   ⚠️ 只有讀寫類動作有範圍語意;design 是表結構層,approve/export 於 R1 先不設範圍。 */
const SCOPEABLE: ReadonlySet<FormAction> = new Set(["view", "create", "edit", "delete"])

function CheckBox({
  variant,
  on,
  scoped = false,
  disabled,
  onClick,
}: {
  readonly variant: "grant" | "override" | "inherit"
  readonly on: boolean
  readonly scoped?: boolean
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${cls}`}
      title={on ? (scoped ? "只限自己建立或被指派的記錄" : "全部記錄") : "未授權"}
      aria-label={on ? (scoped ? "已授權(只限自己的)" : "已授權(全部)") : "未授權"}
    >
      {on && scoped ? (
        <UserCheck size={12} strokeWidth={2.4} />
      ) : (
        <Check size={12} strokeWidth={2.6} />
      )}
    </button>
  )
}
