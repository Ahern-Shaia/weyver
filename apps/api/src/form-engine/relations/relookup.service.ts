import { Inject, Injectable } from "@nestjs/common"
import type { Knex } from "knex"
import { APP_KNEX } from "../../db/db.module.js"
import { DATA_SCHEMA, physicalColumnName, physicalTableName } from "../identifiers.js"
import { isSnapshotLookup } from "../field-types/field-type-registry.js"
import { MetadataService } from "../metadata/metadata.service.js"
import { FieldNotFoundError, UnknownFieldError } from "../errors.js"

/* 🔴 #113 快照帶入的「重整」。
   Ragic 的對應功能是設計模式齒輪「執行一次」—— **無差別覆蓋、無 diff、無逐筆記錄**,
   其官方 KB 甚至另闢專篇教使用者「被覆蓋後怎麼從備份救回來」。
   本服務刻意反過來:先算 diff 給人看、確認後才寫、每筆改動留稽核。 */

export interface RelookupChange {
  readonly recordId: number
  readonly before: string | null
  readonly after: string | null
}

export interface RelookupResult {
  readonly total: number
  readonly changed: number
  /* 前 N 筆差異樣本 —— 「會改 3,394 筆」這個數字要能被查證,否則使用者只能盲按 */
  readonly samples: readonly RelookupChange[]
  readonly applied: boolean
}

const SAMPLE_LIMIT = 20

@Injectable()
export class RelookupService {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  /* dryRun=true 只算差異不寫入。回傳的 samples 為前 20 筆,changed 為完整計數。 */
  async relookup(
    tenantId: number,
    formId: number,
    fieldId: number,
    actorId: number,
    dryRun: boolean,
  ): Promise<RelookupResult> {
    const loaded = await this.metadata.getForm(tenantId, formId)
    const field = loaded.fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new FieldNotFoundError(fieldId)
    if (field.cellValueType !== "lookup" || !isSnapshotLookup(field.options)) {
      throw new UnknownFieldError(field.name)
    }
    const opts = field.options as { linkFieldName?: string; targetFieldName?: string }
    const linkField = loaded.fields.find((f) => f.name === opts.linkFieldName)
    if (linkField === undefined || opts.targetFieldName === undefined) {
      throw new UnknownFieldError(opts.linkFieldName ?? field.name)
    }
    const targetFormId = (linkField.options as { targetFormId?: number }).targetFormId
    if (targetFormId === undefined) throw new UnknownFieldError(linkField.name)

    const targetForm = await this.metadata.getForm(tenantId, targetFormId)
    const targetField = targetForm.fields.find((f) => f.name === opts.targetFieldName)
    if (targetField === undefined) throw new UnknownFieldError(opts.targetFieldName)

    const table = physicalTableName(formId)
    const targetTable = physicalTableName(targetFormId)
    const valueColumn = physicalColumnName(field.id)
    const linkColumn = physicalColumnName(linkField.id)
    const targetColumn = physicalColumnName(targetField.id)

    return this.inTenantTx(tenantId, async (trx) => {
      /* 差異在 DB 端一次算完 —— 逐筆比對會在幾萬列的表上變成幾萬次 round trip。
         identifier 全部來自 metadata catalog(physical_column 為 generated column),非使用者輸入。 */
      const result = await trx.raw(
        `SELECT r.id AS record_id, r."${valueColumn}"::text AS before, t."${targetColumn}"::text AS after
           FROM "${DATA_SCHEMA}"."${table}" r
           LEFT JOIN "${DATA_SCHEMA}"."${targetTable}" t ON t.id = r."${linkColumn}"
          WHERE r.deleted_at IS NULL`,
      )
      const rows = result.rows as {
        record_id: string | number
        before: string | null
        after: string | null
      }[]

      const changes: RelookupChange[] = []
      for (const row of rows) {
        const before = row.before
        const after = row.after
        if (before === after) continue
        changes.push({ recordId: Number(row.record_id), before, after })
      }

      if (!dryRun && changes.length > 0) {
        for (const c of changes) {
          await trx
            .withSchema(DATA_SCHEMA)
            .table(table)
            .where({ id: c.recordId })
            .update({ [valueColumn]: c.after })
        }
        /* 逐筆稽核:Ragic 這一步什麼都不留,出事只能翻備份。 */
        await trx.batchInsert(
          "action_audit",
          changes.map((c) => ({
            tenant_id: tenantId,
            button_id: null,
            form_id: formId,
            record_id: c.recordId,
            actor_id: actorId,
            idempotency_key: `relookup:${fieldId}:${c.recordId}:${String(Date.now())}`,
            outcome: "relookup",
            detail: JSON.stringify({ field: field.name, before: c.before, after: c.after }),
          })),
          500,
        )
      }

      return {
        total: rows.length,
        changed: changes.length,
        samples: changes.slice(0, SAMPLE_LIMIT),
        applied: !dryRun && changes.length > 0,
      }
    })
  }

  private async inTenantTx<T>(tenantId: number, fn: (trx: Knex.Transaction) => Promise<T>) {
    return this.knex.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
      // 重整是設計者對整欄的維護動作,不套個人記錄範圍(否則只改得到自己的,留下半新半舊)
      await trx.raw(`SELECT set_config('app.record_scope', 'all', true)`)
      await trx.raw(`SELECT set_config('app.actor_id', '', true)`)
      return fn(trx)
    })
  }
}
