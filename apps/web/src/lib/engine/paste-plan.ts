import { choicesOf } from "@/components/form/value"
import type { CellValueType, FieldDto, RecordRow } from "./schemas"

/* 🔴 R1·GP M3|貼上先驗(docs/modules/R1/grid-paste.md OQ-GP-4 / OQ-GP-5)。

   **為什麼不重用 `toSubmitValue`**|它把「空」與「不合法」都回 `undefined`(= 不送),
   而貼上必須分得出這兩件事:空格是**明確清空**,不合法要**標紅且整批不送**。
   混在一起就會變成 Baserow 的行為 ——「文字貼進數值欄」官方逐字說
   「those cells remain empty rather than showing error messages」,靜默變空。 */

const COMPUTED_TYPES: readonly CellValueType[] = [
  "autoNumber",
  "formula",
  "lookup",
  "rollup",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
]

/* 需要上傳 / 挑選來源記錄,一段純文字表達不了 —— 與「計算欄」分開報,因為成因不同 */
const UNPASTEABLE_TYPES: readonly CellValueType[] = ["attachment", "image", "signature", "link"]

const TRUE_TOKENS = new Set(["true", "1", "yes", "y", "是", "v", "✓", "checked"])
const FALSE_TOKENS = new Set(["false", "0", "no", "n", "否", "", "unchecked"])

export type CellPlan =
  | { readonly kind: "set"; readonly value: unknown }
  | { readonly kind: "skip"; readonly reason: "computed" | "unpasteable" }
  | { readonly kind: "invalid"; readonly message: string }

export function planPasteCell(
  field: FieldDto,
  text: string,
  memberIds?: ReadonlyMap<string, number>,
): CellPlan {
  if (COMPUTED_TYPES.includes(field.type)) return { kind: "skip", reason: "computed" }
  if (UNPASTEABLE_TYPES.includes(field.type)) return { kind: "skip", reason: "unpasteable" }

  const raw = text.trim()
  /* 空格 = 明確清空。Excel 的區塊複製本來就會帶空格,把它當「不動」會讓
     使用者貼完發現舊值還在,而畫面上那一格明明是空的 */
  if (raw === "") return { kind: "set", value: field.type === "checkbox" ? false : null }

  switch (field.type) {
    case "checkbox": {
      const t = raw.toLowerCase()
      if (TRUE_TOKENS.has(t)) return { kind: "set", value: true }
      if (FALSE_TOKENS.has(t)) return { kind: "set", value: false }
      return { kind: "invalid", message: `「${raw}」不是勾選值` }
    }
    case "number":
    case "percent":
    case "rating": {
      const n = Number(raw.replace(/,/g, "").replace(/%$/, ""))
      if (!Number.isFinite(n)) return { kind: "invalid", message: `「${raw}」不是數值` }
      return { kind: "set", value: n }
    }
    case "money": {
      /* 金額全程走十進位字串,絕不轉 float(AGENTS 鐵則 2) */
      const cleaned = raw.replace(/[,\s$NT￥€£]/gi, "")
      if (!/^-?\d+(\.\d+)?$/.test(cleaned))
        return { kind: "invalid", message: `「${raw}」不是金額` }
      return { kind: "set", value: cleaned }
    }
    case "date":
    case "dateTime": {
      const d = new Date(raw)
      if (Number.isNaN(d.getTime())) return { kind: "invalid", message: `「${raw}」不是日期` }
      /* date 取**本地**年月日再組字串 —— 走 toISOString 會因時區把 8/3 變成 8/2,
         這個位移在 P0-1 的 pg DATE parser 上已經踩過一次 */
      if (field.type === "date") {
        const p = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
        return { kind: "set", value: `${String(p[0])}-${pad(p[1])}-${pad(p[2])}` }
      }
      return { kind: "set", value: d.toISOString() }
    }
    case "singleSelect": {
      const choices = choicesOf(field)
      if (!choices.includes(raw)) {
        return { kind: "invalid", message: `「${raw}」不在「${field.name}」的選項中` }
      }
      return { kind: "set", value: raw }
    }
    case "multiSelect": {
      const choices = choicesOf(field)
      const parts = raw
        .split(/[,、;;]/)
        .map((p) => p.trim())
        .filter((p) => p !== "")
      const bad = parts.find((p) => !choices.includes(p))
      if (bad !== undefined) {
        return { kind: "invalid", message: `「${bad}」不在「${field.name}」的選項中` }
      }
      return { kind: "set", value: parts }
    }
    case "member": {
      const id = memberIds?.get(raw)
      if (id === undefined) return { kind: "invalid", message: `找不到成員「${raw}」` }
      return { kind: "set", value: id }
    }
    default:
      return { kind: "set", value: raw }
  }
}

function pad(n: number | undefined): string {
  return String(n ?? 0).padStart(2, "0")
}

export interface PastePlan {
  readonly updates: readonly {
    readonly recordId: number
    readonly values: Record<string, unknown>
  }[]
  /* 貼超出最後一列的部分 —— 是否真的新增由使用者確認(OQ-GP-3) */
  readonly newRows: readonly Record<string, unknown>[]
  readonly invalid: readonly {
    readonly row: number
    readonly col: number
    readonly message: string
  }[]
  readonly skippedComputed: number
  readonly skippedUnpasteable: number
  /* 貼超出最後一欄的格數。**必須回報** —— 靜默丟掉正是 §0.3(c) 的反面教材 */
  readonly droppedCols: number
}

export function buildPastePlan(input: {
  readonly rows: readonly (readonly string[])[]
  readonly targetCol: number
  readonly targetRow: number
  readonly fields: readonly FieldDto[]
  readonly records: readonly RecordRow[]
  readonly memberIds?: ReadonlyMap<string, number>
}): PastePlan {
  const { rows, targetCol, targetRow, fields, records, memberIds } = input
  const updates: { recordId: number; values: Record<string, unknown> }[] = []
  const newRows: Record<string, unknown>[] = []
  const invalid: { row: number; col: number; message: string }[] = []
  let skippedComputed = 0
  let skippedUnpasteable = 0
  let droppedCols = 0

  rows.forEach((cells, r) => {
    const values: Record<string, unknown> = {}
    cells.forEach((text, c) => {
      const field = fields[targetCol + c]
      if (field === undefined) {
        droppedCols++
        return
      }
      const plan = planPasteCell(field, text, memberIds)
      if (plan.kind === "set") values[field.name] = plan.value
      else if (plan.kind === "skip") {
        if (plan.reason === "computed") skippedComputed++
        else skippedUnpasteable++
      } else invalid.push({ row: targetRow + r, col: targetCol + c, message: plan.message })
    })

    const record = records[targetRow + r]
    if (record === undefined) newRows.push(values)
    else updates.push({ recordId: record.id, values })
  })

  return { updates, newRows, invalid, skippedComputed, skippedUnpasteable, droppedCols }
}

export function describePasteEffects(plan: PastePlan): string[] {
  const notes: string[] = []
  if (plan.skippedComputed > 0) notes.push(`${String(plan.skippedComputed)} 格因為是計算欄未寫入`)
  if (plan.skippedUnpasteable > 0)
    notes.push(`${String(plan.skippedUnpasteable)} 格因為欄位型別無法以文字貼上而未寫入`)
  if (plan.droppedCols > 0) notes.push(`${String(plan.droppedCols)} 格超出最右欄未寫入`)
  return notes
}
