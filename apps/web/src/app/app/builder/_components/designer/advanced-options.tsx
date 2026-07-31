"use client"

import type { FieldDto, FormSummary } from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import type { ReactNode } from "react"
import type { PendingField } from "@/app/app/builder/_components/shell/edit-form"

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
            <span className="text-[10.5px] text-ink-3">需先加關聯欄</span>
          ) : null}
          {/* 🔴 #113:刻意不出現 live / snapshot 這種術語 —— 業界無一家用它當文案。
              問題直接問使用者真正在乎的事:之後主檔改了,這張單據上的內容要不要跟著變。 */}
          <fieldset className="mt-1 w-full border-0 p-0">
            <legend className="mb-1 text-[10.5px] text-ink-3">
              這個欄位的內容,之後要不要跟著來源主檔一起變?
            </legend>
            <label className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <input
                type="radio"
                name="lookup-sync"
                checked={pending.lookupKeepsValue}
                onChange={() => set({ lookupKeepsValue: true })}
                className="accent-pri"
              />
              保留填單當時的內容<span className="text-ink-3">(建議)</span>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <input
                type="radio"
                name="lookup-sync"
                checked={!pending.lookupKeepsValue}
                onChange={() => set({ lookupKeepsValue: false })}
                className="accent-pri"
              />
              永遠顯示最新內容
              <span className="text-warn">⚠ 包含去年的舊單據</span>
            </label>
          </fieldset>
        </div>
      ) : null}

      {t === "member" ? (
        <label className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
          <input
            type="checkbox"
            checked={pending.grantsAccess}
            onChange={(e) => set({ grantsAccess: e.target.checked })}
            className="mt-0.5 accent-pri"
          />
          <span>
            指派即授權
            <span className="ml-1 text-ink-3">
              —— 被指派到此欄的人可存取該筆記錄(用於「業務只看自己的客戶」)
            </span>
          </span>
        </label>
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
            <span className="text-[10.5px] text-ink-3">需先加子表</span>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
