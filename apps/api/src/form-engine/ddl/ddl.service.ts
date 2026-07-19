import { Inject, Injectable } from "@nestjs/common"
import type { Knex } from "knex"
import { DDL_KNEX, DRIZZLE, type DrizzleDb } from "../../db/db.module.js"
import { ddlAudits } from "../../db/schema.js"
import { FormNotPendingError, FormNotReadyError, InvalidTypeConversionError } from "../errors.js"
import { fieldType, type CellValueType } from "../field-types/field-type-registry.js"
import { isSafeConversion } from "../field-types/type-conversions.js"
import { DATA_SCHEMA, physicalColumnName, physicalTableName } from "../identifiers.js"
import {
  MetadataService,
  type FieldDefRow,
  type FormWithFields,
} from "../metadata/metadata.service.js"
import type { AddFieldSpec, CreateFormSpec } from "../specs/form-specs.js"

const DDL_STATEMENT_TIMEOUT = "10s"

/* A3|動態 DDL 服務(安全鏈,docs/22 威脅 #1):
   結構化 spec → identifier 全系統生成 → knex builder quote → advisory lock +
   statement_timeout → 三段式 provision(metadata pending → 物理 DDL → ready,
   失敗清理)→ 全程 ddl_audit。加欄一律 nullable 無 default(spike S2 禁 rewrite)。 */
@Injectable()
export class DdlService {
  constructor(
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  async createForm(tenantId: number, spec: CreateFormSpec): Promise<FormWithFields> {
    const draft = await this.metadata.createFormDraft(tenantId, spec)
    await this.provisionForm(tenantId, draft)
    return this.metadata.getForm(tenantId, draft.form.id)
  }

  async addField(tenantId: number, formId: number, spec: AddFieldSpec): Promise<FieldDefRow> {
    const { form, fields } = await this.readyForm(tenantId, formId)
    const position = fields.reduce((max, f) => Math.max(max, f.position), -1) + 1
    const row = await this.metadata.insertField(tenantId, formId, spec, position)
    const table = physicalTableName(form.id)
    const column = physicalColumnName(row.id)
    let executedSql = ""
    try {
      await this.knex.transaction(async (trx) => {
        await this.acquireDdlLock(trx, form.id)
        const statements = trx.schema
          .withSchema(DATA_SCHEMA)
          .alterTable(table, (t) => {
            fieldType(spec.type).buildColumn(t, column, row.options as Record<string, unknown>)
          })
          .toSQL()
        executedSql = await this.runStatements(trx, statements)
      })
      await this.metadata.bumpVersion(tenantId, formId)
      await this.audit(tenantId, formId, "addField", spec, executedSql, "ok")
      return row
    } catch (error) {
      await this.metadata.hardDeleteField(tenantId, row.id)
      await this.audit(tenantId, formId, "addField", spec, executedSql, "failed", error)
      throw error
    }
  }

  /* OQ-FEC-4 = A:白名單內 = 物理 no-op,純 metadata 變更;白名單外一律拒 */
  async alterFieldType(
    tenantId: number,
    formId: number,
    fieldId: number,
    newType: CellValueType,
    newOptions: Record<string, unknown> = {},
  ): Promise<void> {
    const { fields } = await this.readyForm(tenantId, formId)
    const field = fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new InvalidTypeConversionError("<missing>", newType)
    const from = field.cellValueType as CellValueType
    if (!isSafeConversion(from, newType)) throw new InvalidTypeConversionError(from, newType)

    const target = fieldType(newType)
    const options = target.optionsSchema.parse(newOptions) as Record<string, unknown>
    await this.metadata.updateFieldType(tenantId, fieldId, newType, target.dbFieldType, options)
    await this.metadata.bumpVersion(tenantId, formId)
    await this.audit(tenantId, formId, "alterFieldType", { fieldId, from, to: newType }, "", "ok")
  }

  /* 欄位下架 = metadata soft-delete;物理欄保留(資料不毀,清理 job 之後收)*/
  async dropField(tenantId: number, formId: number, fieldId: number): Promise<void> {
    await this.readyForm(tenantId, formId)
    await this.metadata.softDeleteField(tenantId, fieldId)
    await this.metadata.bumpVersion(tenantId, formId)
    await this.audit(tenantId, formId, "dropField", { fieldId }, "", "ok")
  }

  /* 表單下架 = metadata soft-delete;物理表保留(回復可能,清理 job 之後收)*/
  async dropForm(tenantId: number, formId: number): Promise<void> {
    await this.metadata.softDeleteForm(tenantId, formId)
    await this.audit(tenantId, formId, "dropForm", {}, "", "ok")
  }

  private async provisionForm(tenantId: number, draft: FormWithFields): Promise<void> {
    const { form, fields } = draft
    if (form.provisionState !== "pending") {
      throw new FormNotPendingError(form.id, form.provisionState)
    }
    const table = physicalTableName(form.id)
    const parentTable =
      form.parentFormId === null ? null : await this.readyParentTable(tenantId, form.parentFormId)

    let executedSql = ""
    try {
      await this.knex.transaction(async (trx) => {
        await this.acquireDdlLock(trx, form.id)
        const create = trx.schema
          .withSchema(DATA_SCHEMA)
          .createTable(table, (t) => {
            t.specificType("id", "bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY")
            t.bigint("tenant_id").notNullable()
            if (parentTable !== null) {
              t.bigint("parent_id").notNullable()
              t.integer("line_no").notNullable()
            }
            for (const field of fields) {
              fieldType(field.cellValueType as CellValueType).buildColumn(
                t,
                physicalColumnName(field.id),
                field.options as Record<string, unknown>,
              )
            }
            t.integer("version").notNullable().defaultTo(1)
            t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(trx.fn.now())
            t.bigint("created_by").notNullable()
            t.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(trx.fn.now())
            t.bigint("updated_by").notNullable()
            t.timestamp("deleted_at", { useTz: true })
            t.index(["tenant_id"])
            if (parentTable !== null) t.index(["parent_id"])
          })
          .toSQL()
        executedSql = await this.runStatements(trx, create)
        executedSql += await this.runRaw(trx, this.rlsStatements(table))
        if (parentTable !== null) {
          executedSql += await this.runRaw(trx, [
            `ALTER TABLE "${DATA_SCHEMA}"."${table}" ADD CONSTRAINT "${table}_parent_fk" ` +
              `FOREIGN KEY (parent_id) REFERENCES "${DATA_SCHEMA}"."${parentTable}"(id)`,
          ])
        }
      })
      await this.metadata.markProvisioned(tenantId, form.id, "ready")
      await this.audit(tenantId, form.id, "createForm", { name: form.name }, executedSql, "ok")
    } catch (error) {
      // CREATE 在 tx 內失敗即回滾;DROP IF EXISTS 為冪等清理雙保險
      await this.knex.schema.withSchema(DATA_SCHEMA).dropTableIfExists(table)
      await this.metadata.markProvisioned(tenantId, form.id, "failed")
      await this.audit(
        tenantId,
        form.id,
        "createForm",
        { name: form.name },
        executedSql,
        "failed",
        error,
      )
      throw error
    }
  }

  private rlsStatements(table: string): string[] {
    const qualified = `"${DATA_SCHEMA}"."${table}"`
    // NULLIF:custom GUC session 內 reset 值為 '' 非 NULL(spike S3);空 context → deny(fail-closed)
    const predicate = "tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint"
    return [
      `ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON ${qualified} USING (${predicate}) WITH CHECK (${predicate})`,
    ]
  }

  private async acquireDdlLock(trx: Knex.Transaction, formId: number): Promise<void> {
    await trx.raw(`SET LOCAL statement_timeout = '${DDL_STATEMENT_TIMEOUT}'`)
    await trx.raw("SELECT pg_advisory_xact_lock(?)", [formId])
  }

  private async runStatements(
    trx: Knex.Transaction,
    statements: readonly { sql: string; bindings: readonly unknown[] }[],
  ): Promise<string> {
    let executed = ""
    for (const statement of statements) {
      await trx.raw(statement.sql, statement.bindings as Knex.RawBinding[])
      executed += `${statement.sql};\n`
    }
    return executed
  }

  private async runRaw(trx: Knex.Transaction, statements: readonly string[]): Promise<string> {
    let executed = ""
    for (const statement of statements) {
      await trx.raw(statement)
      executed += `${statement};\n`
    }
    return executed
  }

  private async readyForm(tenantId: number, formId: number): Promise<FormWithFields> {
    const loaded = await this.metadata.getForm(tenantId, formId)
    if (loaded.form.provisionState !== "ready") {
      throw new FormNotReadyError(formId, loaded.form.provisionState)
    }
    return loaded
  }

  private async readyParentTable(tenantId: number, parentFormId: number): Promise<string> {
    const parent = await this.metadata.getForm(tenantId, parentFormId)
    if (parent.form.provisionState !== "ready") {
      throw new FormNotReadyError(parentFormId, parent.form.provisionState)
    }
    return physicalTableName(parent.form.id)
  }

  private async audit(
    tenantId: number,
    formId: number,
    action: string,
    spec: unknown,
    executedSql: string,
    result: "ok" | "failed",
    error?: unknown,
  ): Promise<void> {
    try {
      await this.db.insert(ddlAudits).values({
        tenantId,
        formId,
        action,
        spec: spec as Record<string, unknown>,
        executedSql: executedSql === "" ? null : executedSql,
        result,
        errorMessage: error === undefined ? null : String(error).slice(0, 2000),
      })
    } catch {
      // audit 失敗不得掩蓋原始錯誤;僅記 stderr
      console.error(`ddl_audit write failed for form ${formId} action ${action}`)
    }
  }
}
