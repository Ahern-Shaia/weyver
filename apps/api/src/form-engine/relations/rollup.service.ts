import { callFunction, Decimal, type FormulaValue, tryDecimal } from "@weyver/formula"
import { Inject, Injectable } from "@nestjs/common"
import { RecordService } from "../records/record.service.js"
import type { RecordRow } from "../records/record-specs.js"

/* Rollup 聚合(子表 / 一對多)。N+1 防護:一次 listByParents 撈全部子列 → app 層分組聚合(非逐父查)。
   讀時算(無物化)→ 子列刪 / 改即反映,天生無 Salesforce 之「刪子不重算」痛點。
   多層鏈式(grandchild)由依賴圖(M2)於整合重算時串接;此 service 為單層聚合原語。 */

export type AggregateFn = "SUM" | "COUNT" | "AVERAGE" | "MIN" | "MAX"

export interface RollupCondition {
  readonly field: string
  readonly equals: unknown
}

function toFormulaValue(raw: unknown): FormulaValue {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "boolean") return raw
  return String(raw)
}

function aggregate(fn: AggregateFn, values: readonly FormulaValue[]): FormulaValue {
  if (fn === "COUNT") return new Decimal(values.length)
  if (fn === "SUM") return callFunction("SUM", values) // SUM([]) = 0
  const hasNumeric = values.some((v) => tryDecimal(v) !== null)
  if (!hasNumeric) return null // AVERAGE / MIN / MAX 於空集 → null(不拋)
  return callFunction(fn === "AVERAGE" ? "AVERAGE" : fn, values)
}

@Injectable()
export class RollupService {
  constructor(@Inject(RecordService) private readonly records: RecordService) {}

  /* 批次 Rollup(N+1 安全):對多個父記錄一次算出各自的子表聚合值 */
  async rollupBatch(
    tenantId: number,
    childFormId: number,
    parentIds: readonly number[],
    childFieldName: string,
    fn: AggregateFn,
    condition?: RollupCondition,
  ): Promise<Map<number, FormulaValue>> {
    const children = await this.records.listByParents(tenantId, childFormId, parentIds)

    const byParent = new Map<number, RecordRow[]>()
    for (const child of children) {
      if (child.parentId === null) continue
      const list = byParent.get(child.parentId) ?? []
      list.push(child)
      byParent.set(child.parentId, list)
    }

    const result = new Map<number, FormulaValue>()
    for (const parentId of parentIds) {
      const rows = (byParent.get(parentId) ?? []).filter((r) =>
        condition === undefined ? true : r.values[condition.field] === condition.equals,
      )
      result.set(
        parentId,
        aggregate(
          fn,
          rows.map((r) => toFormulaValue(r.values[childFieldName])),
        ),
      )
    }
    return result
  }

  /* 單一父記錄 Rollup(內部走 batch,語意一致)*/
  async rollup(
    tenantId: number,
    childFormId: number,
    parentId: number,
    childFieldName: string,
    fn: AggregateFn,
    condition?: RollupCondition,
  ): Promise<FormulaValue> {
    const m = await this.rollupBatch(
      tenantId,
      childFormId,
      [parentId],
      childFieldName,
      fn,
      condition,
    )
    return m.get(parentId) ?? null
  }
}
