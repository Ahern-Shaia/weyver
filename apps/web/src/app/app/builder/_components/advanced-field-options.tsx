"use client"

import type { FieldDto, FormSummary } from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import type { ReactNode } from "react"
import type { PendingField } from "./edit-form-panel"

/* R1·UP-4c 順帶重整:自 `edit-form-panel`(422 行,超過 400 紅線)抽出進階欄型設定
   —— autoNumber 編號規則 / link 目標表 / lookup 來源 / rollup 聚合。
   純呈現元件,狀態仍由呼叫端持有(set)。 */
export function AdvancedFieldOptions({
  pending,
  set,
  forms,
  subtables,
  currentFields,
}: {
  readonly pending: PendingField
  readonly set: (patch: Partial<PendingField>) => void
  readonly forms: readonly FormSummary[]
  readonly subtables: readonly FormSummary[]
  readonly currentFields: readonly FieldDto[]
}): ReactNode {
  const t = pending.type
  const linkFields = currentFields.filter((f) => f.type === "link")
  return (
    <>
      {t === "autoNumber" ? (
        <div className="flex flex-wrap gap-2">
          <Input
            value={pending.prefix}
            onChange={(e) => set({ prefix: e.target.value })}
            placeholder="前綴,如 PO-"
            className="w-28"
          />
          <Select
            className="h-7"
            value={pending.dateFormat}
            onChange={(e) => set({ dateFormat: e.target.value })}
          >
            <option value="">無日期段</option>
            <option value="yyyy">yyyy</option>
            <option value="yyyyMM">yyyyMM</option>
            <option value="yyyyMMdd">yyyyMMdd</option>
          </Select>
          <Select
            className="h-7"
            value={pending.resetScope}
            onChange={(e) => set({ resetScope: e.target.value })}
          >
            <option value="none">不重設</option>
            <option value="daily">每日重設</option>
            <option value="monthly">每月重設</option>
            <option value="yearly">每年重設</option>
            <option value="field">依欄位重設</option>
          </Select>
          {pending.resetScope === "field" ? (
            <Select
              className="h-7"
              value={pending.resetField}
              onChange={(e) => set({ resetField: e.target.value })}
            >
              <option value="">選重設依據欄</option>
              {currentFields.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      ) : null}

      {t === "link" ? (
        <div className="flex flex-wrap gap-2">
          <Select
            className="h-7"
            value={pending.targetFormId}
            onChange={(e) => set({ targetFormId: e.target.value })}
          >
            <option value="">選目標表單</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <Input
            value={pending.displayFields}
            onChange={(e) => set({ displayFields: e.target.value })}
            placeholder="顯示欄(逗號,選填)"
            className="w-44"
          />
        </div>
      ) : null}

      {t === "lookup" ? (
        <div className="flex flex-wrap gap-2">
          <Select
            className="h-7"
            value={pending.linkFieldName}
            onChange={(e) => set({ linkFieldName: e.target.value })}
          >
            <option value="">選關聯欄</option>
            {linkFields.map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
          </Select>
          <Input
            value={pending.targetFieldName}
            onChange={(e) => set({ targetFieldName: e.target.value })}
            placeholder="目標欄名"
            className="w-32"
          />
          {linkFields.length === 0 ? (
            <span className="text-[10.5px] text-ink-4">需先加關聯欄</span>
          ) : null}
        </div>
      ) : null}

      {t === "rollup" ? (
        <div className="flex flex-wrap gap-2">
          <Select
            className="h-7"
            value={pending.childFormId}
            onChange={(e) => set({ childFormId: e.target.value })}
          >
            <option value="">選子表</option>
            {subtables.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <Input
            value={pending.childFieldName}
            onChange={(e) => set({ childFieldName: e.target.value })}
            placeholder="子表欄名"
            className="w-28"
          />
          <Select
            className="h-7"
            value={pending.rollupFn}
            onChange={(e) => set({ rollupFn: e.target.value })}
          >
            <option value="SUM">加總</option>
            <option value="COUNT">計數</option>
            <option value="AVERAGE">平均</option>
            <option value="MIN">最小</option>
            <option value="MAX">最大</option>
          </Select>
          {subtables.length === 0 ? (
            <span className="text-[10.5px] text-ink-4">需先加子表</span>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
