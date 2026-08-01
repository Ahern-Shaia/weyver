import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Inject, Injectable, Logger } from "@nestjs/common"
import { PermissionService } from "../authz/permission.service.js"
import { MetadataService } from "../form-engine/metadata/metadata.service.js"
import { RecordService } from "../form-engine/records/record.service.js"
import { STORAGE_DRIVER, type StorageDriver } from "../storage/storage-driver.js"
import { type ExportFormSpec, buildArchive } from "./export-archive.js"
import { EXPORT_MAX_UNCOMPRESSED_BYTES, EXPORT_PAGE_SIZE, EXPORT_TTL_DAYS } from "./export-specs.js"
import { type ExportJobRow, ExportRepository } from "./export.repository.js"

/* R1·I-1 M1|把一個 export_job 跑完。

   ## 🔴 授權在這裡就接上,不留到 M2

   匯出天生是「一次全拿」,設計文件 §7 已把它列為欄位級權限的第 17 條旁路
   (#100 才修完 16 條)。若先做一版「讀得到全部」的 runner 再說,那個版本
   會存在於 git 歷史裡、也可能被別人先接上端點。`EffectivePermissions` 結構相容
   `FieldAccessPolicy`,接上的成本只有兩行,沒有理由延後。

   範圍解析同理:**逐表過 `export` 動作權**,不因發起人是 admin 就跳過 —— admin
   本來就會通過,但走同一條路才不會在日後改權限模型時漏掉這一支。 */
@Injectable()
export class ExportRunnerService {
  private readonly logger = new Logger(ExportRunnerService.name)

  constructor(
    @Inject(ExportRepository) private readonly repo: ExportRepository,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(RecordService) private readonly records: RecordService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  async run(job: ExportJobRow): Promise<void> {
    const policy = await this.permissions.resolveForActor(job.tenantId, job.requestedByActorId)

    const all = await this.metadata.listForms(job.tenantId)
    const wanted = job.formIds === null ? null : new Set(job.formIds)
    const forms: ExportFormSpec[] = []
    for (const form of all) {
      if (wanted !== null && !wanted.has(form.id)) continue
      /* 🔴 逐表過 export 權。沒有權的表**整張不出現** —— 不是出一個空檔案,
         那會洩漏「這張表存在」以及它的欄位名。 */
      if (!policy.hasAction(form.id, "export")) continue
      const detail = await this.metadata.getForm(job.tenantId, form.id)
      const readable = detail.fields.filter(
        (f) => policy.fieldVisibility(f.id, form.id) !== "hidden",
      )
      forms.push({
        formId: form.id,
        name: form.name,
        columns: readable.map((f) => f.name),
        fields: readable.map((f) => ({
          name: f.name,
          type: f.cellValueType,
          options: f.options,
        })),
      })
    }

    const archive = await buildArchive({
      tenantName: String(job.tenantId),
      forms,
      source: {
        readPage: async (formId, cursor) => {
          const page = await this.records.listRecords(
            job.tenantId,
            formId,
            {
              filters: [],
              sort: [],
              limit: EXPORT_PAGE_SIZE,
              ...(cursor === null ? {} : { cursor }),
            },
            policy,
            job.requestedByActorId,
          )
          return {
            rows: page.records as unknown as Record<string, unknown>[],
            nextCursor: page.nextCursor,
          }
        },
      },
      maxBytes: EXPORT_MAX_UNCOMPRESSED_BYTES,
      generatedAt: new Date(),
    })

    try {
      const key = objectKeyFor(job)
      /* ⚠️ `StorageDriver.put()` 只收 Buffer → 這一刻整個 zip 在記憶體裡。
         產生過程是串流的,只有上傳這一步不是;以 EXPORT_MAX_UNCOMPRESSED_BYTES 兜住。
         真正的解是給 driver 加 putStream(殘留)。 */
      await this.storage.put(key, await readFile(archive.path), { mime: "application/zip" })
      const expiresAt = new Date(Date.now() + EXPORT_TTL_DAYS * 86_400_000)
      await this.repo.markReady(job.id, {
        objectKey: key,
        sizeBytes: archive.sizeBytes,
        rowCount: archive.rowCount,
        expiresAt,
      })
      this.logger.log(`匯出 #${String(job.id)} 完成:${String(archive.rowCount)} 筆`)
    } finally {
      await archive.cleanup()
    }
  }
}

/* 🔴 key 不含表單名或任何使用者輸入 —— 物件名會出現在存取日誌與簽名 URL 裡。
   且用 **uuid 不用 job id**:流水號會讓「猜下一包公司資料」變成加一。
   形狀須通過 `assertValidKey`(storage-driver.ts 的白名單)。 */
function objectKeyFor(job: ExportJobRow): string {
  return `t${String(job.tenantId)}/exports/${randomUUID()}.zip`
}
