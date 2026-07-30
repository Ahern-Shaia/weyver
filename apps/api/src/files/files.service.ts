import { createHash, randomUUID } from "node:crypto"
import type { Readable } from "node:stream"
import {
  BadRequestException,
  ConflictException,
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
import { inspectContent } from "../storage/content-inspect.js"
import { ScanService } from "../storage/scan.service.js"
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
  readonly scan_status: ScanStatus
  readonly scan_detail: string | null
}

/* 上傳當下的初始掃描狀態。

   - 掃毒未啟用(過渡期)→ 一律 `skipped`,否則所有 PDF / Office 附件立刻下不了
   - 影像 → `skipped`:已被 sharp 完整解碼重編碼(位元組非原始輸入),
     加上 M1 的 polyglot 檢查已擋掉尾部附加資料。研究說「只掃高風險型別可降
     ~80% 掃描量」,這就是那個 80%
   - 其餘 → `pending`,掃完才可下載 */
function scanStatusOnUpload(
  mime: string,
  inspected: { opaque?: boolean },
  scanEnabled: boolean,
): ScanStatus {
  if (!scanEnabled) return "skipped"
  if (mime.startsWith("image/") && inspected.opaque !== true) return "skipped"
  return "pending"
}

/* F-11|掃描狀態。**只有 clean 可被取用** —— 其餘一律 deny(含 pending 與 error)。
   AWS 的兩套實作(CDK construct 的 bucket policy、GuardDuty 的 tag)都是這個形狀:
   預設拒絕、掃乾淨才放行,且明確承認「第三態」(error / unsupported)存在。 */
export type ScanStatus = "pending" | "clean" | "infected" | "error" | "skipped"

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
    @Inject(ScanService) private readonly scan: ScanService,
  ) {}

  /* 🔴 F-11 M5|混合下載。授權**每次**由 API 重新求值(權限 + 欄位 + 記錄 + 掃描狀態),
     通過後才簽一個 30–60 秒的 URL 讓位元組直接從物件儲存走。

     解的是出口頻寬:代理下載的瓶頸不是事件迴圈(`StreamableFile` 是串流)
     而是 Cloud Run 每實例並發 80 × 20MB 就塞滿。

     驅動不支援(本機檔案系統)時回 null,呼叫端自然回退到代理 —— 能力差異不是錯誤。 */
  async presignedUrlFor(
    tenant: TenantContext,
    permissions: EffectivePermissions,
    key: string,
  ): Promise<string | null> {
    if (this.storage.presign === undefined) return null
    /* 走與代理下載**完全相同**的判定鏈 —— 不能因為換了傳輸方式就少驗一道 */
    const row = await this.requireReadableFile(tenant, key)
    const formId = num(row.form_id)
    const fieldId = num(row.field_id)
    if (!permissions.hasAction(formId, "view")) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "無此表單檢視權限" })
    }
    if (permissions.fieldVisibility(fieldId, formId) === "hidden") {
      throw new ForbiddenException({ code: "FIELD_FORBIDDEN", message: "無此欄位檢視權限" })
    }
    await this.assertRecordReadable(tenant.tenantId, formId, row.record_id)
    return this.storage.presign(key, {
      ttlSeconds: 60,
      filename: row.name,
      /* 保守型別 + attachment:即使位元組不經我們,header 仍受控 ——
         否則 polyglot / SVG 會以物件儲存宣告的型別被瀏覽器直接開啟 */
      mime: "application/octet-stream",
    })
  }

  private get scanEnabled(): boolean {
    return this.config.get<string>("MALWARE_SCAN_MODE") === "required"
  }

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
    /* 🔴 F-11 M1|內容層檢查。magic bytes 只證明「開頭像某種格式」,
       證明不了內容安全:`.docm` 改名 `.docx` 的 magic bytes 一樣是 PK、
       PDF 可以夾 `/JavaScript`、PNG 尾巴可以附一整個 ZIP(polyglot)。
       這三類都是**純資料型攻擊** —— 研究明言 ClamAV 擋不住,而這裡幾十行就擋掉。 */
    const inspected = inspectContent(body, detected.mime)
    if (!inspected.ok) {
      throw new UnsupportedMediaTypeException({
        code: "UNSAFE_FILE_CONTENT",
        message: inspected.reason ?? "檔案內容不被接受",
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

    /* 🔴 兩段式掃描的第一段:上傳當下先同步掃(4 秒逾時)。
       逾時 / clamd 不可用 → 回 null → 留 pending 交補掃 cron。
       **接受端 fail-open**(上傳仍成功),供應端才 fail-closed(下載閘擋)。 */
    let initialScan = scanStatusOnUpload(detected.mime, inspected, this.scanEnabled)
    let scanDetail: string | null = null
    if (initialScan === "pending") {
      const verdict = await this.scan.scanInline(processed.body)
      if (verdict?.status === "clean") initialScan = "clean"
      else if (verdict?.status === "infected") {
        initialScan = "infected"
        scanDetail = verdict.signature
      }
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
        /* 🔴 F-11|新上傳一律從 `pending` 起算 —— 在掃完之前下不了。

           唯一例外是**確定掃不出東西的型別**:影像已被 sharp 完整解碼重編碼
           (image-processing),位元組已非原始輸入;加上 M1 的 polyglot 檢查
           已擋掉尾部附加資料 → 標 `skipped` 而非 `pending`。
           研究建議「只掃高風險型別可降 ~80% 掃描量」,這就是那個 80%。

           `opaque` 的 PDF(物件流 / 加密)反而**更需要**掃 —— 原始位元組
           掃描看不進去,那正是 ClamAV 的守備範圍(doc §1.4)。 */
        scan_status: initialScan,
        scan_detail: scanDetail,
        scanned_at: initialScan === "pending" ? null : new Date(),
        sha256: createHash("sha256").update(processed.body).digest("hex"),
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
    const row = await this.requireReadableFile(tenant, key)
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

  /* 🔴 取用檔案內容的**唯一**入口。與 `requireFile` 分開命名,是為了讓
     「要拿內容」與「只要 metadata」在呼叫端就看得出差別 ——
     刪除感染檔是合理的(走 `requireFile`),下載它不是。 */
  private async requireReadableFile(
    tenant: TenantContext,
    key: string,
  ): Promise<FileObjectRow> {
    const row = await this.requireFile(tenant, key)
    this.assertScanned(row)
    return row
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

  /* 🔴 下載閘。**deny-by-default** —— 只有 `clean` 與 `skipped` 放行。

     `skipped` 是掃毒上線**之前**就存在的舊檔:回填時刻意不標成 `clean`
     (我們沒掃過,不該宣稱乾淨),但也不能一夕之間讓所有既有附件變成不可下載。
     這是一次性的相容窗口,新上傳一律從 `pending` 起算。

     `pending` 也擋:上傳完成到掃描完成之間若可下載,掃毒等於沒有意義。
     `error` 也擋:供應端 fail-closed(接受端才 fail-open)——
     「掃不出結果」不等於「安全」。

     ⚠️ 此方法必須是**唯一**的取用判斷點。若日後新增取用路徑(presigned 簽發、
     匯出打包、webhook 附載)未經過它,整條閘門就不存在(FMEA M1)。 */
  private assertScanned(row: FileObjectRow): void {
    if (row.scan_status === "clean" || row.scan_status === "skipped") return
    if (row.scan_status === "infected") {
      throw new ForbiddenException({
        code: "FILE_INFECTED",
        message: "這個檔案被判定為惡意檔案,無法下載",
      })
    }
    /* pending / error 一律回同一種訊息:不告訴對方「掃描失敗」還是「還在掃」,
       那是關於我們掃描能力的資訊。 */
    throw new ConflictException({
      code: "FILE_SCAN_PENDING",
      message: "檔案安全檢查尚未完成,請稍後再試",
    })
  }
}
