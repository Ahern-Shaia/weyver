"use client"

import { choicesOf, toSubmitValue } from "@/components/form/value"
import { OPERATOR_LABEL, fieldOperators, operatorNeedsValue } from "@/lib/engine/field-filters"
import { GROUP_AGGREGATE_FNS } from "@/lib/engine/schemas"
import type { GROUP_DATE_UNITS } from "@/lib/engine/schemas"
import type {
  FieldDto,
  FilterOperator,
  FormDto,
  ViewConfig,
  ViewDto,
  ViewFilterCondition,
} from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { Filter, Pin, Plus, Save, Star, Trash2, X } from "lucide-react"
import { type ReactNode, useState } from "react"

/* R1·UP-2 集合視圖控制列:儲存檢視三態選擇 + facet 篩選(型別感知 operator,單層 AND|OR)+ 多鍵排序。
   anyOf(多選集合)本期不入 UI(留 P1)→ 篩選值皆 scalar,經 toSubmitValue 轉正確型別。 */
const AGG_LABEL: Record<(typeof GROUP_AGGREGATE_FNS)[number], string> = {
  count: "筆數",
  empty: "空白數",
  filled: "已填數",
  sum: "加總",
  avg: "平均",
  min: "最小",
  max: "最大",
}

export function ListControls({
  form,
  views,
  activeViewId,
  config,
  isAdmin,
  onSelectView,
  onConfigChange,
  onSaveNew,
  onUpdate,
  onSetDefault,
  onDelete,
}: {
  readonly form: FormDto
  readonly views: readonly ViewDto[]
  readonly activeViewId: number | null
  readonly config: ViewConfig
  readonly isAdmin: boolean
  readonly onSelectView: (id: number | null) => void
  readonly onConfigChange: (config: ViewConfig) => void
  readonly onSaveNew: (name: string, scope: "personal" | "shared") => void
  readonly onUpdate: () => void
  readonly onSetDefault: () => void
  readonly onDelete: () => void
}): ReactNode {
  const [panel, setPanel] = useState<"filter" | "sort" | "group" | "freeze" | null>(null)
  const activeView = views.find((v) => v.id === activeViewId) ?? null
  // formula/計算型讀時算(無可篩物理欄)、attachment 無序 → 皆不入篩選欄(空 operator 亦排除)
  const filterable = form.fields.filter(
    (f) => f.type !== "attachment" && f.type !== "formula" && fieldOperators(f.type).length > 0,
  )
  const conditions = config.filter.conditions
  const sorts = config.sorts
  const groups = config.groupBy
  const frozen = config.freezeColumns
  const aggregates = config.aggregates
  /* 小計只對數值型別有意義(count 例外,但它已是每組的預設顯示) */
  const numericFields = form.fields.filter((f) => ["number", "money", "percent"].includes(f.type))

  const setFilter = (next: Partial<ViewConfig["filter"]>): void =>
    onConfigChange({ ...config, filter: { ...config.filter, ...next } })
  const setConditions = (conds: ViewFilterCondition[]): void => setFilter({ conditions: conds })

  const addCondition = (): void => {
    const first = filterable[0]
    if (first === undefined) return
    const op = fieldOperators(first.type).filter((o) => o !== "anyOf")[0] ?? "eq"
    setConditions([...conditions, { field: first.name, op, value: "" }])
  }
  const addSort = (): void => {
    const first = form.fields[0]
    if (first === undefined) return
    onConfigChange({ ...config, sorts: [...sorts, { field: first.name, dir: "asc" }] })
  }
  const addGroup = (): void => {
    const first = form.fields[0]
    if (first === undefined) return
    onConfigChange({ ...config, groupBy: [...groups, { field: first.name, dir: "asc" }] })
  }

  const saveNew = (): void => {
    const name = window.prompt("檢視名稱")
    if (name === null || name.trim() === "") return
    const scope =
      isAdmin && window.confirm("設為共通(全租戶可見)?取消 = 個人") ? "shared" : "personal"
    onSaveNew(name.trim(), scope)
  }

  return (
    <div className="shrink-0 border-b border-line bg-card">
      <div className="flex h-9 items-center gap-2 px-4 text-[12px]">
        <Select
          className="h-7 w-44"
          value={activeViewId === null ? "" : String(activeViewId)}
          onChange={(e) => onSelectView(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">預設檢視(全部)</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.scope === "shared" ? "共通・" : "個人・"}
              {v.name}
              {v.isDefault ? "(預設)" : ""}
            </option>
          ))}
        </Select>

        <ToggleChip
          active={panel === "filter"}
          onClick={() => setPanel(panel === "filter" ? null : "filter")}
        >
          <Filter size={13} strokeWidth={1.9} />
          篩選{conditions.length > 0 ? ` ${conditions.length}` : ""}
        </ToggleChip>
        <ToggleChip
          active={panel === "sort"}
          onClick={() => setPanel(panel === "sort" ? null : "sort")}
        >
          排序{sorts.length > 0 ? ` ${sorts.length}` : ""}
        </ToggleChip>
        <ToggleChip
          active={panel === "group"}
          onClick={() => setPanel(panel === "group" ? null : "group")}
        >
          分組{groups.length > 0 ? ` ${groups.length}` : ""}
        </ToggleChip>
        {/* 🔴 凍結欄(`grid-paste.md` §8)。Ragic 放在「設計模式 → 表單工具 → 設定凍結」,
            我方對應到檢視工具列 —— 它是**這個檢視**的欄位版面,與選欄同層級。 */}
        <ToggleChip
          active={panel === "freeze"}
          onClick={() => setPanel(panel === "freeze" ? null : "freeze")}
        >
          <Pin size={13} strokeWidth={1.9} />
          凍結{frozen > 0 ? ` ${frozen}` : ""}
        </ToggleChip>

        <div className="ml-auto flex items-center gap-1.5">
          <ActBtn onClick={saveNew}>
            <Plus size={13} strokeWidth={2} />
            另存
          </ActBtn>
          {activeView && !activeView.locked ? (
            <ActBtn onClick={onUpdate}>
              <Save size={13} strokeWidth={1.9} />
              更新
            </ActBtn>
          ) : null}
          {activeView && isAdmin && activeView.scope === "shared" && !activeView.isDefault ? (
            <ActBtn onClick={onSetDefault}>
              <Star size={13} strokeWidth={1.9} />
              設為預設
            </ActBtn>
          ) : null}
          {activeView && !activeView.locked ? (
            <ActBtn onClick={onDelete} tone="danger">
              <Trash2 size={13} strokeWidth={1.9} />
              刪除
            </ActBtn>
          ) : null}
        </div>
      </div>

      {panel === "filter" ? (
        <div className="border-t border-line bg-surface px-4 py-2.5">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-3">
            <span>符合</span>
            <Select
              className="h-6"
              value={config.filter.combinator}
              onChange={(e) => setFilter({ combinator: e.target.value === "or" ? "or" : "and" })}
            >
              <option value="and">全部條件(AND)</option>
              <option value="or">任一條件(OR)</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            {conditions.map((cond, i) => (
              <ConditionRow
                // biome-ignore lint/suspicious/noArrayIndexKey: 條件列無穩定 id,序即身分
                key={i}
                fields={filterable}
                cond={cond}
                onChange={(next) => setConditions(conditions.map((c, j) => (j === i ? next : c)))}
                onRemove={() => setConditions(conditions.filter((_, j) => j !== i))}
              />
            ))}
            <button
              type="button"
              onClick={addCondition}
              className="mt-0.5 flex w-fit items-center gap-1 text-[12px] text-primary hover:underline"
            >
              <Plus size={12} strokeWidth={2} />
              加條件
            </button>
          </div>
        </div>
      ) : null}

      {panel === "freeze" ? (
        <div className="border-t border-line bg-surface px-4 py-2.5">
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <span>從左邊起凍結</span>
            <Select
              className="h-7 w-20"
              aria-label="凍結欄數"
              value={String(frozen)}
              onChange={(e) => {
                onConfigChange({ ...config, freezeColumns: Number(e.target.value) })
              }}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n === 0 ? "不凍結" : `${String(n)} 欄`}
                </option>
              ))}
            </Select>
          </label>
          {/* 🔴 講清楚它只凍欄不凍列 —— Ragic 逐字「列表頁只能設定凍結欄」,
              使用者若期待凍結列而找不到,會以為是壞的。 */}
          <p className="mt-1.5 text-[12px] text-ink-3">
            凍結的欄橫向捲動時固定在左側。列表頁只能凍結欄。
          </p>
        </div>
      ) : null}

      {panel === "group" ? (
        <div className="border-t border-line bg-surface px-4 py-2.5">
          <div className="flex flex-col gap-1.5">
            {groups.map((g, i) => {
              const field = form.fields.find((f) => f.name === g.field)
              const isDate = field?.type === "date" || field?.type === "dateTime"
              return (
                <div key={`${g.field}-${String(i)}`} className="flex items-center gap-2">
                  <Select
                    className="h-7 w-40"
                    aria-label={`分組欄位 ${String(i + 1)}`}
                    value={g.field}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        groupBy: groups.map((x, j) =>
                          j === i ? { ...x, field: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    {form.fields.map((f) => (
                      <option key={f.id} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                  {/* 日期欄的分組粒度 —— Ragic 原生有,Airtable 需繞公式欄 */}
                  {isDate ? (
                    <Select
                      className="h-7 w-24"
                      aria-label={`分組粒度 ${String(i + 1)}`}
                      value={g.unit ?? "day"}
                      onChange={(e) =>
                        onConfigChange({
                          ...config,
                          groupBy: groups.map((x, j) =>
                            j === i
                              ? { ...x, unit: e.target.value as (typeof GROUP_DATE_UNITS)[number] }
                              : x,
                          ),
                        })
                      }
                    >
                      <option value="day">依日</option>
                      <option value="month">依月</option>
                      <option value="quarter">依季</option>
                      <option value="year">依年</option>
                    </Select>
                  ) : null}
                  <Select
                    className="h-7 w-24"
                    aria-label={`分組方向 ${String(i + 1)}`}
                    value={g.dir}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        groupBy: groups.map((x, j) =>
                          j === i ? { ...x, dir: e.target.value === "desc" ? "desc" : "asc" } : x,
                        ),
                      })
                    }
                  >
                    <option value="asc">升冪</option>
                    <option value="desc">降冪</option>
                  </Select>
                  <button
                    type="button"
                    onClick={() =>
                      onConfigChange({ ...config, groupBy: groups.filter((_, j) => j !== i) })
                    }
                    className="text-ink-3 hover:text-er"
                    aria-label="移除分組"
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })}
            {/* 3 層是業界收斂值(Airtable 3 / Teable 3 / Notion 2);再深 UI 已不可讀 */}
            {groups.length < 3 ? (
              <button
                type="button"
                onClick={addGroup}
                className="mt-0.5 flex w-fit items-center gap-1 text-[12px] text-primary hover:underline"
              >
                <Plus size={12} strokeWidth={2} />
                加入分組欄位
              </button>
            ) : (
              <span className="text-[12px] text-ink-3">最多 3 層</span>
            )}
            {/* 🔴 audit-E §3-1|**小計原本只能打 API 設**。
                本模組把 `aggregates` 加進了後端 schema、列表也已經在畫它,
                但設定的入口一直沒有 —— 而下面那句「每組的筆數與小計由伺服器計算」
                讀起來像是已經可以設了。 */}
            {groups.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1.5 border-t border-line-2 pt-2">
                <span className="text-[12px] text-ink-3">小計</span>
                {aggregates.map((a, i) => (
                  <div key={`${a.field}-${String(i)}`} className="flex items-center gap-2">
                    <Select
                      className="h-7 w-32"
                      aria-label={`小計 ${String(i + 1)} 欄位`}
                      value={a.field}
                      onChange={(e) =>
                        onConfigChange({
                          ...config,
                          aggregates: aggregates.map((x, j) =>
                            j === i ? { ...x, field: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      {numericFields.map((f) => (
                        <option key={f.id} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      className="h-7 w-24"
                      aria-label={`小計 ${String(i + 1)} 函數`}
                      value={a.fn}
                      onChange={(e) =>
                        onConfigChange({
                          ...config,
                          aggregates: aggregates.map((x, j) =>
                            j === i
                              ? { ...x, fn: e.target.value as (typeof GROUP_AGGREGATE_FNS)[number] }
                              : x,
                          ),
                        })
                      }
                    >
                      {GROUP_AGGREGATE_FNS.map((fn) => (
                        <option key={fn} value={fn}>
                          {AGG_LABEL[fn]}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      onClick={() =>
                        onConfigChange({
                          ...config,
                          aggregates: aggregates.filter((_, j) => j !== i),
                        })
                      }
                      className="text-ink-3 hover:text-er"
                      aria-label={`移除小計 ${String(i + 1)}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {numericFields.length === 0 ? (
                  /* 說出為什麼加不了,不要給一個按下去沒反應的按鈕 */
                  <span className="text-[12px] text-ink-3">本表沒有數值 / 金額欄可小計。</span>
                ) : aggregates.length < 10 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const first = numericFields[0]
                      if (first !== undefined)
                        onConfigChange({
                          ...config,
                          aggregates: [...aggregates, { field: first.name, fn: "sum" }],
                        })
                    }}
                    className="flex w-fit items-center gap-1 text-[12px] text-primary hover:underline"
                  >
                    <Plus size={12} strokeWidth={2} />
                    加入小計
                  </button>
                ) : null}
                <p className="text-[12px] text-ink-3">
                  每組的筆數與小計由伺服器計算,只會統計你有權檢視的記錄。
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {panel === "sort" ? (
        <div className="border-t border-line bg-surface px-4 py-2.5">
          <div className="flex flex-col gap-1.5">
            {sorts.map((s, i) => (
              <div key={`${s.field}-${i}`} className="flex items-center gap-2">
                <Select
                  className="h-7 w-40"
                  value={s.field}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      sorts: sorts.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)),
                    })
                  }
                >
                  {form.fields.map((f) => (
                    <option key={f.id} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </Select>
                <Select
                  className="h-7 w-24"
                  value={s.dir}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      sorts: sorts.map((x, j) =>
                        j === i ? { ...x, dir: e.target.value === "desc" ? "desc" : "asc" } : x,
                      ),
                    })
                  }
                >
                  <option value="asc">升冪</option>
                  <option value="desc">降冪</option>
                </Select>
                <button
                  type="button"
                  onClick={() =>
                    onConfigChange({ ...config, sorts: sorts.filter((_, j) => j !== i) })
                  }
                  className="text-ink-3 hover:text-er"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {sorts.length < 5 ? (
              <button
                type="button"
                onClick={addSort}
                className="mt-0.5 flex w-fit items-center gap-1 text-[12px] text-primary hover:underline"
              >
                <Plus size={12} strokeWidth={2} />
                加排序鍵
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ConditionRow({
  fields,
  cond,
  onChange,
  onRemove,
}: {
  readonly fields: readonly FieldDto[]
  readonly cond: ViewFilterCondition
  readonly onChange: (next: ViewFilterCondition) => void
  readonly onRemove: () => void
}): ReactNode {
  const field = fields.find((f) => f.name === cond.field) ?? fields[0]
  if (field === undefined) return null
  const ops = fieldOperators(field.type).filter((o) => o !== "anyOf")
  const choices =
    field.type === "singleSelect" || field.type === "multiSelect" ? choicesOf(field) : null

  return (
    <div className="flex items-center gap-2">
      <Select
        className="h-7 w-40"
        value={cond.field}
        onChange={(e) => {
          const nf = fields.find((f) => f.name === e.target.value)
          const nextOps = nf ? fieldOperators(nf.type).filter((o) => o !== "anyOf") : ops
          onChange({ field: e.target.value, op: nextOps[0] ?? "eq", value: "" })
        }}
      >
        {fields.map((f) => (
          <option key={f.id} value={f.name}>
            {f.name}
          </option>
        ))}
      </Select>
      <Select
        className="h-7 w-28"
        value={cond.op}
        onChange={(e) => onChange({ ...cond, op: e.target.value as FilterOperator })}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABEL[op]}
          </option>
        ))}
      </Select>
      {operatorNeedsValue(cond.op) ? (
        choices ? (
          <Select
            className="h-7 w-40"
            value={typeof cond.value === "string" ? cond.value : ""}
            onChange={(e) => onChange({ ...cond, value: e.target.value })}
          >
            <option value="">—</option>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            className="h-7 w-40"
            value={cond.value === null || cond.value === undefined ? "" : String(cond.value)}
            onChange={(e) => onChange({ ...cond, value: toSubmitValue(field, e.target.value) })}
          />
        )
      ) : (
        <span className="w-40" />
      )}
      <button type="button" onClick={onRemove} className="text-ink-3 hover:text-er">
        <X size={14} />
      </button>
    </div>
  )
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex items-center gap-1 rounded-xs border border-primary bg-primary-t px-2 py-1 text-[12px] text-primary"
          : "flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-[12px] text-ink-3 hover:border-primary hover:text-primary"
      }
    >
      {children}
    </button>
  )
}

function ActBtn({
  onClick,
  children,
  tone,
}: {
  readonly onClick: () => void
  readonly children: ReactNode
  readonly tone?: "danger"
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        tone === "danger"
          ? "flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-[12px] text-er hover:border-er hover:bg-er-t"
          : "flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-[12px] text-ink-3 hover:border-primary hover:text-primary"
      }
    >
      {children}
    </button>
  )
}
