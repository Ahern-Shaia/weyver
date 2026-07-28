import { randomUUID } from "node:crypto"
import type { Readable } from "node:stream"
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { and, eq, isNull } from "drizzle-orm"
import type { Knex } from "knex"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { APP_KNEX, TenantDb } from "../db/db.module.js"
import { fieldDefs } from "../db/schema.js"
import { DATA_SCHEMA, physicalTableName } from "../form-engine/identifiers.js"
import type { TenantContext } from "../http/tenant-context.js"
import { detectType, hasSpreadsheetFormula, sanitizeFilename } from "../storage/file-type.js"
import { ImageProcessor } from "../storage/image-processor.js"
import {
  STORAGE_DRIVER,
  type StorageDriver,
  isValidKey,
  thumbnailKeyOf,
} from "../storage/storage-driver.js"
import {
  ATTACHMENT_FIELD_TYPES,
  type FileDto,
  type FileStatus,
  isMimeAllowedForField,
} from "./file-specs.js"

/* F-5 M2/M3|檔案上傳/下載/刪除 + 兩階段綁定。file_object 走 **RLS 車道**(APP_KNEX + set_config,
   與 records 同級;OQ-FS-7)—— 檔案 metadata 是租戶記錄資料而非表單定義。
   授權三層(FMEA S1/S2):RLS 綁租戶(最後防線)→ 表單級動作 → 欄位級可見性;
   **key 不是授權憑證**(OQ-FS-4):下載一律回查本表取得 (form, field) 再驗權限,猜到 key 亦無用。
   欄位型別直查 field_def(Drizzle,承 authz.repository 直查 form_def 之慣例)—— 不依賴
   FormEngineModule,使 RecordService 可反向注入本 service 做綁定而不成循環(AGENTS 禁 forwardRef)。 */

/* pending 檔逾此時數未綁記錄 → 標 orphaned(OQ-FS-5)。 */
const ORPHAN_AFTER_HOURS = 24

interface FileObjectRow {
  readonly key: string
  readonly tenant_id: string | number
  readonly form_id: string | number
  readonly field_id: string | number
  readonly record_id: string | number | null
  readonly name: string
  readonly mime: string
  readonly size: string | number
  readonly status: FileStatus
}

function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value)
}

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name)

  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* FMEA S10|部署順序防護:0014 未套用時於**開機**即明示失敗,而非等到使用者上傳才 500。
     prod fail-fast(容器不啟動 → 部署顯性失敗);dev/test 只告警,避免尚未 migrate 的本機無法啟動。 */
  async onModuleInit(): Promise<void> {
    const result = await this.knex.raw<{ rows: { reg: string | null }[] }>(
      "SELECT to_regclass('public.file_object')::text AS reg",
    )
    if (result.rows[0]?.reg != null) return
    const message = "file_object 資料表不存在:請先套用 migration 0014(pnpm db:migrate)"
    if (this.config.get<string>("NODE_ENV") === "production") throw new Error(message)
    this.logger.warn(message)
  }

  maxFileBytes(): number {
    return (this.config.get<number>("STORAGE_MAX_FILE_MB") ?? 20) * 1024 * 1024
  }

  private quotaBytes(): number {
    return (this.config.get<number>("STORAGE_TENANT_QUOTA_MB") ?? 2048) * 1024 * 1024
  }

  /* SET LOCAL 不可參數綁定 → set_config(..., true) 交易範圍等價(承 RecordService) */
  private async inTenantTx<T>(
    tenantId: number,
    fn: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.knex.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
      return fn(trx)
    })
  }

  async upload(
    tenant: TenantContext,
    permissions: EffectivePermissions,
    formId: number,
    fieldId: number,
    filename: string,
    body: Buffer,
  ): Promise<FileDto> {
    if (body.length === 0) {
      throw new BadRequestException({ code: "EMPTY_FILE", message: "檔案為空" })
    }
    if (body.length > this.maxFileBytes()) {
      throw new PayloadTooLargeException({
        code: "FILE_TOO_LARGE",
        message: `檔案超過上限 ${this.maxFileBytes() / 1024 / 1024} MB`,
      })
    }

    const field = await this.attachmentField(tenant.tenantId, formId, fieldId)
    if (field === undefined) {
      throw new BadRequestException({
        code: "NOT_ATTACHMENT_FIELD",
        message: `欄位 ${fieldId} 非附件欄`,
      })
    }
    // 欄位級白名單寫入(與 RecordService.assertWritable 同源判定)
    if (permissions.fieldVisibility(fieldId, formId) !== "write") {
      throw new ForbiddenException({ code: "FIELD_FORBIDDEN", message: "無此欄位寫入權限" })
    }

    // magic bytes 驗型別(非副檔名;docs/22)—— 不符即拒,絕不靜默改名放行
    const detected = detectType(body, filename)
    if (detected === null) {
      throw new UnsupportedMediaTypeException({
        code: "UNSUPPORTED_FILE_TYPE",
        message: "不支援的檔案類型(以檔案內容判定,非副檔名)",
      })
    }
    /* 🔴 儲存型 CSV 公式注入:合法的 CSV 也可能是攻擊載體
       (`=cmd|'/c calc'!A1` → 同事以 Excel 開啟即觸發 DDE)。
       型別白名單擋不住,必須看內容。**拒收而非靜默改寫** —— 上傳的是使用者的
       原始檔案,改內容會破壞資料。 */
    if (detected.mime === "text/csv" && hasSpreadsheetFormula(body)) {
      throw new UnsupportedMediaTypeException({
        code: "CSV_FORMULA_REJECTED",
        message: "CSV 內含以 = + - @ 開頭的儲存格,可能在試算表軟體中被當成公式執行,故不接受。請改用 Excel(.xlsx)格式上傳。",
      })
    }
    // 欄型再收斂(R1·UP-4b):影像欄只收影像
    if (!isMimeAllowedForField(field.cellValueType, detected.mime)) {
      throw new UnsupportedMediaTypeException({
        code: "UNSUPPORTED_FILE_TYPE",
        message: "此欄位只接受影像檔(PNG / JPEG / GIF / WebP)",
      })
    }

    /* F-7 影像處理:剝除 EXIF(優先無損)+ 產生縮圖 + 解壓縮炸彈防護。
       非影像檔原樣通過。處理在配額檢核**之前** —— 配額應以實際佔用量計。 */
    const processed = await this.images.process(body, detected.mime)
    const storedSize = processed.body.length + (processed.thumbnail?.length ?? 0)

    // 落儲存前先回收逾期孤兒(釋放配額)再核配額 —— 無排程器之低 ops 做法(掃描走 status 索引)
    await this.sweepStalePending(tenant.tenantId)
    await this.assertQuota(tenant.tenantId, storedSize)

    // 生成檔名(docs/22):使用者檔名永不入路徑,只存 metadata
    const key = `t${tenant.tenantId}/f${formId}/${randomUUID()}${detected.ext}`
    await this.storage.put(key, processed.body, { mime: detected.mime })
    if (processed.thumbnail !== undefined) {
      await this.storage.put(thumbnailKeyOf(key), processed.thumbnail, { mime: "image/webp" })
    }

    await this.inTenantTx(tenant.tenantId, (trx) =>
      trx("file_object").insert({
        key,
        tenant_id: tenant.tenantId,
        form_id: formId,
        field_id: fieldId,
        name: sanitizeFilename(filename),
        mime: detected.mime,
        size: storedSize,
        status: "pending" satisfies FileStatus,
        created_by: tenant.actorId,
      }),
    )

    return { key, name: sanitizeFilename(filename), mime: detected.mime, size: storedSize }
  }

  /* 下載:回查 metadata → 表單 view → 欄位非 hidden → 記錄未刪 → 串流(FMEA S1/S2/S7)。 */
  async openForDownload(
    tenant: TenantContext,
    permissions: EffectivePermissions,
    key: string,
    variant?: "thumb",
  ): Promise<{ readonly stream: Readable; readonly meta: FileDto }> {
    const row = await this.requireFile(tenant, key)
    const formId = num(row.form_id)
    const fieldId = num(row.field_id)
    if (!permissions.hasAction(formId, "view")) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "無此表單檢視權限" })
    }
    if (permissions.fieldVisibility(fieldId, formId) === "hidden") {
      throw new ForbiddenException({ code: "FIELD_FORBIDDEN", message: "無此欄位檢視權限" })
    }
    await this.assertRecordReadable(tenant.tenantId, formId, row.record_id)
    /* 縮圖為衍生物,授權沿用原檔那一條鏈(上方已驗);取不到即回原檔 —— 前端因此永不破圖
       (OQ-IP-9=A:不建重生工具,以退回原圖取代)。 */
    if (variant === "thumb") {
      const thumbKey = thumbnailKeyOf(key)
      const exists = await this.storage.stat(thumbKey)
      if (exists !== null) {
        return {
          stream: await this.storage.get(thumbKey),
          meta: { key: thumbKey, name: row.name, mime: "image/webp", size: exists.size },
        }
      }
    }
    /* Content-Length 必須是**實際串流之物件**的大小 —— `file_object.size` 記的是配額佔用
       (主檔 + 縮圖),用它當 Content-Length 會多報縮圖大小而導致傳輸截斷(實測 curl 18)。 */
    const stat = await this.storage.stat(key)
    const stream = await this.storage.get(key)
    return {
      stream,
      meta: { key: row.key, name: row.name, mime: row.mime, size: stat?.size ?? num(row.size) },
    }
  }

  /* 刪除 = 表單 edit;soft delete(實體回收由清理 job;承 records soft-delete 語意)。
     縮圖為衍生物、無獨立 metadata 列 → 實體回收時由 key 推導一併刪(見 CleanupService)。 */
  async remove(
    tenant: TenantContext,
    permissions: EffectivePermissions,
    key: string,
  ): Promise<void> {
    const row = await this.requireFile(tenant, key)
    if (!permissions.hasAction(num(row.form_id), "edit")) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "無此表單編輯權限" })
    }
    await this.inTenantTx(tenant.tenantId, (trx) =>
      trx("file_object")
        .where({ key, tenant_id: tenant.tenantId })
        .update({ deleted_at: trx.fn.now() }),
    )
  }

  /* M3 兩階段綁定(OQ-FS-5):記錄存檔後由 RecordService 回呼。
     - 該筆附件欄現值之 key → pending/bound 皆標 bound + 寫 record_id(冪等)
     - 原綁此筆但已從欄值移除者 → orphaned(使用者換掉附件後不佔配額)
     授權已於記錄存檔路徑驗畢(能寫該筆記錄才會走到此);此處只認 tenant + form + record。 */
  async bindToRecord(
    tenantId: number,
    formId: number,
    recordId: number,
    keys: readonly string[],
  ): Promise<void> {
    const valid = [...new Set(keys.filter(isValidKey))]
    await this.inTenantTx(tenantId, async (trx) => {
      if (valid.length > 0) {
        await trx("file_object")
          .where({ tenant_id: tenantId, form_id: formId })
          .whereIn("key", valid)
          .whereNull("deleted_at")
          .update({ status: "bound" satisfies FileStatus, record_id: recordId })
      }
      const stale = trx("file_object")
        .where({ tenant_id: tenantId, form_id: formId, record_id: recordId })
        .whereNull("deleted_at")
      if (valid.length > 0) void stale.whereNotIn("key", valid)
      await stale.update({ status: "orphaned" satisfies FileStatus })
    })
  }

  /* 逾期未綁之 pending → orphaned(不刪實體;實體回收 job 為 P1,doc §12 S6 明標殘留)。 */
  async sweepStalePending(tenantId: number): Promise<number> {
    return this.inTenantTx(tenantId, (trx) =>
      trx("file_object")
        .where({ tenant_id: tenantId, status: "pending" satisfies FileStatus })
        .whereNull("deleted_at")
        .whereRaw(`created_at < now() - interval '${ORPHAN_AFTER_HOURS} hours'`)
        .update({ status: "orphaned" satisfies FileStatus }),
    )
  }

  /* 租戶總量配額(docs/04 A 配額;FMEA S5 noisy neighbor)。orphaned / 已刪不計。 */
  private async assertQuota(tenantId: number, incomingBytes: number): Promise<void> {
    const quota = this.quotaBytes()
    const used = await this.usedBytes(tenantId)
    if (used + incomingBytes > quota) {
      throw new PayloadTooLargeException({
        code: "STORAGE_QUOTA_EXCEEDED",
        message: `租戶儲存空間已達上限 ${quota / 1024 / 1024} MB(已用 ${Math.round(used / 1024 / 1024)} MB)`,
      })
    }
  }

  async usedBytes(tenantId: number): Promise<number> {
    const row = await this.inTenantTx(tenantId, (trx) =>
      trx("file_object")
        .where({ tenant_id: tenantId })
        .whereNull("deleted_at")
        .whereNot({ status: "orphaned" satisfies FileStatus })
        .sum({ total: "size" })
        .first<{ total: string | number | null } | undefined>(),
    )
    return row?.total === null || row?.total === undefined ? 0 : num(row.total)
  }

  private async attachmentField(
    tenantId: number,
    formId: number,
    fieldId: number,
  ): Promise<{ readonly id: number; readonly cellValueType: string } | undefined> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({ id: fieldDefs.id, cellValueType: fieldDefs.cellValueType })
        .from(fieldDefs)
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.formId, formId),
            eq(fieldDefs.id, fieldId),
            isNull(fieldDefs.deletedAt),
          ),
        )
        .limit(1),
    )
    const field = rows[0]
    return field !== undefined && ATTACHMENT_FIELD_TYPES.has(field.cellValueType)
      ? field
      : undefined
  }

  /* FMEA S7|已綁記錄之附件隨記錄生滅:記錄 soft-delete 後不得再經 key 下載
     (未綁記錄之 pending 檔不受此限 —— 填單中尚未存檔)。identifier 出自 catalog 生成函式,
     非使用者輸入(鐵則 1);值一律參數綁定。 */
  private async assertRecordReadable(
    tenantId: number,
    formId: number,
    recordId: string | number | null,
  ): Promise<void> {
    if (recordId === null) return
    const table = physicalTableName(formId)
    const found = await this.inTenantTx(tenantId, (trx) =>
      trx
        .withSchema(DATA_SCHEMA)
        .table(table)
        .where({ tenant_id: tenantId, id: num(recordId) })
        .whereNull("deleted_at")
        .first("id"),
    )
    if (found === undefined) {
      throw new NotFoundException({ code: "FILE_NOT_FOUND", message: "檔案不存在" })
    }
  }

  private async requireFile(tenant: TenantContext, key: string): Promise<FileObjectRow> {
    // key 形狀先驗(FMEA S4):不符即當不存在,絕不進 driver
    if (!isValidKey(key)) {
      throw new NotFoundException({ code: "FILE_NOT_FOUND", message: "檔案不存在" })
    }
    const row = await this.inTenantTx(tenant.tenantId, (trx) =>
      trx<FileObjectRow>("file_object")
        .where({ key, tenant_id: tenant.tenantId })
        .whereNull("deleted_at")
        .first(),
    )
    if (row === undefined) {
      throw new NotFoundException({ code: "FILE_NOT_FOUND", message: "檔案不存在" })
    }
    return row
  }
}
