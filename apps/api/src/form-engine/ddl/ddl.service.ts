import { Inject, Injectable, Optional } from "@nestjs/common"
import type { Knex } from "knex"
import { DDL_KNEX, DRIZZLE, type DrizzleDb } from "../../db/db.module.js"
import { ddlAudits } from "../../db/schema.js"
import { FormulaService } from "../formula/formula.service.js"
import { QuotaService } from "../../reliability/quota.service.js"
import {
  FieldNotFoundError,
  FormNotPendingError,
  FormNotReadyError,
  InvalidTypeConversionError,
} from "../errors.js"
import { fieldType, type CellValueType } from "../field-types/field-type-registry.js"
import { isSafeConversion } from "../field-types/type-conversions.js"
import { DATA_SCHEMA, physicalColumnName, physicalTableName, sequenceName } from "../identifiers.js"
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
    // formula 欄建立後自動註冊 formula_def(P0-3 M6);optional 不影響既有測試建構
    @Optional() @Inject(FormulaService) private readonly formula?: FormulaService,
    // F-6 M2 配額(C5 DDL DoS);optional 使既有單元測建構不受影響
    @Optional() @Inject(QuotaService) private readonly quota?: QuotaService,
  ) {}

  async createForm(
    tenantId: number,
    spec: CreateFormSpec,
    actorId?: number,
  ): Promise<FormWithFields> {
    if (this.quota !== undefined) {
      await this.quota.assertCanCreateForm(tenantId)
      await this.quota.assertFieldCountWithinQuota(tenantId, spec.fields.length)
    }
    const draft = await this.metadata.createFormDraft(tenantId, spec, actorId)
    await this.provisionForm(tenantId, draft)
    const loaded = await this.metadata.getForm(tenantId, draft.form.id)
    await this.defineFormulaFields(tenantId, loaded)
    return loaded
  }

  /* formula 欄:parse / 依賴解析 / 型別推斷 / 循環偵測 → 存 formula_def(FormulaService)。 */
  private async defineFormulaFields(tenantId: number, loaded: FormWithFields): Promise<void> {
    if (this.formula === undefined) return
    for (const field of loaded.fields) {
      if (field.cellValueType !== "formula") continue
      const options = field.options
      const expr =
        options !== null && typeof options === "object" && "expression" in options
          ? (options as { expression: unknown }).expression
          : undefined
      if (typeof expr === "string") {
        await this.formula.defineFormula(tenantId, loaded.form.id, field.id, expr)
      }
    }
  }

  async addField(tenantId: number, formId: number, spec: AddFieldSpec): Promise<FieldDefRow> {
    const { form, fields } = await this.readyForm(tenantId, formId)
    if (this.quota !== undefined) await this.quota.assertCanAddFields(tenantId, formId, 1)
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
        if (spec.type === "autoNumber") {
          executedSql += await this.runRaw(trx, [
            this.sequenceDdl(table, row.id),
            this.sequenceGrantDdl(row.id),
          ])
        }
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

  /* 欄位換位(上/下移):metadata-only,交換相鄰 live 欄之 position(OQ-FDU-3=B)*/
  async moveField(
    tenantId: number,
    formId: number,
    fieldId: number,
    direction: "up" | "down",
  ): Promise<void> {
    const { fields } = await this.readyForm(tenantId, formId)
    const index = fields.findIndex((f) => f.id === fieldId)
    if (index < 0) throw new FieldNotFoundError(fieldId)
    const swapIndex = direction === "up" ? index - 1 : index + 1
    const current = fields[index]
    const neighbor = fields[swapIndex]
    if (current === undefined || neighbor === undefined) return // 邊界 no-op
    await this.metadata.setFieldPositions(tenantId, [
      { fieldId: current.id, position: neighbor.position },
      { fieldId: neighbor.id, position: current.position },
    ])
    await this.metadata.bumpVersion(tenantId, formId)
    await this.audit(tenantId, formId, "moveField", { fieldId, direction }, "", "ok")
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
        executedSql += await this.runRaw(trx, [this.appGrantDdl(table)])
        for (const field of fields) {
          if (field.cellValueType === "autoNumber") {
            executedSql += await this.runRaw(trx, [
              this.sequenceDdl(table, field.id),
              this.sequenceGrantDdl(field.id),
            ])
          }
        }
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

  private sequenceDdl(table: string, fieldId: number): string {
    const seq = sequenceName(fieldId)
    const column = physicalColumnName(fieldId)
    return (
      `CREATE SEQUENCE "${DATA_SCHEMA}"."${seq}" ` +
      `OWNED BY "${DATA_SCHEMA}"."${table}"."${column}"`
    )
  }

  /* app 車道(weyver_app)對每張動態表 / 取號 sequence 的最小授權;RLS 負責列級隔離 */
  private appGrantDdl(table: string): string {
    return `GRANT SELECT, INSERT, UPDATE, DELETE ON "${DATA_SCHEMA}"."${table}" TO weyver_app`
  }

  private sequenceGrantDdl(fieldId: number): string {
    return `GRANT USAGE ON SEQUENCE "${DATA_SCHEMA}"."${sequenceName(fieldId)}" TO weyver_app`
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
