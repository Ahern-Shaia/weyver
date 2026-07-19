import { Decimal } from "@weyver/formula"
import { Inject, Injectable, Optional } from "@nestjs/common"
import type { Knex } from "knex"
import { z } from "zod"
import { APP_KNEX } from "../../db/db.module.js"
import { FormulaService } from "../formula/formula.service.js"
import {
  BulkRowError,
  BulkTooLargeError,
  DomainError,
  FieldValueError,
  FormNotReadyError,
  InvalidFilterError,
  RecordNotFoundError,
  RequiredFieldError,
  SystemManagedFieldError,
  UnknownFieldError,
  VersionConflictError,
} from "../errors.js"
import { fieldType, type CellValueType } from "../field-types/field-type-registry.js"
import { DATA_SCHEMA, physicalColumnName, physicalTableName, sequenceName } from "../identifiers.js"
import {
  MetadataService,
  type FieldDefRow,
  type FormWithFields,
} from "../metadata/metadata.service.js"
import type { LineInput, ListQuery, RecordRow, RecordValues } from "./record-specs.js"

interface ResolvedField {
  readonly row: FieldDefRow
  readonly column: string
  readonly type: CellValueType
}

interface ResolvedForm {
  readonly table: string
  readonly byName: ReadonlyMap<string, ResolvedField>
  readonly fields: readonly ResolvedField[]
  readonly isSubtable: boolean
}

const BULK_MAX_ROWS = 5000

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/* A4|記錄 DML(app 車道 APP_KNEX;prod = weyver_app 無 DDL / 無 BYPASSRLS):
   identifier 一律出自 catalog(查無即拒),值一律參數綁定(鐵則 1);
   每個操作跑在 inTenantTx(set_config app.tenant_id, tx 範圍)→ RLS 執法 +
   app 層 WHERE tenant_id 雙防線(鐵則 3);soft delete 預設過濾(OQ-FEC-5)。 */
@Injectable()
export class RecordService {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    // 讀時算公式注入(P0-3 M6);optional 使既有測試 new RecordService(knex, metadata) 不受影響
    @Optional() @Inject(FormulaService) private readonly formula?: FormulaService,
  ) {}

  /* 讀時公式注入:formula 欄之值不儲存,讀取時以其他欄計算後併入(docs OQ-FML-8 之讀時算模式)。
     非公式表零額外查詢(hasFormula 短路);公式表每列一次 computeRecord(N+1 為已知優化點,見 FMEA)。 */
  private async withFormulas(
    tenantId: number,
    formId: number,
    resolved: ResolvedForm,
    records: readonly RecordRow[],
  ): Promise<RecordRow[]> {
    const hasFormula = resolved.fields.some((f) => f.type === "formula")
    if (this.formula === undefined || !hasFormula || records.length === 0) return [...records]
    const out: RecordRow[] = []
    for (const record of records) {
      const computed = await this.formula.computeRecord(tenantId, formId, record.values)
      const values: RecordValues = { ...record.values }
      for (const [name, value] of Object.entries(computed)) {
        values[name] = value instanceof Decimal ? value.toString() : value
      }
      out.push({ ...record, values })
    }
    return out
  }

  /* SET LOCAL 不可參數綁定 → set_config(..., true) 交易範圍等價(M1 spike S3) */
  private async inTenantTx<T>(
    tenantId: number,
    fn: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.knex.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
      return fn(trx)
    })
  }

  async createRecord(
    tenantId: number,
    formId: number,
    values: RecordValues,
    actorId: number,
  ): Promise<RecordRow> {
    const resolved = await this.resolveForm(tenantId, formId)
    return this.inTenantTx(tenantId, (trx) =>
      this.insertOne(trx, tenantId, resolved, values, actorId, null, null),
    )
  }

  /* A1(P0-2)|bulk 建立:單一 tx 逐列 insert;任一列失敗 → 整批 rollback + 回失敗列 index。
     autoNumber 每列取號;繼承 validateValues(型別/必填/systemManaged)+ 參數綁定 + RLS。 */
  async createManyRecords(
    tenantId: number,
    formId: number,
    rows: readonly RecordValues[],
    actorId: number,
  ): Promise<{ created: number }> {
    if (rows.length > BULK_MAX_ROWS) throw new BulkTooLargeError(BULK_MAX_ROWS)
    if (rows.length === 0) return { created: 0 }
    const resolved = await this.resolveForm(tenantId, formId)
    return this.inTenantTx(tenantId, async (trx) => {
      for (const [index, values] of rows.entries()) {
        try {
          await this.insertOne(trx, tenantId, resolved, values, actorId, null, null)
        } catch (error) {
          if (error instanceof DomainError) throw new BulkRowError(index, error.message)
          throw error
        }
      }
      return { created: rows.length }
    })
  }

  async getRecord(tenantId: number, formId: number, recordId: number): Promise<RecordRow> {
    const resolved = await this.resolveForm(tenantId, formId)
    const record = await this.inTenantTx(tenantId, async (trx) => {
      const row = await this.baseQuery(trx, tenantId, resolved)
        .where(`${resolved.table}.id`, recordId)
        .first()
      if (row === undefined) throw new RecordNotFoundError(recordId)
      return this.toRecord(resolved, row as Record<string, unknown>)
    })
    const [injected] = await this.withFormulas(tenantId, formId, resolved, [record])
    return injected ?? record
  }

  /* 子表批次取數(Rollup 之 N+1 防護):一次 whereIn parent_id 撈全部子列,呼叫端在 app 層分組聚合。 */
  async listByParents(
    tenantId: number,
    childFormId: number,
    parentIds: readonly number[],
  ): Promise<RecordRow[]> {
    if (parentIds.length === 0) return []
    const resolved = await this.resolveForm(tenantId, childFormId)
    return this.inTenantTx(tenantId, async (trx) => {
      const rows = (await this.baseQuery(trx, tenantId, resolved)
        .whereIn(`${resolved.table}.parent_id`, [...parentIds])
        .orderBy(`${resolved.table}.parent_id`, "asc")
        .orderBy(`${resolved.table}.line_no`, "asc")) as Record<string, unknown>[]
      return rows.map((row) => this.toRecord(resolved, row))
    })
  }

  async listRecords(
    tenantId: number,
    formId: number,
    query: ListQuery,
  ): Promise<{ records: RecordRow[]; nextCursor: number | null }> {
    const resolved = await this.resolveForm(tenantId, formId)
    const result = await this.inTenantTx(tenantId, async (trx) => {
      let builder = this.baseQuery(trx, tenantId, resolved)

      for (const filter of query.filters) {
        builder = this.applyFilter(builder, resolved, filter)
      }
      for (const sort of query.sort) {
        const field = resolved.byName.get(sort.field)
        if (field === undefined) throw new UnknownFieldError(sort.field)
        // 空值一律沉底(PG DESC 預設 NULLS FIRST,對使用者不直覺)
        builder = builder.orderBy(field.column, sort.dir, "last")
      }
      builder = builder.orderBy(`${resolved.table}.id`, "asc")
      if (query.cursor !== undefined) {
        builder = builder.where(`${resolved.table}.id`, ">", query.cursor)
      }
      const rows = (await builder.limit(query.limit + 1)) as Record<string, unknown>[]

      const hasMore = rows.length > query.limit
      const page = hasMore ? rows.slice(0, query.limit) : rows
      const records = page.map((row) => this.toRecord(resolved, row))
      const last = records[records.length - 1]
      return { records, nextCursor: hasMore && last !== undefined ? last.id : null }
    })
    const records = await this.withFormulas(tenantId, formId, resolved, result.records)
    return { records, nextCursor: result.nextCursor }
  }

  async updateRecord(
    tenantId: number,
    formId: number,
    recordId: number,
    expectedVersion: number,
    values: RecordValues,
    actorId: number,
  ): Promise<RecordRow> {
    const resolved = await this.resolveForm(tenantId, formId)
    await this.inTenantTx(tenantId, async (trx) => {
      await this.updateOne(trx, tenantId, resolved, recordId, expectedVersion, values, actorId)
    })
    return this.getRecord(tenantId, formId, recordId)
  }

  async softDeleteRecord(
    tenantId: number,
    formId: number,
    recordId: number,
    actorId: number,
  ): Promise<void> {
    const resolved = await this.resolveForm(tenantId, formId)
    await this.inTenantTx(tenantId, async (trx) => {
      const count = await trx
        .withSchema(DATA_SCHEMA)
        .table(resolved.table)
        .where({ tenant_id: tenantId, id: recordId })
        .whereNull("deleted_at")
        .update({ deleted_at: trx.fn.now(), updated_by: actorId })
      if (count === 0) throw new RecordNotFoundError(recordId)
    })
  }

  /* A5|header + lines 單一 transaction(ERP 單據骨架):
     全量 diff — 未帶 id 的 line 新增、帶 id 的更新、缺席的 soft-delete;line_no 依序重排。 */
  async saveWithLines(
    tenantId: number,
    parentFormId: number,
    childFormId: number,
    header: {
      id?: number | undefined
      expectedVersion?: number | undefined
      values: RecordValues
    },
    lines: readonly LineInput[],
    actorId: number,
  ): Promise<{ header: RecordRow; lines: RecordRow[] }> {
    const parent = await this.resolveForm(tenantId, parentFormId)
    const child = await this.resolveForm(tenantId, childFormId)

    const headerId = await this.inTenantTx(tenantId, async (trx) => {
      let id: number
      if (header.id === undefined) {
        const created = await this.insertOne(
          trx,
          tenantId,
          parent,
          header.values,
          actorId,
          null,
          null,
        )
        id = created.id
      } else {
        id = header.id
        await this.updateOne(
          trx,
          tenantId,
          parent,
          id,
          header.expectedVersion ?? 1,
          header.values,
          actorId,
        )
      }

      // pg 回傳 bigint 為字串 → 一律 Number 正規化再比對
      const existingRows = (await trx
        .withSchema(DATA_SCHEMA)
        .table(child.table)
        .select("id")
        .where({ tenant_id: tenantId, parent_id: id })
        .whereNull("deleted_at")) as { id: number | string }[]
      const existing = existingRows.map((e) => Number(e.id))
      const keptIds = new Set(lines.filter((l) => l.id !== undefined).map((l) => Number(l.id)))
      const removed = existing.filter((e) => !keptIds.has(e))
      if (removed.length > 0) {
        await trx
          .withSchema(DATA_SCHEMA)
          .table(child.table)
          .whereIn("id", removed)
          .where({ tenant_id: tenantId })
          .update({ deleted_at: trx.fn.now(), updated_by: actorId })
      }

      for (const [index, line] of lines.entries()) {
        const lineNo = index + 1
        if (line.id === undefined) {
          await this.insertOne(trx, tenantId, child, line.values, actorId, id, lineNo)
        } else {
          await this.updateOne(trx, tenantId, child, line.id, null, line.values, actorId, lineNo)
        }
      }
      return id
    })

    const headerRecord = await this.getRecord(tenantId, parentFormId, headerId)
    const lineRecords = await this.listRecords(tenantId, childFormId, {
      filters: [],
      sort: [],
      limit: 200,
    })
    return {
      header: headerRecord,
      lines: lineRecords.records
        .filter((r) => r.parentId === headerId)
        .sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0)),
    }
  }

  // ---- internal ----

  private async resolveForm(tenantId: number, formId: number): Promise<ResolvedForm> {
    const loaded: FormWithFields = await this.metadata.getForm(tenantId, formId)
    if (loaded.form.provisionState !== "ready") {
      throw new FormNotReadyError(formId, loaded.form.provisionState)
    }
    const fields = loaded.fields.map((row) => ({
      row,
      column: physicalColumnName(row.id),
      type: row.cellValueType as CellValueType,
    }))
    return {
      table: physicalTableName(loaded.form.id),
      byName: new Map(fields.map((f) => [f.row.name, f])),
      fields,
      isSubtable: loaded.form.parentFormId !== null,
    }
  }

  private baseQuery(db: Knex, tenantId: number, resolved: ResolvedForm): Knex.QueryBuilder {
    return db
      .withSchema(DATA_SCHEMA)
      .table(resolved.table)
      .select([
        `${resolved.table}.id`,
        `${resolved.table}.version`,
        `${resolved.table}.created_at`,
        `${resolved.table}.created_by`,
        `${resolved.table}.updated_at`,
        `${resolved.table}.updated_by`,
        ...(resolved.isSubtable
          ? [`${resolved.table}.parent_id`, `${resolved.table}.line_no`]
          : []),
        ...resolved.fields.map((f) => `${resolved.table}.${f.column}`),
      ])
      .where(`${resolved.table}.tenant_id`, tenantId)
      .whereNull(`${resolved.table}.deleted_at`)
  }

  private async insertOne(
    trx: Knex.Transaction,
    tenantId: number,
    resolved: ResolvedForm,
    values: RecordValues,
    actorId: number,
    parentId: number | null,
    lineNo: number | null,
  ): Promise<RecordRow> {
    const columns = await this.validateValues(trx, resolved, values, "create")
    const insert: Record<string, unknown> = {
      tenant_id: tenantId,
      created_by: actorId,
      updated_by: actorId,
      ...columns,
    }
    if (parentId !== null) {
      insert.parent_id = parentId
      insert.line_no = lineNo
    }
    const rows = (await trx
      .withSchema(DATA_SCHEMA)
      .table(resolved.table)
      .insert(insert)
      .returning("*")) as Record<string, unknown>[]
    const row = rows[0]
    if (row === undefined) throw new Error("insert returned no row")
    return this.toRecord(resolved, row)
  }

  private async updateOne(
    trx: Knex.Transaction,
    tenantId: number,
    resolved: ResolvedForm,
    recordId: number,
    expectedVersion: number | null,
    values: RecordValues,
    actorId: number,
    lineNo?: number,
  ): Promise<void> {
    const columns = await this.validateValues(trx, resolved, values, "update")
    let builder = trx
      .withSchema(DATA_SCHEMA)
      .table(resolved.table)
      .where({ tenant_id: tenantId, id: recordId })
      .whereNull("deleted_at")
    if (expectedVersion !== null) builder = builder.where("version", expectedVersion)
    const update: Record<string, unknown> = {
      ...columns,
      version: trx.raw("version + 1"),
      updated_at: trx.fn.now(),
      updated_by: actorId,
    }
    if (lineNo !== undefined) update.line_no = lineNo
    const count = await builder.update(update)
    if (count === 0) {
      const exists = await trx
        .withSchema(DATA_SCHEMA)
        .table(resolved.table)
        .where({ tenant_id: tenantId, id: recordId })
        .whereNull("deleted_at")
        .first()
      if (exists === undefined) throw new RecordNotFoundError(recordId)
      throw new VersionConflictError(recordId, expectedVersion ?? -1)
    }
  }

  /* 值驗證:name whitelist → systemManaged 拒寫 → required(create)→ 型別 Zod → DB 值轉換 */
  private async validateValues(
    trx: Knex.Transaction,
    resolved: ResolvedForm,
    values: RecordValues,
    mode: "create" | "update",
  ): Promise<Record<string, unknown>> {
    const columns: Record<string, unknown> = {}
    for (const [name, raw] of Object.entries(values)) {
      const field = resolved.byName.get(name)
      if (field === undefined) throw new UnknownFieldError(name)
      const definition = fieldType(field.type)
      if (definition.systemManaged) throw new SystemManagedFieldError(name)
      if (raw === null) {
        if (field.row.required) throw new RequiredFieldError(name)
        columns[field.column] = null
        continue
      }
      const parsed = definition
        .valueSchema(field.row.options as Record<string, unknown>)
        .safeParse(raw)
      if (!parsed.success) {
        throw new FieldValueError(name, z.prettifyError(parsed.error))
      }
      columns[field.column] = this.toDbValue(field.type, parsed.data)
    }

    if (mode === "create") {
      for (const field of resolved.fields) {
        const definition = fieldType(field.type)
        if (
          field.row.required &&
          !definition.systemManaged &&
          columns[field.column] === undefined
        ) {
          throw new RequiredFieldError(field.row.name)
        }
        if (field.type === "autoNumber") {
          columns[field.column] = await this.nextAutoNumber(trx, field)
        }
      }
    }
    return columns
  }

  private async nextAutoNumber(trx: Knex.Transaction, field: ResolvedField): Promise<string> {
    const options = field.row.options as { prefix?: string; width?: number }
    const seq = sequenceName(field.row.id)
    const result = (await trx.raw("SELECT nextval(?) AS n", [`${DATA_SCHEMA}.${seq}`])) as {
      rows: { n: string }[]
    }
    const n = result.rows[0]?.n ?? "0"
    return `${options.prefix ?? ""}${n.padStart(options.width ?? 4, "0")}`
  }

  private toDbValue(type: CellValueType, value: unknown): unknown {
    if (type === "attachment") return JSON.stringify(value)
    return value
  }

  private applyFilter(
    builder: Knex.QueryBuilder,
    resolved: ResolvedForm,
    filter: { field: string; op: string; value?: unknown },
  ): Knex.QueryBuilder {
    const field = resolved.byName.get(filter.field)
    if (field === undefined) throw new UnknownFieldError(filter.field)
    const definition = fieldType(field.type)
    if (!definition.filterOperators.includes(filter.op as never)) {
      throw new InvalidFilterError(`operator ${filter.op} not allowed for type ${field.type}`)
    }
    const column = field.column

    switch (filter.op) {
      case "isEmpty":
        return builder.whereNull(column)
      case "isNotEmpty":
        return builder.whereNotNull(column)
      case "contains": {
        if (typeof filter.value !== "string") {
          throw new InvalidFilterError("contains requires a string value")
        }
        return builder.whereILike(column, `%${escapeLike(filter.value)}%`)
      }
      case "anyOf": {
        if (!Array.isArray(filter.value) || filter.value.length === 0) {
          throw new InvalidFilterError("anyOf requires a non-empty array value")
        }
        if (field.type === "multiSelect") {
          // text[] overlap;值經參數綁定
          return builder.whereRaw("?? && ?::text[]", [column, filter.value])
        }
        return builder.whereIn(column, filter.value as string[])
      }
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const parsed = definition
          .valueSchema(field.row.options as Record<string, unknown>)
          .safeParse(filter.value)
        if (!parsed.success) {
          throw new InvalidFilterError(`value does not match field type ${field.type}`)
        }
        const op = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.op]
        return builder.where(column, op, parsed.data as string)
      }
      default:
        throw new InvalidFilterError(`unsupported operator ${filter.op}`)
    }
  }

  private toRecord(resolved: ResolvedForm, row: Record<string, unknown>): RecordRow {
    const values: RecordValues = {}
    for (const field of resolved.fields) {
      values[field.row.name] = row[field.column] ?? null
    }
    return {
      id: Number(row.id),
      version: Number(row.version),
      createdAt: row.created_at as Date,
      createdBy: Number(row.created_by),
      updatedAt: row.updated_at as Date,
      updatedBy: Number(row.updated_by),
      parentId:
        row.parent_id === undefined || row.parent_id === null ? null : Number(row.parent_id),
      lineNo: row.line_no === undefined || row.line_no === null ? null : Number(row.line_no),
      values,
    }
  }
}
