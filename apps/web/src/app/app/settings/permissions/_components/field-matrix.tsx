"use client"

import {
  FIELD_VISIBILITIES,
  type FieldVisibility,
  type RolePermissions,
  VISIBILITY_LABEL,
  useSetFieldVisibility,
} from "@/lib/engine/authz"
import { useForm, useForms } from "@/lib/engine/hooks"
import { Segmented } from "@weyver/ui/segmented"
import { Select } from "@weyver/ui/select"
import { type ReactNode, useMemo, useState } from "react"

/* 欄位可見性(Salesforce FLS 式;隱藏/唯讀/可寫),收斂於表單動作。 */
export function FieldMatrix({
  roleId,
  perms,
}: {
  readonly roleId: number
  readonly perms: RolePermissions
}): ReactNode {
  const { data: forms } = useForms()
  const roots = (forms ?? []).filter((f) => f.parentFormId === null)
  const [formId, setFormId] = useState<number | null>(null)
  const active = formId ?? roots[0]?.id ?? null
  const { data: form } = useForm(active)
  const setVis = useSetFieldVisibility(roleId)

  const byField = useMemo(() => {
    const m = new Map<number, FieldVisibility>()
    for (const f of perms.fields) m.set(f.fieldId, f.visibility)
    return m
  }, [perms.fields])

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[12px] text-ink-3">選表單</span>
        <Select value={active ?? ""} onChange={(e) => setFormId(Number(e.target.value))}>
          {roots.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      </div>
      <p className="mb-3 border-l-2 border-primary py-0.5 pl-3 text-[12px] text-ink-3">
        欄位可見性收斂於表單動作。<b className="text-ink-2">隱藏</b>
        =後端不回該欄值(非前端隱藏)。缺列繼承表單。
      </p>
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-head">
              <th className="px-3 py-2 text-left text-[12px] font-semibold text-ink-3">欄位</th>
              <th className="px-3 py-2 text-left text-[12px] font-semibold text-ink-3">型別</th>
              <th className="px-3 py-2 text-right text-[12px] font-semibold text-ink-3">可見性</th>
            </tr>
          </thead>
          <tbody>
            {(form?.fields ?? []).map((fld) => (
              <tr key={fld.id} className="border-t border-line-2 hover:bg-surface">
                <td className="px-3 py-2 font-medium text-ink">{fld.name}</td>
                <td className="px-3 py-2 font-mono text-[12px] text-ink-3">{fld.type}</td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex">
                    <Segmented
                      ariaLabel={`${fld.name} 可見性`}
                      value={byField.get(fld.id) ?? "read"}
                      onValueChange={(v) =>
                        setVis.mutate({ fieldId: fld.id, visibility: v as FieldVisibility })
                      }
                      options={FIELD_VISIBILITIES.map((v) => ({
                        label: VISIBILITY_LABEL[v],
                        value: v,
                      }))}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {form && form.fields.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-[12px] text-ink-3">
                  此表單尚無欄位。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  )
}
