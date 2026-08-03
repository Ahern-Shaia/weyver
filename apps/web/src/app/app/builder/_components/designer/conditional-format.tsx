"use client"

import { evaluateFormats } from "@/lib/engine/conditional-format"
import { OPERATOR_LABEL, fieldOperators } from "@/lib/engine/field-filters"
import type {
  ConditionalFormats,
  FieldDto,
  FilterOperator,
  FormatRule,
  RecordRow,
} from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { CHIP_TONES, type ChipTone, StatusChip } from "@weyver/ui/status-chip"
import { Copy, Plus, X } from "lucide-react"
import { type ReactNode, useState } from "react"

/* R1·UP-3b 條件式格式設定面板(OQ-CF-1/3/7)。

   Ragic 範式:**表單級**設定,**記錄頁與列表頁各自一組**規則(兩面資訊密度不同,
   常需不同強度)→ 提供「複製到另一面」緩解設定兩次的成本。

   **覆蓋序為「後者覆蓋」**(OQ-CF-3=A):與多數人對規則清單的直覺(上面優先)相反,
   故清單下方**常駐提示**,且即時預覽隨排序變動 —— 這是採此序的必要配套(FMEA G5)。 */

type Face = "record" | "list"

const EMPTY: ConditionalFormats = { record: [], list: [] }
const TONE_LABEL: Partial<Record<ChipTone, string>> = {
  ok: "完成",
  warn: "待辦",
  error: "異常",
  neutral: "中性",
}

function newRule(field: string): FormatRule {
  return {
    combinator: "and",
    conditions: [{ field, op: "isNotEmpty" }],
    targets: [],
    effects: [{ kind: "color", tone: "warn" }],
    enabled: true,
  }
}

/* 🔴 OQ-CF-8 = C-1:規則已升為 `effects[]`,但**這個編輯器目前只編得了顏色**。
   刻意如此 —— C-1 只改形狀不擴效果面。取最後一個 color 與求值器同語意。
   C-2 落地時這裡才會出現效果種類的選擇器。 */
function toneOf(rule: FormatRule): ChipTone {
  return rule.effects.reduce<ChipTone>((acc, e) => (e.kind === "color" ? e.tone : acc), "neutral")
}

function toggleEffect(rule: FormatRule, kind: "hide" | "readonly"): Partial<FormatRule> {
  const has = rule.effects.some((e) => e.kind === kind)
  const next = has
    ? rule.effects.filter((e) => e.kind !== kind)
    : [...rule.effects, { kind } as const]
  /* 規則至少要有一個效果(schema `min(1)`)—— 全關掉時退回無色的中性,
     而不是送出一條會被後端擋下的規則 */
  return { effects: next.length > 0 ? next : [{ kind: "color", tone: "neutral" }] }
}

function withTone(rule: FormatRule, tone: ChipTone): Partial<FormatRule> {
  const rest = rule.effects.filter((e) => e.kind !== "color")
  return { effects: [...rest, { kind: "color", tone }] }
}

function describe(rule: FormatRule): string {
  const joiner = rule.combinator === "or" ? " 或 " : " 且 "
  return rule.conditions
    .map((c) => {
      const op = OPERATOR_LABEL[c.op] ?? c.op
      const v = c.value === undefined || c.value === "" ? "" : ` ${String(c.value)}`
      return `${c.field} ${op}${v}`
    })
    .join(joiner)
}

export function ConditionalFormatPanel({
  fields,
  formats,
  sample,
  onChange,
  onClose,
}: {
  readonly fields: readonly FieldDto[]
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

            {rule.conditions.map((cond, ci) => {
              const field = fields.find((f) => f.name === cond.field)
              const ops: readonly FilterOperator[] = field ? fieldOperators(field.type) : []
              const needsValue = cond.op !== "isEmpty" && cond.op !== "isNotEmpty"
              const setCond = (next: Partial<typeof cond>): void =>
                patch(selected, {
                  conditions: rule.conditions.map((c, i) => (i === ci ? { ...c, ...next } : c)),
                })
              return (
                <div key={`cond-${ci}`} className="mb-2 flex flex-col gap-1">
                  <Select
                    className="h-7 w-full"
                    value={cond.field}
                    onChange={(e) => setCond({ field: e.target.value })}
                    aria-label={`條件 ${ci + 1} 欄位`}
                  >
                    {fieldNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <Select
                      className="h-7 flex-1"
                      value={cond.op}
                      onChange={(e) => setCond({ op: e.target.value as FilterOperator })}
                      aria-label={`條件 ${ci + 1} 運算子`}
                    >
                      {ops.map((op) => (
                        <option key={op} value={op}>
                          {OPERATOR_LABEL[op] ?? op}
                        </option>
                      ))}
                    </Select>
                    {needsValue ? (
                      <Input
                        className="h-7 flex-1"
                        value={typeof cond.value === "string" ? cond.value : ""}
                        onChange={(e) => setCond({ value: e.target.value })}
                        aria-label={`條件 ${ci + 1} 值`}
                      />
                    ) : (
                      <span className="flex-1" />
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        patch(selected, {
                          conditions: rule.conditions.filter((_, i) => i !== ci),
                        })
                      }
                      disabled={rule.conditions.length <= 1}
                      aria-label={`移除條件 ${ci + 1}`}
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
              onClick={() =>
                patch(selected, {
                  conditions: [
                    ...rule.conditions,
                    { field: fieldNames[0] ?? "", op: "isNotEmpty" as FilterOperator },
                  ],
                })
              }
              disabled={rule.conditions.length >= 20}
              className="text-[12px] text-primary hover:underline disabled:opacity-40"
            >
              ＋ 加條件
            </button>

            <div className="mt-3">
              <div className="mb-1 text-[12px] text-ink-3">
                套用到哪些欄位(不選 = 條件所涉之欄位)
              </div>
              <div className="flex flex-wrap gap-1">
                {fieldNames.map((n) => {
                  const on = rule.targets.includes(n)
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() =>
                        patch(selected, {
                          targets: on ? rule.targets.filter((t) => t !== n) : [...rule.targets, n],
                        })
                      }
                      className={`rounded-xs border px-1.5 py-0.5 text-[12px] ${
                        on ? "border-primary bg-primary-t text-primary" : "border-line text-ink-3"
                      }`}
                    >
                      {n}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-3">
              {/* 🔴 C-2:效果種類。**加 schema 的同一批就要加寫入端** ——
                  否則就是又造一個「欄位存在、沒人寫得進去」的陷阱,
                  而 form-designer-2d 的 colWidths 剛因為同一個理由被移除。 */}
              <div className="mb-1 text-[12px] text-ink-3">效果(可複選)</div>
              <div className="mb-2 flex flex-wrap gap-1">
                {(["hide", "readonly"] as const).map((kind) => {
                  const on = rule.effects.some((e) => e.kind === kind)
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => patch(selected, toggleEffect(rule, kind))}
                      aria-pressed={on}
                      className={`rounded-xs border px-2 py-0.5 text-[12px] ${
                        on
                          ? "border-primary bg-primary-t text-primary"
                          : "border-line-2 bg-card text-ink-2 hover:bg-hover"
                      }`}
                    >
                      {kind === "hide" ? "隱藏欄位" : "設為唯讀"}
                    </button>
                  )
                })}
              </div>
              {/* 隱藏不是權限 —— Ragic / Airtable 官方都明文警告過,這裡照講 */}
              <p className="mb-2 text-[12px] text-ink-3">
                隱藏與唯讀為版面層效果,擋不住 API。欄位級保護請用權限設定。
              </p>
              <div className="mb-1 text-[12px] text-ink-3">顏色(12 色受控色盤)</div>
              <div className="flex flex-wrap gap-1">
                {CHIP_TONES.map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    onClick={() => patch(selected, withTone(rule, tone))}
                    aria-label={`顏色 ${tone}`}
                    className={
                      toneOf(rule) === tone ? "outline-2 outline-primary outline-offset-1" : ""
                    }
                  >
                    <StatusChip tone={tone}>{TONE_LABEL[tone] ?? tone}</StatusChip>
                  </button>
                ))}
              </div>
            </div>
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
