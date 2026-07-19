import { Inject, Injectable } from "@nestjs/common"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../../db/db.module.js"
import { fieldDefs, formDefs } from "../../db/schema.js"
import { FieldNotFoundError, FormNotFoundError } from "../errors.js"
import { FIELD_TYPE_REGISTRY } from "../field-types/field-type-registry.js"
import { normalizedOptions, type AddFieldSpec, type CreateFormSpec } from "../specs/form-specs.js"

export type FormDefRow = typeof formDefs.$inferSelect
export type FieldDefRow = typeof fieldDefs.$inferSelect

export interface FormWithFields {
  readonly form: FormDefRow
  readonly fields: readonly FieldDefRow[]
}

/* A1|metadata catalog CRUD(Drizzle 車道)。每查詢綁 tenantId(鐵則 3);
   DDL(M3)包裹本 service:createDraft → 物理 DDL → markProvisioned。 */
@Injectable()
export class MetadataService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async createFormDraft(tenantId: number, spec: CreateFormSpec): Promise<FormWithFields> {
    return this.db.transaction(async (tx) => {
      const insertedForms = await tx
        .insert(formDefs)
        .values({
          tenantId,
          name: spec.name,
          ...(spec.parentFormId !== undefined ? { parentFormId: spec.parentFormId } : {}),
        })
        .returning()
      const form = insertedForms[0]
      if (form === undefined) throw new Error("insert form_def returned no row")

      const fields = await tx
        .insert(fieldDefs)
        .values(
          spec.fields.map((field, index) => ({
            formId: form.id,
            tenantId,
            name: field.name,
            cellValueType: field.type,
            dbFieldType: FIELD_TYPE_REGISTRY[field.type].dbFieldType,
            options: normalizedOptions(field.type, field.options),
            required: field.required,
            isUnique: field.unique,
            position: index,
          })),
        )
        .returning()
      return { form, fields }
    })
  }

  async getForm(tenantId: number, formId: number): Promise<FormWithFields> {
    const forms = await this.db
      .select()
      .from(formDefs)
      .where(
        and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId), isNull(formDefs.deletedAt)),
      )
    const form = forms[0]
    if (form === undefined) throw new FormNotFoundError(formId)

    const fields = await this.db
      .select()
      .from(fieldDefs)
      .where(and(eq(fieldDefs.formId, form.id), isNull(fieldDefs.deletedAt)))
      .orderBy(asc(fieldDefs.position))
    return { form, fields }
  }

  async listForms(tenantId: number): Promise<readonly FormDefRow[]> {
    return this.db
      .select()
      .from(formDefs)
      .where(and(eq(formDefs.tenantId, tenantId), isNull(formDefs.deletedAt)))
      .orderBy(asc(formDefs.id))
  }

  async markProvisioned(
    tenantId: number,
    formId: number,
    state: "ready" | "failed",
  ): Promise<void> {
    const updated = await this.db
      .update(formDefs)
      .set({ provisionState: state, updatedAt: new Date() })
      .where(and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId)))
      .returning({ id: formDefs.id })
    if (updated.length === 0) throw new FormNotFoundError(formId)
  }

  async insertField(
    tenantId: number,
    formId: number,
    spec: AddFieldSpec,
    position: number,
  ): Promise<FieldDefRow> {
    const rows = await this.db
      .insert(fieldDefs)
      .values({
        formId,
        tenantId,
        name: spec.name,
        cellValueType: spec.type,
        dbFieldType: FIELD_TYPE_REGISTRY[spec.type].dbFieldType,
        options: normalizedOptions(spec.type, spec.options),
        required: spec.required,
        isUnique: spec.unique,
        position,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) throw new Error("insert field_def returned no row")
    return row
  }

  async hardDeleteField(tenantId: number, fieldId: number): Promise<void> {
    await this.db
      .delete(fieldDefs)
      .where(and(eq(fieldDefs.tenantId, tenantId), eq(fieldDefs.id, fieldId)))
  }

  /* metadata-only 換位(OQ-FDU-3=B):同 tx 交換兩欄 position;無 DDL、無 rewrite */
  async setFieldPositions(
    tenantId: number,
    updates: readonly { fieldId: number; position: number }[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const { fieldId, position } of updates) {
        await tx
          .update(fieldDefs)
          .set({ position })
          .where(and(eq(fieldDefs.tenantId, tenantId), eq(fieldDefs.id, fieldId)))
      }
    })
  }

  async softDeleteField(tenantId: number, fieldId: number): Promise<void> {
    const updated = await this.db
      .update(fieldDefs)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(fieldDefs.tenantId, tenantId),
          eq(fieldDefs.id, fieldId),
          isNull(fieldDefs.deletedAt),
        ),
      )
      .returning({ id: fieldDefs.id })
    if (updated.length === 0) throw new FieldNotFoundError(fieldId)
  }

  async updateFieldType(
    tenantId: number,
    fieldId: number,
    cellValueType: string,
    dbFieldType: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const updated = await this.db
      .update(fieldDefs)
      .set({ cellValueType, dbFieldType, options })
      .where(
        and(
          eq(fieldDefs.tenantId, tenantId),
          eq(fieldDefs.id, fieldId),
          isNull(fieldDefs.deletedAt),
        ),
      )
      .returning({ id: fieldDefs.id })
    if (updated.length === 0) throw new FieldNotFoundError(fieldId)
  }

  async softDeleteForm(tenantId: number, formId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(formDefs)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId), isNull(formDefs.deletedAt)),
        )
        .returning({ id: formDefs.id })
      if (updated.length === 0) throw new FormNotFoundError(formId)
      await tx
        .update(fieldDefs)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.formId, formId),
            isNull(fieldDefs.deletedAt),
          ),
        )
    })
  }

  async bumpVersion(tenantId: number, formId: number): Promise<void> {
    const updated = await this.db
      .update(formDefs)
      .set({ version: sql`${formDefs.version} + 1`, updatedAt: new Date() })
      .where(and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId)))
      .returning({ id: formDefs.id })
    if (updated.length === 0) throw new FormNotFoundError(formId)
  }
}
