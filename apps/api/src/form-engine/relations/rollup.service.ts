import { Inject, Injectable } from "@nestjs/common"
import type { FormulaValue } from "@weyver/formula"
import type { RecordRow } from "../records/record-specs.js"
import { RecordService } from "../records/record.service.js"
import { type AggregateFn, aggregate, toFormulaValue } from "./rollup-agg.js"

/* Rollup 聚合(子表 / 一對多)。N+1 防護:一次 listByParents 撈全部子列 → app 層分組聚合(非逐父查)。
   讀時算(無物化)→ 子列刪 / 改即反映,天生無 Salesforce 之「刪子不重算」痛點。
   聚合純函式抽 rollup-agg.ts,與 RecordService 讀時注入共用(避服務循環)。 */

export type { AggregateFn }

export interface RollupCondition {
  readonly field: string
  readonly equals: unknown
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
