import { Inject, Injectable } from "@nestjs/common"
import type { Knex } from "knex"
import { DDL_KNEX } from "../../db/db.module.js"
import { FieldNotFoundError, OptionInUseError, OptionRenameConflictError } from "../errors.js"
import { DATA_SCHEMA, physicalColumnName, physicalTableName } from "../identifiers.js"
import { MetadataService } from "../metadata/metadata.service.js"

/* 🔴 選項變更服務(#105,深研見 field-types-parity.md §0-ter C)。

   `alterFieldType` 原本直接覆寫 `options` 而**完全不動資料** —— 這就是缺陷本身:
   把「已核准」改名成「核准通過」後,既有記錄仍留舊字串,落在選項清單之外變孤兒。

   本服務以 choice 的 **stable id** 做 diff(不是比名稱),改名時在同一交易內改寫資料欄。
   Ragic 官方對此完全沒有自動化(KB 教使用者「大量修改」手動改),
   同架構的 NocoDB / Teable 有改寫但**都沒處理並發**;此處以既有 advisory lock 補上。 */

export interface OptionChoice {
  readonly id: string
  readonly name: string
  readonly color?: string | undefined
  readonly retired?: boolean | undefined
  readonly parents?: readonly string[] | undefined
}

export type OptionDeleteMode = "retire" | "replace" | "clear"

const OPTION_STATEMENT_TIMEOUT = "30s"
const OPTION_LOCK_TIMEOUT = "3s"

interface Rename {
  readonly id: string
  readonly from: string
  readonly to: string
}

@Injectable()
export class OptionService {
  constructor(
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  /* 回傳每個選項目前被幾筆記錄使用 —— 刪除對話框的「N 筆記錄正在使用」。
     查證過的系統(Airtable / Baserow / NocoDB / Teable / Notion)**沒有一家提供這個**;
     Salesforce 最接近(強制選 replace 目標)但也不顯示筆數。

     🔴 **回傳以 option id 為 key,不是名稱**(瀏覽器實走時發現)。
     以名稱為 key 時,使用者一改名前端就查不到筆數,
     「N 筆使用中」的保護會**靜默消失** —— 名字會變,id 不會。 */
  async usageCounts(
    tenantId: number,
    formId: number,
    fieldId: number,
  ): Promise<Record<string, number>> {
    const { field, table, column, multi } = await this.resolve(tenantId, formId, fieldId)
    const choices = (field.options.choices as OptionChoice[] | undefined) ?? []
    if (choices.length === 0) return {}

    const rows = await this.inTx(tenantId, async (trx) => {
      const sql = multi
        ? `SELECT v AS name, count(*)::int AS n FROM ${DATA_SCHEMA}.?? t,
             LATERAL unnest(t.??) AS v WHERE t.deleted_at IS NULL GROUP BY v`
        : `SELECT ?? AS name, count(*)::int AS n FROM ${DATA_SCHEMA}.??
             WHERE deleted_at IS NULL AND ?? IS NOT NULL GROUP BY 1`
      const bindings = multi ? [table, column] : [column, table, column]
      const res = (await trx.raw(sql, bindings)) as { rows: { name: string; n: number }[] }
      return res.rows
    })

    const byName = new Map(rows.map((r) => [r.name, r.n]))
    const counts: Record<string, number> = {}
    for (const choice of choices) counts[choice.id] = byName.get(choice.name) ?? 0
    return counts
  }

  /* 套用新的選項清單。以 id diff:改名 → 改寫資料;移除 → 依 deleteMode 處理。 */
  async updateOptions(
    tenantId: number,
    formId: number,
    fieldId: number,
    next: readonly OptionChoice[],
    deleteMode: OptionDeleteMode = "retire",
    replaceWith?: string,
  ): Promise<{ renamed: number; affectedRows: number }> {
    const { field, table, column, multi } = await this.resolve(tenantId, formId, fieldId)
    const prev = (field.options.choices as OptionChoice[] | undefined) ?? []
    const prevById = new Map(prev.map((c) => [c.id, c]))
    const nextIds = new Set(next.map((c) => c.id))

    const renames: Rename[] = []
    for (const choice of next) {
      const before = prevById.get(choice.id)
      if (before !== undefined && before.name !== choice.name) {
        renames.push({ id: choice.id, from: before.name, to: choice.name })
      }
    }
    const removed = prev.filter((c) => !nextIds.has(c.id))

    /* 改名目標撞到「本次未被改名的既有選項」= 合併語意,必須明示而非默默合併。
       撞到同批其他選項的**舊**名則是合法的交換/循環(A↔B),由 CASE 一次改完處理。 */
    const renamedFrom = new Set(renames.map((r) => r.from))
    const stableNames = new Set(
      next.filter((c) => !renamedFrom.has(prevById.get(c.id)?.name ?? "")).map((c) => c.name),
    )
    for (const rename of renames) {
      if (stableNames.has(rename.to)) {
        throw new OptionRenameConflictError(rename.from, rename.to)
      }
    }

    let affectedRows = 0
    const finalChoices = await this.inTx(tenantId, async (trx) => {
      await trx.raw(`SET LOCAL lock_timeout = '${OPTION_LOCK_TIMEOUT}'`)
      await trx.raw(`SET LOCAL statement_timeout = '${OPTION_STATEMENT_TIMEOUT}'`)
      // 與 DDL 同一把鎖:改名期間不得有人加欄/改型別,也不得有人寫入舊值
      await trx.raw("SELECT pg_advisory_xact_lock(?)", [formId])

      if (renames.length > 0) {
        affectedRows += await this.applyRenames(trx, table, column, multi, renames)
      }

      const kept = [...next]
      for (const gone of removed) {
        const used = await this.countUsing(trx, table, column, multi, gone.name)
        if (used === 0) continue
        if (deleteMode === "retire") {
          // 預設:值留著,只是不再可選(Salesforce inactive picklist 語意)
          kept.push({ ...gone, retired: true })
        } else if (deleteMode === "replace") {
          if (replaceWith === undefined) throw new OptionInUseError(gone.name, used)
          affectedRows += await this.applyRenames(trx, table, column, multi, [
            { id: gone.id, from: gone.name, to: replaceWith },
          ])
        } else {
          affectedRows += await this.clearValue(trx, table, column, multi, gone.name)
        }
      }
      return kept
    })

    await this.metadata.updateFieldOptions(tenantId, fieldId, {
      ...field.options,
      choices: finalChoices,
    })
    await this.metadata.bumpVersion(tenantId, formId)
    return { renamed: renames.length, affectedRows }
  }

  /* **單一 CASE 一次改完** —— 這是關鍵。
     逐條依序 UPDATE 會在交換(A→B 且 B→A)時毀資料:先把所有 A 變 B,
     再把所有 B(含剛變過來的)變 A。NocoDB 為此寫了一整套臨時名 hack,
     而其原始碼註解自己指出更好的解:CASE 對每列的舊值只評估一次,天然處理循環。 */
  private async applyRenames(
    trx: Knex.Transaction,
    table: string,
    column: string,
    multi: boolean,
    renames: readonly Rename[],
  ): Promise<number> {
    const froms = renames.map((r) => r.from)
    const whens = renames.map(() => "WHEN ? THEN ?").join(" ")
    const caseBindings = renames.flatMap((r) => [r.from, r.to])

    if (multi) {
      /* 陣列要保序:unnest WITH ORDINALITY 再依 ord 聚合。
         直接 array_agg 不保證順序,選項順序在單據上是可見的。 */
      const res = (await trx.raw(
        `UPDATE ${DATA_SCHEMA}.?? SET ?? = (
           SELECT array_agg(CASE e ${whens} ELSE e END ORDER BY ord)
           FROM unnest(??) WITH ORDINALITY AS u(e, ord))
         WHERE deleted_at IS NULL AND ?? && ?`,
        [table, column, ...caseBindings, column, column, froms],
      )) as { rowCount?: number }
      return res.rowCount ?? 0
    }
    const res = (await trx.raw(
      `UPDATE ${DATA_SCHEMA}.?? SET ?? = CASE ?? ${whens} ELSE ?? END
       WHERE deleted_at IS NULL AND ?? = ANY(?)`,
      [table, column, column, ...caseBindings, column, column, froms],
    )) as { rowCount?: number }
    return res.rowCount ?? 0
  }

  private async clearValue(
    trx: Knex.Transaction,
    table: string,
    column: string,
    multi: boolean,
    name: string,
  ): Promise<number> {
    const res = (await trx.raw(
      multi
        ? `UPDATE ${DATA_SCHEMA}.?? SET ?? = array_remove(??, ?)
             WHERE deleted_at IS NULL AND ?? && ARRAY[?]::text[]`
        : `UPDATE ${DATA_SCHEMA}.?? SET ?? = NULL WHERE deleted_at IS NULL AND ?? = ?`,
      multi ? [table, column, column, name, column, name] : [table, column, column, name],
    )) as { rowCount?: number }
    return res.rowCount ?? 0
  }

  private async countUsing(
    trx: Knex.Transaction,
    table: string,
    column: string,
    multi: boolean,
    name: string,
  ): Promise<number> {
    const res = (await trx.raw(
      multi
        ? `SELECT count(*)::int AS n FROM ${DATA_SCHEMA}.??
             WHERE deleted_at IS NULL AND ?? && ARRAY[?]::text[]`
        : `SELECT count(*)::int AS n FROM ${DATA_SCHEMA}.?? WHERE deleted_at IS NULL AND ?? = ?`,
      [table, column, name],
    )) as { rows: { n: number }[] }
    return res.rows[0]?.n ?? 0
  }

  private async resolve(
    tenantId: number,
    formId: number,
    fieldId: number,
  ): Promise<{
    field: { options: Record<string, unknown>; cellValueType: string }
    table: string
    column: string
    multi: boolean
  }> {
    const loaded = await this.metadata.getForm(tenantId, formId)
    const field = loaded.fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new FieldNotFoundError(fieldId)
    if (field.cellValueType !== "singleSelect" && field.cellValueType !== "multiSelect") {
      throw new FieldNotFoundError(fieldId)
    }
    return {
      field: { options: field.options as Record<string, unknown>, cellValueType: field.cellValueType },
      table: physicalTableName(formId),
      column: physicalColumnName(fieldId),
      multi: field.cellValueType === "multiSelect",
    }
  }

  private async inTx<T>(tenantId: number, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.knex.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.tenant_id', ?, true)", [String(tenantId)])
      return fn(trx)
    })
  }
}
