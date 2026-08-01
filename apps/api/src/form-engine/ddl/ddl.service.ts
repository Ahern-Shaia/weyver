import { Inject, Injectable, Optional } from "@nestjs/common"
import { and, eq } from "drizzle-orm"
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
import {
  castExpression,
  type CastOptions,
  needsTryCast,
  quoteColumn,
  tryCastFunctionSql,
} from "../field-types/cast-sql.js"
import {
  classifyConversion,
  type ConversionKind,
  isSafeConversion,
} from "../field-types/type-conversions.js"
import { DATA_SCHEMA, physicalColumnName, physicalTableName, sequenceName } from "../identifiers.js"
import {
  MetadataService,
  type FieldDefRow,
  type FormWithFields,
} from "../metadata/metadata.service.js"
import type { AddFieldSpec, CreateFormSpec } from "../specs/form-specs.js"
import { TrashService } from "../trash/trash.service.js"

const DDL_STATEMENT_TIMEOUT = "10s"
/* 轉換會取 ACCESS EXCLUSIVE;拿不到就放棄而非排隊(排隊會連帶卡住後續讀者) */
const DDL_LOCK_TIMEOUT = "3s"
/* 與匯入撤銷保留期一致(OQ-IMP-1)。側表故不受 PG 1600 欄上限拘束。 */
const CONVERSION_UNDO_DAYS = 30

/* dbFieldType → PG 型別。ALTER ... TYPE 需要真實型別名。 */
const PG_TYPE: Readonly<Record<string, string>> = {
  text: "text",
  numeric: "numeric(19,4)",
  date: "date",
  timestamptz: "timestamptz",
  boolean: "boolean",
  int2: "int2",
  bigint: "bigint",
  text_array: "text[]",
  jsonb: "jsonb",
}

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
    // H-2 回收桶;optional 使既有單元測建構不受影響
    @Optional() @Inject(TrashService) private readonly trash?: TrashService,
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
    /* 🔴 選項的增刪改名一律走 /options(#105)。
       本路徑只換 metadata **不動資料** —— 拿它改選項就是製造孤兒值的那條路。
       擋在這裡而非只寫在文件裡:文件擋不住下一個接手的人。 */
    if (from === newType && (from === "singleSelect" || from === "multiSelect")) {
      throw new InvalidTypeConversionError(from, newType)
    }
    if (!isSafeConversion(from, newType)) throw new InvalidTypeConversionError(from, newType)

    const target = fieldType(newType)
    const options = target.optionsSchema.parse(newOptions) as Record<string, unknown>
    await this.metadata.updateFieldType(tenantId, fieldId, newType, target.dbFieldType, options)
    await this.metadata.bumpVersion(tenantId, formId)
    await this.audit(tenantId, formId, "alterFieldType", { fieldId, from, to: newType }, "", "ok")
  }

  /* 轉換前把整欄原值複製到側表。到期日與匯入撤銷一致(30 天)。 */
  private async snapshotColumn(
    tenantId: number,
    formId: number,
    fieldId: number,
    conversionId: number,
  ): Promise<void> {
    const table = physicalTableName(formId)
    const col = quoteColumn(physicalColumnName(fieldId))
    await this.knex.raw(
      `INSERT INTO field_conversion_snapshot
         (tenant_id, conversion_id, form_id, field_id, record_id, old_value, expires_at)
       SELECT ?, ?, ?, ?, id, to_jsonb(${col}), now() + interval '${CONVERSION_UNDO_DAYS} days'
         FROM ${DATA_SCHEMA}.??
        WHERE tenant_id = ? AND deleted_at IS NULL AND ${col} IS NOT NULL`,
      [tenantId, conversionId, formId, fieldId, table, tenantId],
    )
  }

  /* 🔴 還原一次 lossy 轉換(#105)。
     先把欄位型別轉回去,再從側表把原值寫回。**只寫回快照裡有的列** ——
     轉換後新增的記錄不在快照內,不該被動到。 */
  async revertFieldConversion(
    tenantId: number,
    formId: number,
    fieldId: number,
    conversionId: number,
  ): Promise<{ restored: number }> {
    const audits = await this.db
      .select()
      .from(ddlAudits)
      .where(and(eq(ddlAudits.tenantId, tenantId), eq(ddlAudits.id, conversionId)))
    const spec = audits[0]?.spec as { from?: string; to?: string } | undefined
    const from = spec?.from as CellValueType | undefined
    if (from === undefined) throw new FieldNotFoundError(fieldId)

    const table = physicalTableName(formId)
    const col = quoteColumn(physicalColumnName(fieldId))
    const source = fieldType(from)
    const pgType = PG_TYPE[source.dbFieldType] ?? "text"

    /* 🔴 `USING NULL` 會把**轉換後才新增的列**一起清空(測試抓到的資料遺失)。
       改用反向 cast:先把現值盡量轉回原型別,快照再覆蓋它有的那些列。
       不在快照裡的列(轉換後新增)因此保有自己的值。 */
    const { fields: current } = await this.readyForm(tenantId, formId)
    const nowType = (current.find((f) => f.id === fieldId)?.cellValueType ?? from) as CellValueType

    const restored = await this.knex.transaction(async (trx) => {
      await this.acquireDdlLock(trx, formId)
      await trx.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`)
      const back = await this.castFor(trx, nowType, from, physicalColumnName(fieldId), fieldId, {})
      await trx.raw(
        `ALTER TABLE ${DATA_SCHEMA}.?? ALTER COLUMN ?? TYPE ${pgType} USING (${back.sql})`,
        [table, physicalColumnName(fieldId), ...back.bindings] as Knex.RawBinding[],
      )
      const res = (await trx.raw(
        `UPDATE ${DATA_SCHEMA}.?? t SET ${col} = (
             CASE WHEN jsonb_typeof(s.old_value) = 'array'
                  THEN (SELECT array_agg(x #>> '{}') FROM jsonb_array_elements(s.old_value) x)::text[]::text
                  ELSE s.old_value #>> '{}' END
           )::${pgType}
           FROM field_conversion_snapshot s
          WHERE s.tenant_id = ? AND s.conversion_id = ? AND s.record_id = t.id
            AND t.tenant_id = ?`,
        [table, tenantId, conversionId, tenantId],
      )) as { rowCount?: number }
      return res.rowCount ?? 0
    })

    await this.metadata.updateFieldType(tenantId, fieldId, from, source.dbFieldType, {})
    await this.metadata.bumpVersion(tenantId, formId)
    await this.knex.raw(`ANALYZE ${DATA_SCHEMA}.??`, [table])
    await this.audit(
      tenantId,
      formId,
      "revertFieldConversion",
      { fieldId, conversionId, restoredTo: from, restored },
      "",
      "ok",
    )
    return { restored }
  }

  /* 🔴 dry-run 與執行**共用同一段運算式**(Flyway dry-run 同原理)。
     會拋錯的路徑包進 pg_temp 的 try_cast:轉不動的個別回 NULL,
     而不是讓一筆 "N/A" 弄垮整個 ALTER。函式建在 pg_temp,交易結束即消失。 */
  private async castFor(
    trx: Knex.Transaction,
    from: CellValueType,
    to: CellValueType,
    column: string,
    fieldId: number,
    castOptions: CastOptions,
  ): Promise<{ sql: string; bindings: readonly unknown[] }> {
    const col = quoteColumn(column)
    if (!needsTryCast(from, to)) return castExpression(from, to, col, castOptions)

    const inner = castExpression(from, to, "v", castOptions)
    const fn = `try_cast_${String(fieldId)}`
    const pgType = PG_TYPE[fieldType(to).dbFieldType] ?? "text"
    await trx.raw(tryCastFunctionSql(fn, pgType, inner.sql), inner.bindings as Knex.RawBinding[])
    return { sql: `pg_temp.${fn}(${col}::text)`, bindings: [] }
  }

  /* 🔴 執行轉換(#105)。safe-metadata 走原本的純 metadata 路徑;
     safe-rewrite / lossy 走 ALTER ... USING。

     **rewrite 規則的兩個條件是 AND**(PG 官方):「USING 不改變欄位內容 **且**
     舊型別可 binary coercible」才免 rewrite。只要用了會改值的 USING 就必定 rewrite,
     故此處一律當成會鎖表處理:lock_timeout 拿不到就放棄,不排隊擋讀者。

     ⚠️ 轉換後**必須 ANALYZE** —— 官方明載欄位統計會被清除,不做會使 query plan 劣化。
     這是很容易漏、且症狀是「轉完之後查詢突然變慢」的那種漏。 */
  async convertFieldType(
    tenantId: number,
    formId: number,
    fieldId: number,
    newType: CellValueType,
    castOptions: CastOptions = {},
  ): Promise<{ kind: ConversionKind; conversionId?: number }> {
    const { fields } = await this.readyForm(tenantId, formId)
    const field = fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new FieldNotFoundError(fieldId)
    const from = field.cellValueType as CellValueType
    const rule = classifyConversion(from, newType)
    if (rule.kind === "forbidden") throw new InvalidTypeConversionError(from, newType)
    if (rule.kind === "safe-metadata") {
      await this.alterFieldType(tenantId, formId, fieldId, newType, {})
      return { kind: rule.kind }
    }

    const table = physicalTableName(formId)
    const column = physicalColumnName(fieldId)
    const target = fieldType(newType)
    const pgType = PG_TYPE[target.dbFieldType]
    let executedSql = ""
    let conversionId: number | null = null

    try {
      /* 🔴 lossy 轉換前先把原值存進側表 —— 這是「可還原」的唯一依據。
         Ragic 的型別轉換是非破壞性的(改回去值就回來),客戶的心智是
         「改型別可以隨便試」;我們的物理型別真的變了,只能靠快照補回這個體驗。 */
      if (rule.kind === "lossy") {
        conversionId = await this.audit(
          tenantId,
          formId,
          "convertFieldType",
          { fieldId, from, to: newType, kind: rule.kind, phase: "snapshot" },
          "",
          "ok",
        )
        if (conversionId !== null) {
          await this.snapshotColumn(tenantId, formId, fieldId, conversionId)
        }
      }

      await this.knex.transaction(async (trx) => {
        await this.acquireDdlLock(trx, formId)
        // 拿不到鎖就放棄,不排隊 —— ACCESS EXCLUSIVE 排隊會把後續讀者一起卡住
        await trx.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`)
        const cast = await this.castFor(trx, from, newType, column, fieldId, castOptions)
        executedSql = await this.runStatements(trx, [
          {
            sql: `ALTER TABLE ${DATA_SCHEMA}.?? ALTER COLUMN ?? TYPE ${pgType} USING (${cast.sql})`,
            bindings: [table, column, ...cast.bindings],
          },
        ])
      })
      /* 🔴 options 要盡量沿用而非清空(實作時由測試抓到)。
         單選轉多選若把 `choices` 清掉,欄位就變成沒有任何合法值的選單 ——
         轉換「成功」了但資料再也寫不進去。能被新型別接受的設定就留著。 */
      const carried = target.optionsSchema.safeParse(field.options)
      await this.metadata.updateFieldType(
        tenantId,
        fieldId,
        newType,
        target.dbFieldType,
        carried.success ? (carried.data as Record<string, unknown>) : {},
      )
      await this.metadata.bumpVersion(tenantId, formId)
      /* 統計重建放在交易外:它不需要原子性,而放在交易內會延長持鎖時間 */
      await this.knex.raw(`ANALYZE ${DATA_SCHEMA}.??`, [table])
      await this.audit(
        tenantId,
        formId,
        "convertFieldType",
        { fieldId, from, to: newType, kind: rule.kind },
        executedSql,
        "ok",
      )
      return conversionId === null ? { kind: rule.kind } : { kind: rule.kind, conversionId }
    } catch (error) {
      await this.audit(
        tenantId,
        formId,
        "convertFieldType",
        { fieldId, from, to: newType },
        executedSql,
        "failed",
        error,
      )
      throw error
    }
  }

  /* 🔴 轉換預覽(#105)。唯讀,不加鎖、不改任何資料。
     **必須回兩個數字**:will_be_nulled(會被清空)與 will_be_altered(值會被改變)。
     Airtable 的真實事故是後者 —— 大整數被靜默改值,使用者根本不會發現;
     合併成一個 N 等於把最危險的那類藏起來。 */
  async previewFieldTypeChange(
    tenantId: number,
    formId: number,
    fieldId: number,
    newType: CellValueType,
    castOptions: CastOptions = {},
  ): Promise<{
    kind: ConversionKind
    note?: string
    totalNonNull: number
    willBeNulled: number
    willBeAltered: number
    samples: string[]
  }> {
    const { form, fields } = await this.readyForm(tenantId, formId)
    const field = fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new FieldNotFoundError(fieldId)
    const from = field.cellValueType as CellValueType
    const rule = classifyConversion(from, newType)
    const base = {
      kind: rule.kind,
      ...(rule.note === undefined ? {} : { note: rule.note }),
    }
    if (rule.kind === "forbidden") {
      return { ...base, totalNonNull: 0, willBeNulled: 0, willBeAltered: 0, samples: [] }
    }

    const table = physicalTableName(formId)
    const column = physicalColumnName(fieldId)
    const target = fieldType(newType)

    return this.knex.transaction(async (trx) => {
      await trx.raw(`SET LOCAL statement_timeout = '${DDL_STATEMENT_TIMEOUT}'`)
      const cast = await this.castFor(trx, from, newType, column, fieldId, castOptions)
      const q = quoteColumn(column)
      const res = (await trx.raw(
        `SELECT count(*) FILTER (WHERE ${q} IS NOT NULL)::int AS total,
                count(*) FILTER (WHERE ${q} IS NOT NULL AND (${cast.sql}) IS NULL)::int AS nulled,
                count(*) FILTER (WHERE ${q} IS NOT NULL AND (${cast.sql}) IS NOT NULL
                                   AND (${cast.sql})::text <> ${q}::text)::int AS altered
           FROM ${DATA_SCHEMA}.?? WHERE tenant_id = ? AND deleted_at IS NULL`,
        [
          ...cast.bindings,
          ...cast.bindings,
          ...cast.bindings,
          table,
          tenantId,
        ] as Knex.RawBinding[],
      )) as { rows: { total: number; nulled: number; altered: number }[] }
      const row = res.rows[0] ?? { total: 0, nulled: 0, altered: 0 }

      /* 樣本:讓使用者看見「哪些值會不見」,而不是只看到一個數字 */
      const sample = (await trx.raw(
        `SELECT DISTINCT ${q}::text AS v FROM ${DATA_SCHEMA}.??
           WHERE tenant_id = ? AND deleted_at IS NULL AND ${q} IS NOT NULL
             AND (${cast.sql}) IS NULL LIMIT 10`,
        [table, tenantId, ...cast.bindings] as Knex.RawBinding[],
      )) as { rows: { v: string }[] }

      void form
      void target
      return {
        ...base,
        totalNonNull: row.total,
        willBeNulled: row.nulled,
        willBeAltered: row.altered,
        samples: sample.rows.map((r) => r.v),
      }
    })
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

  /* 欄位下架 = metadata soft-delete;物理欄保留至保留期屆滿,由 TrashPurgeService 真 DROP COLUMN。
     🔴 注意 attnum **永不回收**(本機實測:`VACUUM FULL` 後 dropped 仍在,docs H-2 §0.5)——
     DROP COLUMN 回收的是儲存,不是 1,600 欄的額度。 */
  async dropField(
    tenantId: number,
    formId: number,
    fieldId: number,
    actorId?: number,
  ): Promise<void> {
    const { form } = await this.readyForm(tenantId, formId)
    const { name } = await this.metadata.softDeleteField(tenantId, fieldId)
    await this.trash?.recordStandalone({
      tenantId,
      resourceType: "field",
      resourceId: fieldId,
      formId,
      title: name,
      // 表單名快照:表單後來被刪時,回收桶才不會只剩「表單 #729」
      detail: { formName: form.name },
      deletedBy: actorId ?? null,
    })
    await this.metadata.bumpVersion(tenantId, formId)
    await this.audit(tenantId, formId, "dropField", { fieldId }, "", "ok")
  }

  /* 表單下架 = metadata soft-delete(連帶軟刪其欄位);物理表保留至保留期屆滿。 */
  async dropForm(tenantId: number, formId: number, actorId?: number): Promise<void> {
    const { name, cascadedFieldIds } = await this.metadata.softDeleteForm(tenantId, formId)
    await this.trash?.recordStandalone({
      tenantId,
      resourceType: "form",
      resourceId: formId,
      formId,
      title: name,
      // 只記**這次**連帶刪的,還原時才不會把先前個別刪掉的欄位一起復活
      relatedIds: cascadedFieldIds,
      deletedBy: actorId ?? null,
    })
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
            /* 🔴 E-1 記錄範圍(OQ-DP-9=A):指派存成**固定系統欄** bigint[] + GIN。
               不直接讀該表的 member 欄 —— 那會讓 policy 需引用「這張表的指派欄」,
               而 CREATE POLICY 是 DDL 且表名不可參數化 → 每次規則變更都變 DDL。
               固定欄使**所有動態表共用同一份靜態 policy**(建表時一次寫入,
               消除「新表忘了套」),規則變更成為資料變更。
               實測:bigint[]+GIN 0.16ms vs junction + OR EXISTS 265ms。 */
            t.specificType("assignees", "bigint[]")
            t.index(["tenant_id"])
            t.index(["assignees"], `${table}_assignees_gin`, "gin")
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

    /* 🔴 E-1 記錄範圍的強制點在此,不在應用層(OQ-DP-7=B,推翻 v0.1)。

       §0.6 於 PG 16.13 / 30 萬列實測:RESTRICTIVE policy 與應用層注入 WHERE
       **執行計畫完全相同**(BitmapOr + GIN,0.169ms vs 0.16ms)—— 零效能代價。
       但 RESTRICTIVE **語意恆為 AND**:使用者自訂篩選的 OR 在**語法上不可能逃出**,
       且**應用層漏注入也不外洩**。實測反例規模:少一層括號即 103 倍外洩(309 列 vs 3 列)。

       `app.record_scope` 為 'all' 或 ''(未設)時整條為真 → 既有行為不變、零遷移。
       設為 'own' 時,只看得到自己建立的 + 被指派的。
       ⚠️ 述詞只用簡單運算與 current_setting,**不得呼叫非 LEAKPROOF 的自訂函數**
       —— 那會讓 planner 放棄 pushdown 而退化成全表掃。 */
    const scope = "NULLIF(current_setting('app.record_scope', true), '')"
    const actor = "NULLIF(current_setting('app.actor_id', true), '')::bigint"
    const scopePredicate = `(
      COALESCE(${scope}, 'all') <> 'own'
      OR created_by = ${actor}
      OR assignees @> ARRAY[${actor}]
    )`
    return [
      `ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY tenant_isolation ON ${qualified} USING (${predicate}) WITH CHECK (${predicate})`,
      `CREATE POLICY record_scope ON ${qualified} AS RESTRICTIVE USING ${scopePredicate}`,
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
  ): Promise<number | null> {
    try {
      const [row] = await this.db
        .insert(ddlAudits)
        .values({
          tenantId,
          formId,
          action,
          spec: spec as Record<string, unknown>,
          executedSql: executedSql === "" ? null : executedSql,
          result,
          errorMessage: error === undefined ? null : String(error).slice(0, 2000),
        })
        .returning({ id: ddlAudits.id })
      return row?.id ?? null
    } catch {
      // audit 失敗不得掩蓋原始錯誤;僅記 stderr
      console.error(`ddl_audit write failed for form ${formId} action ${action}`)
      return null
    }
  }
}
