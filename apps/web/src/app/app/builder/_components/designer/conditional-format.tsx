"use client"

import { ConditionRows } from "@/app/app/builder/_components/designer/condition-rows"
import {
  RuleEffects,
  TONE_LABEL,
  toneOf,
} from "@/app/app/builder/_components/designer/conditional-format-effects"
import { evaluateFormats } from "@/lib/engine/conditional-format"
import { FORMAT_OPERATOR_LABEL, PSEUDO_FIELD_LABEL } from "@/lib/engine/field-filters"
import { useButtons } from "@/lib/engine/hooks"
import type {
  ConditionalFormats,
  FieldDto,
  FormatRule,
  RecordRow,
  Section,
} from "@/lib/engine/schemas"
import { type ChipTone, StatusChip } from "@weyver/ui/status-chip"
import { Copy, Plus, X } from "lucide-react"
import { type ReactNode, useState } from "react"

/* R1·UP-3b 條件式格式設定面板(OQ-CF-1/3/7)。

   Ragic 範式:**表單級**設定,**記錄頁與列表頁各自一組**規則(兩面資訊密度不同,
   常需不同強度)→ 提供「複製到另一面」緩解設定兩次的成本。

   **覆蓋序為「後者覆蓋」**(OQ-CF-3=A):與多數人對規則清單的直覺(上面優先)相反,
   故清單下方**常駐提示**,且即時預覽隨排序變動 —— 這是採此序的必要配套(FMEA G5)。 */

type Face = "record" | "list"

const EMPTY: ConditionalFormats = { record: [], list: [] }

function newRule(field: string): FormatRule {
  return {
    combinator: "and",
    conditions: [{ field, op: "isNotEmpty" }],
    targets: [],
    targetSections: [],
    targetButtons: [],
    targetApproval: false,
    effects: [{ kind: "color", tone: "warn" }],
    enabled: true,
  }
}

function describe(rule: FormatRule): string {
  const joiner = rule.combinator === "or" ? " 或 " : " 且 "
  return rule.conditions
    .map((c) => {
      const op = FORMAT_OPERATOR_LABEL[c.op] ?? c.op
      const v = c.value === undefined || c.value === "" ? "" : ` ${String(c.value)}`
      return `${PSEUDO_FIELD_LABEL[c.field] ?? c.field} ${op}${v}`
    })
    .join(joiner)
}

export function ConditionalFormatPanel({
  formId,
  fields,
  sections,
  formats,
  sample,
  onChange,
  onClose,
}: {
  readonly formId: number
  readonly fields: readonly FieldDto[]
  /* 分段用作**目標選擇器**(OQ-CF-9);由畫布傳入現行版面的分段 */
  readonly sections: readonly Section[]
  readonly formats: ConditionalFormats | undefined
  /* 即時預覽取本表第一筆(無記錄時預覽區顯示提示) */
  readonly sample: RecordRow | undefined
  readonly onChange: (next: ConditionalFormats) => void
  readonly onClose: () => void
}): ReactNode {
  const current = formats ?? EMPTY
  const [face, setFace] = useState<Face>("record")
  const [selected, setSelected] = useState(0)
  const rules = current[face]
  const fieldNames = fields.map((f) => f.name)

  /* C-3|按鈕可當規則目標(記錄頁);清單本來就要抓,不新增端點 */
  const { data: buttonRows = [] } = useButtons(fields.length > 0 ? formId : null)
  const buttons = buttonRows.map((b) => ({ id: b.id, label: b.label }))

  const setRules = (next: FormatRule[]): void => onChange({ ...current, [face]: next })
  const patch = (index: number, next: Partial<FormatRule>): void =>
    setRules(rules.map((r, i) => (i === index ? { ...r, ...next } : r)))

  const rule = rules[selected]
  const preview =
    sample === undefined
      ? new Map<string, ChipTone>()
      : evaluateFormats(rules, sample.values, fieldNames)

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-card">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[12px] font-semibold text-ink-2">條件式格式</span>
        <div className="ml-1 inline-flex overflow-hidden rounded-xs border border-line">
          {(["record", "list"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFace(f)
                setSelected(0)
              }}
              className={
                face === f
                  ? "bg-primary px-2.5 py-0.5 text-[12px] font-semibold text-white"
                  : "px-2.5 py-0.5 text-[12px] text-ink-2 hover:bg-head"
              }
            >
              {f === "record" ? "記錄頁" : "列表頁"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="ml-auto text-ink-3 hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* 規則清單 */}
        <div className="flex flex-col">
          {rules.map((r, i) => (
            <button
              key={`rule-${i}`}
              type="button"
              onClick={() => setSelected(i)}
              className={`flex items-center gap-2 border border-line-2 px-2 py-1.5 text-left ${
                i > 0 ? "border-t-0" : ""
              } ${i === selected ? "border-primary bg-primary-t" : "bg-card hover:bg-head"}`}
            >
              <span className="truncate text-[12px] text-ink-2">{describe(r)}</span>
              <StatusChip tone={toneOf(r)} className="ml-auto shrink-0">
                {TONE_LABEL[toneOf(r)] ?? toneOf(r)}
              </StatusChip>
              <span className="shrink-0 text-[12px] text-ink-3">
                → {r.targets.length > 0 ? r.targets.join("、") : "條件欄"}
              </span>
            </button>
          ))}
        </div>

        {rules.length > 1 ? (
          <div className="mt-1.5 border border-wn-line bg-wn-t px-2 py-1 text-[12px] text-wn">
            <b>排越後面越優先</b> —— 同一欄位命中多條規則時,以最下面那條為準。
          </div>
        ) : null}

        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onChange({ ...current, [face === "record" ? "list" : "record"]: [...rules] })
            }
            disabled={rules.length === 0}
            className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-primary disabled:opacity-40"
          >
            <Copy size={11} />
            複製到{face === "record" ? "列表頁" : "記錄頁"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setRules([...rules, newRule(fieldNames[0] ?? "")])
            setSelected(rules.length)
          }}
          disabled={rules.length >= 20 || fieldNames.length === 0}
          className="mt-2 flex items-center gap-1 text-[12px] text-primary hover:underline disabled:opacity-40"
        >
          <Plus size={12} />
          新增規則
        </button>

        {/* 規則編輯 */}
        {rule !== undefined ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[12px] text-ink-3">條件</span>
              <div className="inline-flex overflow-hidden rounded-xs border border-line">
                {(["and", "or"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => patch(selected, { combinator: c })}
                    className={
                      rule.combinator === c
                        ? "bg-primary px-2 py-0.5 text-[12px] font-semibold text-white"
                        : "px-2 py-0.5 text-[12px] text-ink-2 hover:bg-head"
                    }
                  >
                    {c === "and" ? "全部符合" : "任一符合"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRules(rules.filter((_, i) => i !== selected))}
                className="ml-auto text-[12px] text-ink-3 hover:text-er"
              >
                刪除規則
              </button>
            </div>

            <ConditionRows
              conditions={rule.conditions}
              fieldNames={fieldNames}
              fieldTypeOf={(n) => fields.find((f) => f.name === n)?.type}
              onChange={(next) => patch(selected, { conditions: next as FormatRule["conditions"] })}
            />

            <RuleEffects
              rule={rule}
              fieldNames={fieldNames}
              sections={sections}
              buttons={buttons}
              face={face}
              patch={(next) => patch(selected, next)}
            />
          </div>
        ) : null}

        {/* 即時預覽 */}
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1.5 text-[12px] text-ink-3">即時預覽(本表第一筆)</div>
          {sample === undefined ? (
            <div className="text-[12px] text-ink-3">尚無記錄可預覽。</div>
          ) : (
            <div className="grid grid-cols-[84px_1fr] gap-x-2">
              {fields.map((f) => {
                const tone = preview.get(f.name)
                return (
                  <div key={f.id} className="contents">
                    <div className="border-b border-line-2 py-1 text-[12px] text-ink-3">
                      {f.name}
                    </div>
                    <div className="border-b border-line-2 py-1 text-[12px]">
                      {tone === undefined ? (
                        <span className="text-ink">{String(sample.values[f.name] ?? "—")}</span>
                      ) : (
                        <StatusChip tone={tone}>{String(sample.values[f.name] ?? "—")}</StatusChip>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
