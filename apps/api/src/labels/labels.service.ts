import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import { labelDefs } from "../db/schema.js"
import { MetadataService } from "../form-engine/metadata/metadata.service.js"
import type { TenantContext } from "../http/tenant-context.js"
import {
  type CreateLabelBody,
  type LabelConfig,
  type LabelDto,
  type UpdateLabelBody,
  labelConfigSchema,
} from "./label-specs.js"

/* R1·後續-2 標籤定義 CRUD(authz Tier-1 DRIZZLE 車道 + app tenant scope,OQ-PM-5)。
   config 之欄名於寫入時驗證 ⊆ 該表現存欄位(渲染時另有 ∩ 兜底,FMEA P5)。 */

const NUMERIC_TYPES = new Set(["number", "money", "percent", "rating", "formula", "rollup"])

@Injectable()
export class LabelsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  async list(tenant: TenantContext, formId: number): Promise<LabelDto[]> {
    const rows = await this.db
      .select()
      .from(labelDefs)
      .where(
        and(
          eq(labelDefs.tenantId, tenant.tenantId),
          eq(labelDefs.formId, formId),
          isNull(labelDefs.deletedAt),
        ),
      )
      .orderBy(asc(labelDefs.position), asc(labelDefs.id))
    return rows.map(toDto)
  }

  async create(tenant: TenantContext, formId: number, body: CreateLabelBody): Promise<LabelDto> {
    await this.assertConfigFields(tenant, formId, body.config)
    const existing = await this.list(tenant, formId)
    const position = existing.reduce((m, l) => Math.max(m, l.position + 1), 0)
    const inserted = await this.db
      .insert(labelDefs)
      .values({
        tenantId: tenant.tenantId,
        formId,
        name: body.name,
        config: body.config,
        position,
      })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error("createLabel: insert returned no row")
    return toDto(row)
  }

  async update(
    tenant: TenantContext,
    formId: number,
    labelId: number,
    body: UpdateLabelBody,
  ): Promise<LabelDto> {
    await this.requireLabel(tenant, formId, labelId)
    if (body.config !== undefined) await this.assertConfigFields(tenant, formId, body.config)
    const set: Record<string, unknown> = {}
    if (body.name !== undefined) set.name = body.name
    if (body.config !== undefined) set.config = body.config
    if (body.position !== undefined) set.position = body.position
    if (Object.keys(set).length > 0) {
      await this.db
        .update(labelDefs)
        .set(set)
        .where(and(eq(labelDefs.tenantId, tenant.tenantId), eq(labelDefs.id, labelId)))
    }
    const updated = await this.requireLabel(tenant, formId, labelId)
    return updated
  }

  async remove(tenant: TenantContext, formId: number, labelId: number): Promise<void> {
    await this.requireLabel(tenant, formId, labelId)
    await this.db
      .update(labelDefs)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(labelDefs.tenantId, tenant.tenantId), eq(labelDefs.id, labelId)))
  }

  private async requireLabel(
    tenant: TenantContext,
    formId: number,
    labelId: number,
  ): Promise<LabelDto> {
    const rows = await this.db
      .select()
      .from(labelDefs)
      .where(
        and(
          eq(labelDefs.tenantId, tenant.tenantId),
          eq(labelDefs.id, labelId),
          isNull(labelDefs.deletedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined || row.formId !== formId) {
      throw new NotFoundException({ code: "LABEL_NOT_FOUND", message: `label ${labelId}` })
    }
    return toDto(row)
  }

  /* items 欄名 + copiesField 須為該表現存欄;copiesField 另須為數值型 */
  private async assertConfigFields(
    tenant: TenantContext,
    formId: number,
    config: LabelConfig,
  ): Promise<void> {
    const { fields } = await this.metadata.getForm(tenant.tenantId, formId)
    const byName = new Map(fields.map((f) => [f.name, f]))
    for (const item of config.items) {
      if (!byName.has(item.field)) {
        throw new BadRequestException({
          code: "INVALID_LABEL_CONFIG",
          message: `欄位不存在:${item.field}`,
        })
      }
    }
    if (config.copiesField !== undefined) {
      const f = byName.get(config.copiesField)
      if (f === undefined) {
        throw new BadRequestException({
          code: "INVALID_LABEL_CONFIG",
          message: `數量參照欄不存在:${config.copiesField}`,
        })
      }
      if (!NUMERIC_TYPES.has(f.cellValueType)) {
        throw new BadRequestException({
          code: "INVALID_LABEL_CONFIG",
          message: `數量參照欄須為數值型:${config.copiesField}`,
        })
      }
    }
  }
}

function toDto(row: typeof labelDefs.$inferSelect): LabelDto {
  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    // 讀時 parse 兜底(DB 竄改/舊版 → fail-closed)
    config: labelConfigSchema.parse(row.config),
    position: row.position,
  }
}
