"use client"

import { Check } from "lucide-react"
import { type ReactNode, useMemo } from "react"
import {
  ACTION_LABEL,
  FORM_ACTIONS,
  type FormAction,
  type RolePermissions,
  useSetFormActions,
} from "@/lib/engine/authz"
import { useForms } from "@/lib/engine/hooks"

/* 表單 × 動作矩陣(M7 動作級)。勾任一動作自動含「檢視」;deny-by-default。 */
export function FormMatrix({
  roleId,
  perms,
}: {
  readonly roleId: number
  readonly perms: RolePermissions
}): ReactNode {
  const { data: forms } = useForms()
  const setActions = useSetFormActions(roleId)
  const byForm = useMemo(() => {
    const m = new Map<number, Set<FormAction>>()
    for (const f of perms.forms) m.set(f.formId, new Set(f.actions))
    return m
  }, [perms.forms])

  const roots = (forms ?? []).filter((f) => f.parentFormId === null)

  const toggle = (formId: number, action: FormAction): void => {
    const current = new Set(byForm.get(formId) ?? [])
    if (current.has(action)) current.delete(action)
    else {
      current.add(action)
      if (current.size > 0) current.add("view") // 檢視為基礎
    }
    setActions.mutate({ formId, actions: [...current] })
  }

  return (
    <>
      <p className="mb-3 border-l-2 border-primary py-0.5 pl-3 text-[11.5px] text-ink-3">
        <b className="text-ink-2">deny-by-default</b>
        :未勾=無此動作(全無 → 該角色看不到此表單)。勾任一動作自動含「檢視」。
      </p>
      <div className="overflow-hidden rounded-lg border border-line bg-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-head">
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-3">表單</th>
              {FORM_ACTIONS.map((a) => (
                <th
                  key={a}
                  className="w-[52px] px-1 py-2 text-center text-[11px] font-semibold text-ink-3"
                >
                  {ACTION_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roots.map((f) => {
              const set = byForm.get(f.id) ?? new Set<FormAction>()
              return (
                <tr key={f.id} className="border-t border-line-2 hover:bg-surface">
                  <td className="px-3 py-2 font-medium text-ink">{f.name}</td>
                  {FORM_ACTIONS.map((a) => (
                    <td key={a} className="px-1 py-2 text-center">
                      <CheckBox
                        on={set.has(a)}
                        amber={a === "design"}
                        disabled={setActions.isPending}
                        onClick={() => toggle(f.id, a)}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
            {roots.length === 0 ? (
              <tr>
                <td colSpan={FORM_ACTIONS.length + 1} className="px-3 py-4 text-[12px] text-ink-4">
                  尚無表單。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  )
}

function CheckBox({
  on,
  amber,
  disabled,
  onClick,
}: {
  readonly on: boolean
  readonly amber?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}): ReactNode {
  const base =
    "inline-flex size-5 items-center justify-center rounded-[4px] border transition-colors disabled:opacity-50"
  const cls = on
    ? amber
      ? "border-wn bg-wn text-white"
      : "border-primary bg-primary text-white"
    : "border-line bg-card text-transparent hover:border-primary"
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`${base} ${cls}`}>
      <Check size={12} strokeWidth={2.6} />
    </button>
  )
}
