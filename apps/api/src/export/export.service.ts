import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common"
import type { TenantContext } from "../http/tenant-context.js"
import { EXPORT_MAX_DOWNLOADS, EXPORT_MAX_PER_DAY, EXPORT_TTL_DAYS } from "./export-specs.js"
import { type ExportJobRow, ExportRepository } from "./export.repository.js"

/* R1·I-1 M2|匯出的使用者面。 */

export interface ExportJobDto {
  readonly id: number
  readonly status: string
  readonly formIds: number[] | null
  readonly includeAttachments: boolean
  readonly sizeBytes: number | null
  readonly rowCount: number | null
  readonly downloadCount: number
  readonly downloadsLeft: number
  readonly error: string | null
  readonly createdAt: string
  readonly readyAt: string | null
  readonly expiresAt: string | null
}

export const toExportDto = (row: ExportJobRow): ExportJobDto => ({
  id: row.id,
  status: row.status,
  formIds: row.formIds,
  includeAttachments: row.includeAttachments,
  sizeBytes: row.sizeBytes,
  rowCount: row.rowCount,
  downloadCount: row.downloadCount,
  /* 剩幾次由後端算 —— 前端自己減會在多分頁時各算各的 */
  downloadsLeft: Math.max(0, EXPORT_MAX_DOWNLOADS - row.downloadCount),
  error: row.error,
  createdAt: row.createdAt.toISOString(),
  readyAt: row.readyAt === null ? null : row.readyAt.toISOString(),
  expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
})

@Injectable()
export class ExportService {
  constructor(@Inject(ExportRepository) private readonly repo: ExportRepository) {}

  async list(tenant: TenantContext): Promise<{ jobs: ExportJobDto[]; ttlDays: number }> {
    const rows = await this.repo.listForActor(tenant.tenantId, tenant.actorId)
    return { jobs: rows.map(toExportDto), ttlDays: EXPORT_TTL_DAYS }
  }

  async get(tenant: TenantContext, id: number): Promise<ExportJobDto | null> {
    const row = await this.repo.getForActor(tenant.tenantId, tenant.actorId, id)
    return row === null ? null : toExportDto(row)
  }

  /* 🔴 每日上限。**兩家巨人在這件事上並無可抄的數字** ——
     Google 對組織匯出未載任何頻率限制;Salesforce 是每 7 天一次,而我方已判定
     那對遷移期太嚴(客戶會反覆試)。故這是我方自訂的界線,理由寫在這裡:

     「同時只有一個」由 DB 的部分唯一索引保證,但它擋不住**接力**:
     一支腳本在每次跑完後立刻再送一次,就能讓匯出無限地把整個租戶掃一遍又一遍。
     取一個寬鬆到正常使用者不會碰到、但足以讓迴圈停下來的數字。 */
  async create(
    tenant: TenantContext,
    input: { formIds?: number[] | undefined; includeAttachments?: boolean | undefined },
  ): Promise<ExportJobDto> {
    const todayCount = await this.repo.countSince(tenant.tenantId, startOfToday())
    if (todayCount >= EXPORT_MAX_PER_DAY) {
      throw new BadRequestException({
        code: "EXPORT_DAILY_LIMIT",
        message: `今天的匯出次數已達上限(${String(EXPORT_MAX_PER_DAY)} 次),請明天再試`,
      })
    }

    const formIds = input.formIds ?? null
    if (formIds !== null && formIds.length === 0) {
      /* 空陣列與「不指定」在語意上是兩回事:前者是「一張都不要」——
         那不是匯出。讓它明確失敗,而不是靜默變成「全部」。 */
      throw new BadRequestException({
        code: "EXPORT_EMPTY_SCOPE",
        message: "請至少選擇一張表單,或不指定以匯出全部",
      })
    }

    try {
      const row = await this.repo.create({
        tenantId: tenant.tenantId,
        actorId: tenant.actorId,
        formIds,
        includeAttachments: input.includeAttachments === true,
      })
      return toExportDto(row)
    } catch (error) {
      /* 部分唯一索引違反 = 已經有一個在跑。對使用者而言這不是錯誤而是狀態,
         回 409 並說清楚,不要讓他看到資料庫約束名稱。 */
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: "EXPORT_ALREADY_RUNNING",
          message: "已有一個匯出正在進行,請等它完成後再建立新的",
        })
      }
      throw error
    }
  }
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
}
