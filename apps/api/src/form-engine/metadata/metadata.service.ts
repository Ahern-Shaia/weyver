import { Inject, Injectable } from "@nestjs/common"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../../db/db.module.js"
import { fieldDefs, formDefs, users } from "../../db/schema.js"
import { FieldNotFoundError, FormNotFoundError, LayoutVersionConflictError } from "../errors.js"
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
  constructor(
    /* 特權車道:僅用於跨租戶系統表(users;weyver_app 無 grant)。 */
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    /* F-6 M3:租戶範疇 metadata(form_def / field_def)一律經此 —— app 車道 + app.tenant_id
       → 既有 RLS FORCE 成為第二防線(T4);app 層 WHERE tenant_id 仍保留為第一防線。 */
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  /* actorId 選用:有則寫 created_by(owner 短路,OQ-ARI-4);系統/種子建表可省。
     created_by 須為真實 users 列(FK):prod actorId 必為已 upsert 之使用者;dev 之 x-dev-actor 為
     stub、可能不對應真實使用者 → 查無則存 null(無 owner),避免 FK violation 打斷 dev 建表流程。 */
  async createFormDraft(
    tenantId: number,
    spec: CreateFormSpec,
    actorId?: number,
  ): Promise<FormWithFields> {
    let createdBy: number | null = null
    if (actorId !== undefined) {
      // users 為跨租戶系統表(非 RLS、app 角色無 grant)→ 特權車道;純讀取,無跨車道原子性顧慮
      const found = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1)
      createdBy = found[0]?.id ?? null
    }
    return this.tenantDb.withTenant(tenantId, async (tx) => {
      const insertedForms = await tx
        .insert(formDefs)
        .values({
          tenantId,
          name: spec.name,
          createdBy,
          ...(spec.parentFormId !== undefined ? { parentFormId: spec.parentFormId } : {}),
        })
        .returning()
      const form = insertedForms[0]
      if (form === undefined) throw new Error("insert form_def returned no row")

      /* 零欄位是合法的(建表 = 命名 → 進設計器);drizzle 的 values([]) 會拋錯 */
      if (spec.fields.length === 0) return { form, fields: [] }

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
    return this.tenantDb.withTenant(tenantId, async (tx) => {
      const forms = await tx
        .select()
        .from(formDefs)
        .where(
          and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId), isNull(formDefs.deletedAt)),
        )
      const form = forms[0]
      if (form === undefined) throw new FormNotFoundError(formId)

      const fields = await tx
        .select()
        .from(fieldDefs)
        .where(and(eq(fieldDefs.formId, form.id), isNull(fieldDefs.deletedAt)))
        .orderBy(asc(fieldDefs.position))
      return { form, fields }
    })
  }

  async listForms(tenantId: number): Promise<readonly FormDefRow[]> {
    return this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(formDefs)
        .where(and(eq(formDefs.tenantId, tenantId), isNull(formDefs.deletedAt)))
        .orderBy(asc(formDefs.id)),
    )
  }

  async markProvisioned(
    tenantId: number,
    formId: number,
    state: "ready" | "failed",
  ): Promise<void> {
    const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(formDefs)
        .set({ provisionState: state, updatedAt: new Date() })
        .where(and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId)))
        .returning({ id: formDefs.id }),
    )
    if (updated.length === 0) throw new FormNotFoundError(formId)
  }

  async insertField(
    tenantId: number,
    formId: number,
    spec: AddFieldSpec,
    position: number,
  ): Promise<FieldDefRow> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
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
      .returning(),
    )
    const row = rows[0]
    if (row === undefined) throw new Error("insert field_def returned no row")
    return row
  }

  async hardDeleteField(tenantId: number, fieldId: number): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx.delete(fieldDefs).where(and(eq(fieldDefs.tenantId, tenantId), eq(fieldDefs.id, fieldId))),
    )
  }

  /* metadata-only 換位(OQ-FDU-3=B):同 tx 交換兩欄 position;無 DDL、無 rewrite */
  async setFieldPositions(
    tenantId: number,
    updates: readonly { fieldId: number; position: number }[],
  ): Promise<void> {
    await this.tenantDb.withTenant(tenantId, async (tx) => {
      for (const { fieldId, position } of updates) {
        await tx
          .update(fieldDefs)
          .set({ position })
          .where(and(eq(fieldDefs.tenantId, tenantId), eq(fieldDefs.id, fieldId)))
      }
    })
  }

  async softDeleteField(tenantId: number, fieldId: number): Promise<void> {
    const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(fieldDefs)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.id, fieldId),
            isNull(fieldDefs.deletedAt),
          ),
        )
        .returning({ id: fieldDefs.id }),
    )
    if (updated.length === 0) throw new FieldNotFoundError(fieldId)
  }

  /* 只換 options,不動型別 —— 選項增刪改名走此路徑(資料改寫由 OptionService 負責)。 */
  async updateFieldOptions(
    tenantId: number,
    fieldId: number,
    options: Record<string, unknown>,
  ): Promise<void> {
    const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(fieldDefs)
        .set({ options })
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.id, fieldId),
            isNull(fieldDefs.deletedAt),
          ),
        )
        .returning({ id: fieldDefs.id }),
    )
    if (updated.length === 0) throw new FieldNotFoundError(fieldId)
  }

  async updateFieldType(
    tenantId: number,
    fieldId: number,
    cellValueType: string,
    dbFieldType: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(fieldDefs)
        .set({ cellValueType, dbFieldType, options })
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.id, fieldId),
            isNull(fieldDefs.deletedAt),
          ),
        )
        .returning({ id: fieldDefs.id }),
    )
    if (updated.length === 0) throw new FieldNotFoundError(fieldId)
  }

  async softDeleteForm(tenantId: number, formId: number): Promise<void> {
    await this.tenantDb.withTenant(tenantId, async (tx) => {
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

  /* R1·UP-3 2D 設計器:整表版面覆寫(純 metadata,零 DDL)+ bumpVersion。 */
  /* 🔴 版面是**整表覆寫**,兩人同時編輯後寫者會蓋掉整張版面(#109)。
     `version` 一直在遞增卻從沒人檢查 —— 樂觀鎖的材料早就在,只差條件式 UPDATE。
     expectedVersion 未給時維持舊行為(既有呼叫端不受影響)。 */
  async setLayout(
    tenantId: number,
    formId: number,
    layout: unknown,
    expectedVersion?: number,
  ): Promise<number> {
    const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(formDefs)
        .set({ layout, version: sql`${formDefs.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(formDefs.tenantId, tenantId),
            eq(formDefs.id, formId),
            isNull(formDefs.deletedAt),
            ...(expectedVersion === undefined ? [] : [eq(formDefs.version, expectedVersion)]),
          ),
        )
        .returning({ id: formDefs.id, version: formDefs.version }),
    )
    if (updated.length === 0) {
      /* 分辨「表不存在」與「版本被人改過」—— 兩者的使用者動作完全不同 */
      if (expectedVersion !== undefined) {
        const current = await this.tenantDb.withTenant(tenantId, (tx) =>
          tx
            .select({ version: formDefs.version })
            .from(formDefs)
            .where(
              and(
                eq(formDefs.tenantId, tenantId),
                eq(formDefs.id, formId),
                isNull(formDefs.deletedAt),
              ),
            ),
        )
        const found = current[0]
        if (found !== undefined) throw new LayoutVersionConflictError(expectedVersion, found.version)
      }
      throw new FormNotFoundError(formId)
    }
    return updated[0]?.version ?? 0
  }

  /* $USERNAME 預設值解析用(DRIZZLE 車道;weyver_app 無 users grant → 走此)。 */
  async getUserName(actorId: number): Promise<string | null> {
    const rows = await this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1)
    return rows[0]?.name ?? null
  }

  async bumpVersion(tenantId: number, formId: number): Promise<void> {
    const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(formDefs)
        .set({ version: sql`${formDefs.version} + 1`, updatedAt: new Date() })
        .where(and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId)))
        .returning({ id: formDefs.id }),
    )
    if (updated.length === 0) throw new FormNotFoundError(formId)
  }
}
