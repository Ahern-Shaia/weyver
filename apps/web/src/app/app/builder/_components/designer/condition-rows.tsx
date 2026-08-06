"use client"

import { X } from "lucide-react"
import type { ReactNode } from "react"

import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"

import {
  FORMAT_OPERATOR_LABEL,
  PSEUDO_FIELD_LABEL,
  formatOperatorsFor,
  operatorNeedsRange,
} from "@/lib/engine/field-filters"
import type { CellValueType, FormatOperator } from "@/lib/engine/schemas"

/* 🔴 條件列編輯器。**條件式格式與事件觸發器共用。**

   ## 為什麼抽出來

   兩者的條件是**同一個形狀**(`{field, op, value}`),伺服器端也已經共用
   同一支求值器(`@weyver/rules` 的 `conditionsMatch`)。
   設定畫面若各寫一份,漂移的形態是「同一個條件在格式面設得起來、
   在觸發器面設不起來」—— 而使用者無從得知為什麼。

   本 repo 已為「兩份鏡射必然漂移」付過四次代價,不再開第五份。

   ## 這支不管「規則」只管「條件」

   組合子(全部符合 / 任一符合)、效果、目標欄位都留在各自的容器裡 ——
   那些兩邊本來就不同。抽出來的只有真正相同的那一段。 */
export interface ConditionRow {
  readonly field: string
  readonly op: string
  readonly value?: unknown
}

export function ConditionRows({
  conditions,
  fieldNames,
  fieldTypeOf,
  onChange,
  min = 1,
  max = 20,
}: {
  readonly conditions: readonly ConditionRow[]
  readonly fieldNames: readonly string[]
  readonly fieldTypeOf: (name: string) => CellValueType | undefined
  readonly onChange: (next: ConditionRow[]) => void
  readonly min?: number
  readonly max?: number
}): ReactNode {
  const setAt = (ci: number, next: Partial<ConditionRow>): void =>
    onChange(conditions.map((c, i) => (i === ci ? { ...c, ...next } : c)))

  return (
    <>
      {conditions.map((cond, ci) => {
        const ops = formatOperatorsFor(cond.field, fieldTypeOf(cond.field))
        const needsValue = cond.op !== "isEmpty" && cond.op !== "isNotEmpty"
        const needsRange = operatorNeedsRange(cond.op)
        /* 區間值以 `[from, to]` 存;非區間存單一值。UI 兩格,模型一個鍵。 */
        const range = Array.isArray(cond.value) ? cond.value.map(String) : ["", ""]
        const setRange = (i: 0 | 1, v: string): void => {
          const next = [range[0] ?? "", range[1] ?? ""]
          next[i] = v
          setAt(ci, { value: next })
        }
        return (
          <div key={`cond-${String(ci)}`} className="mb-2 flex flex-col gap-1">
            <Select
              className="h-7 w-full"
              value={cond.field}
              onChange={(e) => setAt(ci, { field: e.target.value })}
              aria-label={`條件 ${String(ci + 1)} 欄位`}
            >
              {fieldNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              {/* 🔴 虛擬欄位(Ragic `doc/6`「指定當前時間」/「指定使用者或群組」)。
                  放在同一個下拉裡而不是另開一種條件型別 —— 條件的形狀不變。 */}
              {Object.entries(PSEUDO_FIELD_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <Select
                className="h-7 flex-1"
                value={cond.op}
                onChange={(e) => setAt(ci, { op: e.target.value as FormatOperator })}
                aria-label={`條件 ${String(ci + 1)} 運算子`}
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {FORMAT_OPERATOR_LABEL[op] ?? op}
                  </option>
                ))}
              </Select>
              {needsRange ? (
                <>
                  <Input
                    className="h-7 flex-1"
                    value={range[0] ?? ""}
                    onChange={(e) => setRange(0, e.target.value)}
                    aria-label={`條件 ${String(ci + 1)} 起`}
                    placeholder={cond.op === "dailyBetween" ? "09:00" : "2026-03-01"}
                  />
                  <Input
                    className="h-7 flex-1"
                    value={range[1] ?? ""}
                    onChange={(e) => setRange(1, e.target.value)}
                    aria-label={`條件 ${String(ci + 1)} 迄`}
                    placeholder={cond.op === "dailyBetween" ? "18:00" : "2026-03-05"}
                  />
                </>
              ) : needsValue ? (
                <Input
                  className="h-7 flex-1"
                  value={typeof cond.value === "string" ? cond.value : ""}
                  onChange={(e) => setAt(ci, { value: e.target.value })}
                  aria-label={`條件 ${String(ci + 1)} 值`}
                />
              ) : (
                <span className="flex-1" />
              )}
              <button
                type="button"
                onClick={() => onChange(conditions.filter((_, i) => i !== ci))}
                disabled={conditions.length <= min}
                aria-label={`移除條件 ${String(ci + 1)}`}
                className="text-ink-disabled hover:text-er disabled:opacity-30"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onChange([...conditions, { field: fieldNames[0] ?? "", op: "isNotEmpty" }])}
        disabled={conditions.length >= max}
        className="text-[12px] text-primary hover:underline disabled:opacity-40"
      >
        ＋ 新增條件
      </button>
    </>
  )
}
