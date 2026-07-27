import { randomUUID } from "node:crypto"
import type { Readable } from "node:stream"
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { Knex } from "knex"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { APP_KNEX } from "../db/db.module.js"
import { MetadataService } from "../form-engine/metadata/metadata.service.js"
import type { TenantContext } from "../http/tenant-context.js"
import { detectType } from "../storage/file-type.js"
import { STORAGE_DRIVER, type StorageDriver, isValidKey } from "../storage/storage-driver.js"
import { ATTACHMENT_FIELD_TYPES, type FileDto, type FileStatus } from "./file-specs.js"

/* F-5 M2|檔案上傳/下載/刪除。file_object 走 **RLS 車道**(APP_KNEX + set_config,與 records 同級;
   OQ-FS-7)—— 檔案 metadata 是租戶記錄資料而非表單定義。
   授權三層(FMEA S1/S2):RLS 綁租戶(最後防線)→ 表單級動作 → 欄位級可見性;
   **key 不是授權憑證**(OQ-FS-4):下載一律回查本表取得 (form, field) 再驗權限,猜到 key 亦無用。 */

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
export class FilesService {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  maxFileBytes(): number {
    return (this.config.get<number>("STORAGE_MAX_FILE_MB") ?? 20) * 1024 * 1024
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

    const { fields } = await this.metadata.getForm(tenant.tenantId, formId)
    const field = fields.find((f) => f.id === fieldId)
    if (field === undefined || !ATTACHMENT_FIELD_TYPES.has(field.cellValueType)) {
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

    // 生成檔名(docs/22):使用者檔名永不入路徑,只存 metadata
    const key = `t${tenant.tenantId}/f${formId}/${randomUUID()}${detected.ext}`
    await this.storage.put(key, body, { mime: detected.mime })

    await this.inTenantTx(tenant.tenantId, (trx) =>
      trx("file_object").insert({
        key,
        tenant_id: tenant.tenantId,
        form_id: formId,
        field_id: fieldId,
        name: filename.slice(0, 255),
        mime: detected.mime,
        size: body.length,
        status: "pending" satisfies FileStatus,
        created_by: tenant.actorId,
      }),
    )

    return { key, name: filename.slice(0, 255), mime: detected.mime, size: body.length }
  }

  /* 下載:回查 metadata → 表單 view → 欄位非 hidden → 串流(FMEA S1/S2)。 */
  async openForDownload(
    tenant: TenantContext,
    permissions: EffectivePermissions,
    key: string,
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
    const stream = await this.storage.get(key)
    return {
      stream,
      meta: { key: row.key, name: row.name, mime: row.mime, size: num(row.size) },
    }
  }

  /* 刪除 = 表單 edit;soft delete(實體回收由清理 job,P1;承 records soft-delete 語意)。 */
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
