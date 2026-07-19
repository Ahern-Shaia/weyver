import { describe, expect, it } from "vitest"
import { detectCycle, evaluationOrder, FormulaCycleError, type FormulaNode } from "./graph"

/* 欄位 id 以數字代:1=單價 2=數量 3=小計 4=含稅 5=標籤;葉節點(非公式欄)不入 nodes */

describe("依賴圖 — 拓樸求值序", () => {
  it("鏈式:含稅(4)依賴 小計(3)依賴 單價(1)/數量(2)→ 依賴先", () => {
    const nodes: FormulaNode[] = [
      { fieldId: 3, dependsOn: [1, 2] }, // 小計 = 單價 × 數量(1,2 為葉)
      { fieldId: 4, dependsOn: [3] }, // 含稅 = 小計 × 1.05
    ]
    const order = evaluationOrder(nodes)
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(4)) // 小計 先於 含稅
  })

  it("多層鏈(grandchild):5→4→3", () => {
    const nodes: FormulaNode[] = [
      { fieldId: 3, dependsOn: [1] },
      { fieldId: 4, dependsOn: [3] },
      { fieldId: 5, dependsOn: [4] },
    ]
    const order = evaluationOrder(nodes)
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(4))
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(5))
  })

  it("只依賴葉節點 → 無序限制(可即算)", () => {
    const nodes: FormulaNode[] = [{ fieldId: 3, dependsOn: [1, 2] }]
    expect(evaluationOrder(nodes)).toEqual([3])
  })
})

describe("依賴圖 — 循環偵測(Tarjan SCC)", () => {
  it("直接互相依賴 A↔B → 循環", () => {
    const nodes: FormulaNode[] = [
      { fieldId: 3, dependsOn: [4] },
      { fieldId: 4, dependsOn: [3] },
    ]
    expect(detectCycle(nodes)).not.toBeNull()
    expect(() => evaluationOrder(nodes)).toThrow(FormulaCycleError)
  })

  it("三節點環 3→4→5→3", () => {
    const nodes: FormulaNode[] = [
      { fieldId: 3, dependsOn: [4] },
      { fieldId: 4, dependsOn: [5] },
      { fieldId: 5, dependsOn: [3] },
    ]
    const cycle = detectCycle(nodes)
    expect(cycle).not.toBeNull()
    expect(new Set(cycle)).toEqual(new Set([3, 4, 5]))
  })

  it("自環 A→A → 循環", () => {
    expect(detectCycle([{ fieldId: 3, dependsOn: [3] }])).not.toBeNull()
  })

  it("無環 DAG → detectCycle null", () => {
    const nodes: FormulaNode[] = [
      { fieldId: 3, dependsOn: [1] },
      { fieldId: 4, dependsOn: [3] },
    ]
    expect(detectCycle(nodes)).toBeNull()
  })
})
