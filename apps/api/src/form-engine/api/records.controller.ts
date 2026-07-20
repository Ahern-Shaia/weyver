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
import { RequiresFormLevel } from "../../authz/authz-http.js"
import { PermissionGuard } from "../../authz/permission.guard.js"
import type { TenantContext } from "../../http/tenant-context.js"
import { Tenant } from "../../http/tenant.decorator.js"
import { ZodValidationPipe } from "../../http/zod-validation.pipe.js"
import { RecordService } from "../records/record.service.js"
import { listQuerySchema } from "../records/record-specs.js"
import type { RecordRow } from "../records/record-specs.js"
import {
  bulkRecordsBodySchema,
  createRecordBodySchema,
  saveWithLinesBodySchema,
  updateRecordBodySchema,
} from "./api-schemas.js"

const simpleListQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

interface ListResponse {
  readonly records: readonly RecordRow[]
  readonly nextCursor: number | null
}

/* 薄 controller:記錄 CRUD + 複合查詢 + 子表單據;values 形狀由 RecordService 依 metadata 驗證 */
@Controller("api/forms/:formId/records")
@UseGuards(TenantGuard, PermissionGuard)
export class RecordsController {
  constructor(@Inject(RecordService) private readonly records: RecordService) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Query(new ZodValidationPipe(simpleListQuerySchema))
    query: z.infer<typeof simpleListQuerySchema>,
  ): Promise<ListResponse> {
    return this.records.listRecords(
      tenant.tenantId,
      formId,
      listQuerySchema.parse({ cursor: query.cursor, limit: query.limit }),
    )
  }

  @Post("query")
  @HttpCode(200)
  @RequiresFormLevel("read") // POST 但語意為讀(搜尋),故要求 read 而非 write
  async query(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(listQuerySchema)) body: z.infer<typeof listQuerySchema>,
  ): Promise<ListResponse> {
    return this.records.listRecords(tenant.tenantId, formId, body)
  }

  @Post()
  async create(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(createRecordBodySchema))
    body: z.infer<typeof createRecordBodySchema>,
  ): Promise<RecordRow> {
    return this.records.createRecord(tenant.tenantId, formId, body.values, tenant.actorId)
  }

  /* bulk 匯入(Excel onboarding;單一 tx,任一列敗整批 rollback)*/
  @Post("bulk")
  @HttpCode(200)
  async bulk(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(bulkRecordsBodySchema))
    body: z.infer<typeof bulkRecordsBodySchema>,
  ): Promise<{ created: number }> {
    return this.records.createManyRecords(
      tenant.tenantId,
      formId,
      body.rows.map((r) => r.values),
      tenant.actorId,
    )
  }

  @Get(":recordId")
  async get(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<RecordRow> {
    return this.records.getRecord(tenant.tenantId, formId, recordId)
  }

  @Patch(":recordId")
  async update(
    @Tenant() tenant: TenantContext,
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
    )
  }

  @Delete(":recordId")
  @HttpCode(204)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<void> {
    await this.records.softDeleteRecord(tenant.tenantId, formId, recordId, tenant.actorId)
  }

  /* 子表單據(header + lines 單一交易,A5) */
  @Post("save-with-lines")
  @HttpCode(200)
  async saveWithLines(
    @Tenant() tenant: TenantContext,
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
    )
  }
}
