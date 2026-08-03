import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../../auth/tenant.guard.js"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../../authz/authz-http.js"
import { PermissionGuard } from "../../authz/permission.guard.js"
import type { TenantContext } from "../../http/tenant-context.js"
import { Tenant } from "../../http/tenant.decorator.js"
import { ZodValidationPipe } from "../../http/zod-validation.pipe.js"
import { calendarQuerySchema, listQuerySchema, pivotQuerySchema } from "../records/record-specs.js"
import type { RecordRow } from "../records/record-specs.js"
import { RecordService } from "../records/record.service.js"
import {
  type ReverseRelationGroup,
  ReverseRelationService,
} from "../relations/reverse-relation.service.js"
import {
  bulkRecordsBodySchema,
  bulkUpdateRecordsBodySchema,
  createRecordBodySchema,
  groupStatsBodySchema,
  saveWithLinesBodySchema,
  updateRecordBodySchema,
} from "./api-schemas.js"

const simpleListQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

interface ListResponse {
  readonly records: readonly RecordRow[]
  /* 不透明續頁權杖(#95)—— 呼叫端原樣傳回即可,不得自行解讀 */
  readonly nextCursor: string | null
}

/* 薄 controller:記錄 CRUD + 複合查詢 + 子表單據;values 形狀由 RecordService 依 metadata 驗證 */
@Controller("api/forms/:formId/records")
@UseGuards(TenantGuard, PermissionGuard)
export class RecordsController {
  constructor(
    @Inject(RecordService) private readonly records: RecordService,
    @Inject(ReverseRelationService) private readonly reverseRelations: ReverseRelationService,
  ) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Query(new ZodValidationPipe(simpleListQuerySchema))
    query: z.infer<typeof simpleListQuerySchema>,
  ): Promise<ListResponse> {
    return this.records.listRecords(
      tenant.tenantId,
      formId,
      listQuerySchema.parse({ cursor: query.cursor, limit: query.limit }),
      permissions,
      tenant.actorId,
    )
  }

  @Post("query")
  @HttpCode(200)
  @RequiresFormAction("view") // POST 但語意為讀(搜尋),故要求 view 而非 create
  async query(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(listQuerySchema)) body: z.infer<typeof listQuerySchema>,
  ): Promise<ListResponse> {
    return this.records.listRecords(tenant.tenantId, formId, body, permissions, tenant.actorId)
  }

  /* 🔴 F-1 分組統計。**與列表同一 RLS role / 同一交易** —— 若改用特權連線算 count,
     使用者只看得到 3 筆卻會看到「共 47 筆」,等於洩漏無權存取之資料的存在與數量。 */
  @Post("group-stats")
  @HttpCode(200)
  @RequiresFormAction("view")
  async groupStats(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(groupStatsBodySchema))
    body: z.infer<typeof groupStatsBodySchema>,
  ): Promise<unknown> {
    return this.records.groupStats(
      tenant.tenantId,
      formId,
      listQuerySchema.parse(body.query),
      body.aggregates,
      permissions,
      tenant.actorId,
    )
  }

  /* 🔴 F-1 行事曆:區間重疊查詢(非 group-by —— 一筆可佔多格)。
     半開區間 [from, to),to 排他,對齊 RFC 5545 / Google Calendar。 */
  /* 🔴 F-2 樞紐分析。回**長表**(業界無一家回動態寬表;PG result set 1,664 欄為硬天花板)。
     欄標頭只從本查詢導出,不從選項定義/metadata/快取取值(CVE-2024-55951 的形狀)。 */
  @Post("pivot")
  @HttpCode(200)
  @RequiresFormAction("view")
  async pivot(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(pivotQuerySchema)) body: z.infer<typeof pivotQuerySchema>,
  ): Promise<unknown> {
    return this.records.pivot(tenant.tenantId, formId, body, permissions, tenant.actorId)
  }

  @Post("calendar")
  @HttpCode(200)
  @RequiresFormAction("view")
  async calendar(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(calendarQuerySchema))
    body: z.infer<typeof calendarQuerySchema>,
  ): Promise<unknown> {
    return this.records.calendarRange(tenant.tenantId, formId, body, permissions, tenant.actorId)
  }

  @Post()
  async create(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(createRecordBodySchema))
    body: z.infer<typeof createRecordBodySchema>,
  ): Promise<RecordRow> {
    return this.records.createRecord(
      tenant.tenantId,
      formId,
      body.values,
      tenant.actorId,
      permissions,
    )
  }

  /* bulk 匯入(Excel onboarding;單一 tx,任一列敗整批 rollback)*/
  @Post("bulk")
  @HttpCode(200)
  async bulk(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(bulkRecordsBodySchema))
    body: z.infer<typeof bulkRecordsBodySchema>,
  ): Promise<{ created: number }> {
    return this.records.createManyRecords(
      tenant.tenantId,
      formId,
      body.rows.map((r) => r.values),
      tenant.actorId,
      permissions,
    )
  }

  /* 🔴 grid-paste M1|批次**更新**(網格貼上到既有列)。
     單一 tx 全成或全敗;計算欄跳過並回報格數,由前端說給使用者聽。
     冪等由既有 `IdempotencyInterceptor` 以 header 處理(OQ-GP-9)——
     貼上天生會被重試,而對 ERP 來說重試一次就是多寫 200 筆。 */
  @Post("bulk-update")
  @HttpCode(200)
  @RequiresFormAction("edit")
  async bulkUpdate(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(bulkUpdateRecordsBodySchema))
    body: z.infer<typeof bulkUpdateRecordsBodySchema>,
  ): Promise<{ updated: number; skippedComputedCells: number }> {
    return this.records.updateManyRecords(
      tenant.tenantId,
      formId,
      body.rows,
      tenant.actorId,
      permissions,
    )
  }

  @Get(":recordId")
  async get(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<RecordRow> {
    return this.records.getRecord(tenant.tenantId, formId, recordId, permissions, tenant.actorId)
  }

  /* R1·workbench-uplift A3|反向關聯:本筆被哪些記錄引用(唯讀導航用) */
  @Get(":recordId/relations")
  async relations(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<ReverseRelationGroup[]> {
    return this.reverseRelations.listReferencing(tenant.tenantId, formId, recordId, permissions)
  }

  @Patch(":recordId")
  async update(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
    @Body(new ZodValidationPipe(updateRecordBodySchema))
    body: z.infer<typeof updateRecordBodySchema>,
  ): Promise<RecordRow> {
    return this.records.updateRecord(
      tenant.tenantId,
      formId,
      recordId,
      body.expectedVersion,
      body.values,
      tenant.actorId,
      permissions,
    )
  }

  @Delete(":recordId")
  @HttpCode(204)
  async remove(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<void> {
    await this.records.softDeleteRecord(
      tenant.tenantId,
      formId,
      recordId,
      tenant.actorId,
      permissions,
    )
  }

  /* 子表單據(header + lines 單一交易,A5) */
  @Post("save-with-lines")
  @HttpCode(200)
  @RequiresFormAction("edit") // 文件存檔(header+lines diff)語意為編輯,非單純 create
  async saveWithLines(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(saveWithLinesBodySchema))
    body: z.infer<typeof saveWithLinesBodySchema>,
  ): Promise<{ header: RecordRow; lines: RecordRow[] }> {
    return this.records.saveWithLines(
      tenant.tenantId,
      formId,
      body.childFormId,
      body.header,
      body.lines,
      tenant.actorId,
      permissions,
    )
  }
}
