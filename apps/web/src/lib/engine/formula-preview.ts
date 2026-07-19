import {
  collectFormulaReferences,
  evaluateFormula,
  evaluationOrder,
  type FormulaValue,
  toText,
} from "@weyver/formula"

/* 前端即時公式預覽 —— 與後端 FormulaService.computeRecord 用「同一套 @weyver/formula 引擎」
   (parser / 求值 / 依賴圖),故結果 by construction 一致(OQ-FML-7=A)。後端仍為權威真值;
   本層僅供輸入即算即顯示(docs/14「fx 即時重算」)。跨表 Lookup/Rollup 需伺服器資料 → 後端。 */

export interface FormulaFieldSpec {
  readonly name: string
  readonly expr: string
}

function toFormulaValue(raw: unknown): FormulaValue {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "boolean") return raw
  return String(raw)
}

/* 依拓樸序算出各公式欄的預覽值(鏈式正確);循環時拋 FormulaCycleError(由呼叫端 catch 顯示)。 */
export function computeFormulaPreview(
  formulas: readonly FormulaFieldSpec[],
  values: Record<string, unknown>,
): Record<string, FormulaValue> {
  const indexOf = new Map<string, number>()
  formulas.forEach((f, i) => indexOf.set(f.name, i))

  const nodes = formulas.map((f, i) => ({
    fieldId: i,
    dependsOn: collectFormulaReferences(f.expr)
      .map((name) => indexOf.get(name))
      .filter((x): x is number => x !== undefined),
  }))

  const order = evaluationOrder(nodes)
  const computed = new Map<number, FormulaValue>()
  const resolve = (name: string): FormulaValue => {
    const idx = indexOf.get(name)
    if (idx !== undefined) {
      const memo = computed.get(idx)
      if (memo !== undefined) return memo
    }
    return toFormulaValue(values[name])
  }

  for (const idx of order) {
    const spec = formulas[idx]
    if (spec === undefined) continue
    computed.set(idx, evaluateFormula(spec.expr, resolve))
  }

  const out: Record<string, FormulaValue> = {}
  for (const [idx, value] of computed) {
    const spec = formulas[idx]
    if (spec !== undefined) out[spec.name] = value
  }
  return out
}

/* 便利:單一公式 → 顯示字串 */
export function previewFormulaText(
  formulas: readonly FormulaFieldSpec[],
  values: Record<string, unknown>,
  fieldName: string,
): string {
  return toText(computeFormulaPreview(formulas, values)[fieldName] ?? null)
}
