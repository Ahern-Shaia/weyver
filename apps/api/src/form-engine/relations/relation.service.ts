import { Inject, Injectable } from "@nestjs/common"
import { and, eq } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../../db/db.module.js"
import { relationDefs } from "../../db/schema.js"
import { NotALinkFieldError, UnknownFieldError } from "../errors.js"
import type { FieldDefRow } from "../metadata/metadata.service.js"
import { MetadataService } from "../metadata/metadata.service.js"
import { RecordService } from "../records/record.service.js"
import type { RecordValues } from "../records/record-specs.js"

function linkTargetFormId(field: FieldDefRow): number | null {
  const options = field.options
  if (options !== null && typeof options === "object" && "targetFormId" in options) {
    const target = (options as { targetFormId: unknown }).targetFormId
    if (typeof target === "number") return target
  }
  return null
}

/* P0-3 A3|Link + Load(關聯 + 帶入)。link 欄之儲存(bigint 目標 record id + options.targetFormId)
   已由 form-engine 型別系統落地;本 service 補「關聯註冊」+「Load 帶入」(讀目標記錄指定欄值)。
   Lookup(即時)/ Rollup(聚合)為 M4。 */
@Injectable()
export class RelationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(RecordService) private readonly records: RecordService,
  ) {}

  private async resolveLinkField(
    tenantId: number,
    formId: number,
    linkFieldName: string,
  ): Promise<{ field: FieldDefRow; targetFormId: number }> {
    const { fields } = await this.metadata.getForm(tenantId, formId)
    const field = fields.find((f) => f.name === linkFieldName)
    if (field === undefined) throw new UnknownFieldError(linkFieldName)
    if (field.cellValueType !== "link") throw new NotALinkFieldError(linkFieldName)
    const targetFormId = linkTargetFormId(field)
    if (targetFormId === null) throw new NotALinkFieldError(linkFieldName)
    return { field, targetFormId }
  }

  /* 註冊關聯 metadata(idempotent;M4 Lookup/Rollup 之反向查詢用)*/
  async registerRelation(tenantId: number, formId: number, linkFieldName: string): Promise<void> {
    const { field, targetFormId } = await this.resolveLinkField(tenantId, formId, linkFieldName)
    const existing = await this.db
      .select()
      .from(relationDefs)
      .where(and(eq(relationDefs.tenantId, tenantId), eq(relationDefs.fieldId, field.id)))
    if (existing.length > 0) return
    await this.db.insert(relationDefs).values({ tenantId, formId, fieldId: field.id, targetFormId })
  }

  /* Load / 帶入:給 link 欄指向的目標 record id → 讀目標記錄之指定欄值(快照複製至來源記錄之語意)。
     未指定 loadFieldNames 則回全部值。目標欄名不存在 → UnknownFieldError。 */
  async load(
    tenantId: number,
    formId: number,
    linkFieldName: string,
    linkedRecordId: number,
    loadFieldNames?: readonly string[],
  ): Promise<RecordValues> {
    const { targetFormId } = await this.resolveLinkField(tenantId, formId, linkFieldName)
    const target = await this.records.getRecord(tenantId, targetFormId, linkedRecordId)

    if (loadFieldNames === undefined) return target.values

    const out: Record<string, unknown> = {}
    for (const name of loadFieldNames) {
      if (!(name in target.values)) throw new UnknownFieldError(name)
      out[name] = target.values[name]
    }
    return out
  }
}
