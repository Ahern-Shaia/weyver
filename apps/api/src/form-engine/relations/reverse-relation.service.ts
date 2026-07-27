import { Inject, Injectable } from "@nestjs/common"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { TenantDb } from "../../db/db.module.js"
import { fieldDefs, formDefs } from "../../db/schema.js"
import { RecordService } from "../records/record.service.js"

/* R1·workbench-uplift A3(OQ-RWB-4=B)|反向關聯:「本筆被哪些記錄引用」。
   正向(本筆 link 指向誰)由既有 RelationService/lookup 提供;反向需找出「哪些表的 link 欄指向本表」。

   **來源取 `field_def.options->>targetFormId` 而非 `relation_def`**:後者只在呼叫
   `registerRelation` 時才寫入(Link&Load 的註冊時機),建了 link 欄卻沒 load 過的表不會有列 →
   以它為準會漏。`field_def` 是 link 欄的權威定義,必然存在。

   權限(docs/22 BOLA):來源表單須通過 `view`,否則整組不回(**不洩漏存在**);
   欄位級 hidden 由 RecordService 之 policy 遮罩兜底。查詢一律 tenant-scoped + RLS。 */

const MAX_SOURCES = 20
const MAX_ROWS_PER_SOURCE = 20

export interface ReverseRelationGroup {
  readonly formId: number
  readonly formName: string
  readonly viaFieldName: string
  readonly records: readonly { readonly id: number; readonly title: string }[]
  readonly truncated: boolean
}

@Injectable()
export class ReverseRelationService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(RecordService) private readonly records: RecordService,
  ) {}

  async listReferencing(
    tenantId: number,
    targetFormId: number,
    targetRecordId: number,
    permissions: EffectivePermissions,
  ): Promise<ReverseRelationGroup[]> {
    const sources = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({
          formId: fieldDefs.formId,
          formName: formDefs.name,
          fieldName: fieldDefs.name,
        })
        .from(fieldDefs)
        .innerJoin(formDefs, eq(formDefs.id, fieldDefs.formId))
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.cellValueType, "link"),
            sql`${fieldDefs.options} ->> 'targetFormId' = ${String(targetFormId)}`,
            isNull(fieldDefs.deletedAt),
            isNull(formDefs.deletedAt),
          ),
        )
        .limit(MAX_SOURCES),
    )

    const groups: ReverseRelationGroup[] = []
    for (const source of sources) {
      // 無權檢視來源表 → 整組不回(不洩漏「有東西引用了你」這件事本身)
      if (!permissions.hasAction(source.formId, "view")) continue
      const found = await this.records.listRecords(
        tenantId,
        source.formId,
        {
          filters: [{ field: source.fieldName, op: "eq", value: targetRecordId }],
          sort: [],
          limit: MAX_ROWS_PER_SOURCE + 1,
        },
        permissions,
      )
      if (found.records.length === 0) continue
      const shown = found.records.slice(0, MAX_ROWS_PER_SOURCE)
      groups.push({
        formId: source.formId,
        formName: source.formName,
        viaFieldName: source.fieldName,
        records: shown.map((r) => ({ id: r.id, title: titleOf(r.values, r.id) })),
        truncated: found.records.length > MAX_ROWS_PER_SOURCE,
      })
    }
    return groups
  }
}

/* 摘要標題:取第一個非空字串值(與前端清單同慣例);皆空則回 #id。
   只回標題不回整筆 —— 反向 rail 是導航用,點進去才走完整權限路徑。 */
function titleOf(values: Record<string, unknown>, id: number): string {
  for (const value of Object.values(values)) {
    if (typeof value === "string" && value.trim() !== "") return value.slice(0, 80)
  }
  return `#${id}`
}
