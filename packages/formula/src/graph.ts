/* 公式依賴圖(HyperFormula 式):Tarjan 強連通分量(SCC)循環偵測 + 拓樸求值序。
   節點 = 公式欄(fieldId),邊 = 「公式 A 依賴欄 B」(A→B)。非公式欄(葉,原始記錄值)不入圖。
   Tarjan 之 SCC 輸出序恰為反拓樸(依賴先於被依賴)→ 即求值序。 */

export interface FormulaNode {
  readonly fieldId: number
  readonly dependsOn: readonly number[]
}

export class FormulaCycleError extends Error {
  constructor(readonly cycle: readonly number[]) {
    super(`公式循環依賴:${cycle.join(" → ")}`)
    this.name = "FormulaCycleError"
  }
}

function mustGet(map: ReadonlyMap<number, number>, key: number): number {
  const v = map.get(key)
  if (v === undefined) throw new Error(`圖不變量:缺 ${key}`)
  return v
}

interface TarjanResult {
  /* SCC 反拓樸序(依賴先):扁平化的求值序 */
  readonly order: readonly number[]
  /* 第一個 size>1 的 SCC 或自環(= 循環);無則 null */
  readonly cycle: readonly number[] | null
}

function tarjan(nodes: readonly FormulaNode[]): TarjanResult {
  const nodeIds = new Set(nodes.map((n) => n.fieldId))
  const depsOf = new Map(nodes.map((n) => [n.fieldId, n.dependsOn]))
  const index = new Map<number, number>()
  const low = new Map<number, number>()
  const onStack = new Set<number>()
  const stack: number[] = []
  const order: number[] = []
  let cycle: readonly number[] | null = null
  let counter = 0

  const strongconnect = (v: number): void => {
    index.set(v, counter)
    low.set(v, counter)
    counter += 1
    stack.push(v)
    onStack.add(v)

    for (const w of depsOf.get(v) ?? []) {
      if (w === v && cycle === null) cycle = [v] // 自環
      if (!nodeIds.has(w)) continue // 依賴葉節點(非公式欄)→ 不入圖
      if (!index.has(w)) {
        strongconnect(w)
        low.set(v, Math.min(mustGet(low, v), mustGet(low, w)))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(mustGet(low, v), mustGet(index, w)))
      }
    }

    if (mustGet(low, v) === mustGet(index, v)) {
      const component: number[] = []
      let w = -1
      do {
        const popped = stack.pop()
        if (popped === undefined) throw new Error("圖不變量:堆疊空")
        w = popped
        onStack.delete(w)
        component.push(w)
      } while (w !== v)
      if (component.length > 1 && cycle === null) cycle = component
      for (const id of component) order.push(id)
    }
  }

  for (const n of nodes) {
    if (!index.has(n.fieldId)) strongconnect(n.fieldId)
  }
  return { order, cycle }
}

/* 回傳循環的節點集(或 null);defineFormula 定義期用,不拋 */
export function detectCycle(nodes: readonly FormulaNode[]): readonly number[] | null {
  return tarjan(nodes).cycle
}

/* 求值序(依賴先於被依賴);有循環即拋 FormulaCycleError */
export function evaluationOrder(nodes: readonly FormulaNode[]): number[] {
  const { order, cycle } = tarjan(nodes)
  if (cycle !== null) throw new FormulaCycleError(cycle)
  return [...order]
}
