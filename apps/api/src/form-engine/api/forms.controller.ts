import {
  BadRequestException,
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
  Req,
  UseGuards,
} from "@nestjs/common"
import type { FastifyRequest } from "fastify"
import { TenantGuard } from "../../auth/tenant.guard.js"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../../authz/authz-http.js"
import { PermissionGuard } from "../../authz/permission.guard.js"
import type { TenantContext } from "../../http/tenant-context.js"
import { Tenant } from "../../http/tenant.decorator.js"
import { Throttle } from "@nestjs/throttler"
import { ZodValidationPipe } from "../../http/zod-validation.pipe.js"
import { DdlService } from "../ddl/ddl.service.js"
import { type CellValueType, fieldType } from "../field-types/field-type-registry.js"
import { AccessPreviewService } from "../access/access-preview.service.js"
import { OptionService } from "../field-types/option.service.js"
import { ImportService } from "../import/import.service.js"
import { commitImportSchema, importPlanSchema } from "../import/import-specs.js"
import { MAX_IMPORT_ROWS, parseSheet, sheetNames, suggestMapping } from "../import/workbook.js"

/* 5 萬列的 xlsx 壓縮後約 5–10MB;20MB 留餘裕且與既有檔案上傳同量級 */
const IMPORT_MAX_BYTES = 20 * 1024 * 1024
import { LayoutService } from "../layout/layout.service.js"
import { type Layout, layoutSchema } from "../layout/layout-specs.js"
import { MetadataService } from "../metadata/metadata.service.js"
import {
  addFieldSpecSchema,
  createFormSpecSchema,
  type AddFieldSpec,
  type CreateFormSpec,
} from "../specs/form-specs.js"
import {
  alterFieldTypeBodySchema,
  convertFieldTypeBodySchema,
  updateOptionsBodySchema,
  moveFieldBodySchema,
  toFieldDto,
  toFormDto,
  type FieldDto,
  type FormDto,
} from "./api-schemas.js"
import type { z } from "zod"

/* 薄 controller(AGENTS 分層鐵則):只做 HTTP 形狀 ↔ service 呼叫,零業務邏輯 */
@Controller("api/forms")
@UseGuards(TenantGuard, PermissionGuard)
export class FormsController {
  constructor(
    @Inject(DdlService) private readonly ddl: DdlService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(LayoutService) private readonly layout: LayoutService,
    @Inject(OptionService) private readonly options: OptionService,
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(AccessPreviewService) private readonly preview: AccessPreviewService,
  ) {}

  @Post()
  /* F-6 M2:建表為 DDL 類端點,較全域 300/min 更嚴(C5 DDL DoS)。

     **2026-07-28 由 20 調為 120/min**|原值誤傷真實情境(FMEA L6 成真):
     Weyver 的 R1 前提是**從 Ragic 遷移客戶**,遷移一個工作區會一次建數十至上百張表 ——
     20/min 會直接擋死主要使用情境(e2e 全套亦於一分鐘內撞上限而失敗)。
     **真正的總量防線是 per-tenant 配額**(`tenants.max_forms`,預設 500);
     本限流只擋「瞬間 DDL 風暴」,不該兼任總量控制。 */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @RequiresFormAction("design") // 建表 = 設計動作;無 formId → 需租戶管理權(admin)
  async createForm(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createFormSpecSchema)) spec: CreateFormSpec,
  ): Promise<FormDto> {
    return toFormDto(await this.ddl.createForm(tenant.tenantId, spec, tenant.actorId))
  }

  @Get()
  async listForms(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
  ): Promise<
    Array<
      Omit<FormDto, "fields"> & {
        locked: boolean
        categoryId: number | null
        updatedAt: string
      }
    >
  > {
    const forms = await this.metadata.listForms(tenant.tenantId)
    // OQ-ARI-8:可讀 → 完整;非敏感無權 → 鎖定 stub(顯示,不含資料);敏感無權 → 隱藏(不回)
    const { readable, locked } = permissions.listableForms(forms.map((f) => f.id))
    const readableSet = new Set(readable)
    const lockedSet = new Set(locked)
    return forms
      .filter((form) => readableSet.has(form.id) || lockedSet.has(form.id))
      .map((form) => ({
        id: form.id,
        name: form.name,
        provisionState: form.provisionState,
        version: form.version,
        parentFormId: form.parentFormId,
        // R1·UP-1:工作區目錄用(所屬分類 + 最近更新)
        categoryId: form.categoryId,
        updatedAt: form.updatedAt.toISOString(),
        locked: lockedSet.has(form.id),
      }))
  }

  @Get(":formId")
  async getForm(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<FormDto> {
    return toFormDto(await this.metadata.getForm(tenant.tenantId, formId))
  }

  /* R1·UP-3 2D 設計器版面。GET=view;PUT=design(整表覆寫,純 metadata) */
  @Get(":formId/layout")
  async getLayout(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<{ layout: unknown; version: number }> {
    /* version 與 layout 同源同次讀出 —— 樂觀鎖若從別的查詢拿版本,
       兩者可能不同步,鎖就變成隨機通過/隨機失敗。 */
    const form = await this.metadata.getForm(tenant.tenantId, formId)
    return {
      layout: await this.layout.getLayout(tenant.tenantId, formId),
      version: form.form.version,
    }
  }

  @Patch(":formId/layout")
  @RequiresFormAction("design")
  async putLayout(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(layoutSchema)) layout: Layout,
  ): Promise<Layout> {
    return this.layout.setLayout(tenant.tenantId, formId, layout)
  }

  @Delete(":formId")
  @HttpCode(204)
  @RequiresFormAction("design")
  async dropForm(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<void> {
    await this.ddl.dropForm(tenant.tenantId, formId)
  }

  @Post(":formId/fields")
  // 加欄同理放寬:一張遷移過來的表可能有數十欄,且常連續建立多張表
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @RequiresFormAction("design")
  async addField(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(addFieldSpecSchema)) spec: AddFieldSpec,
  ): Promise<FieldDto> {
    return toFieldDto(await this.ddl.addField(tenant.tenantId, formId, spec))
  }

  @Patch(":formId/fields/:fieldId/type")
  @HttpCode(204)
  @RequiresFormAction("design")
  async alterFieldType(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(alterFieldTypeBodySchema))
    body: z.infer<typeof alterFieldTypeBodySchema>,
  ): Promise<void> {
    await this.ddl.alterFieldType(tenant.tenantId, formId, fieldId, body.type, body.options)
  }

  /* 🔴 E-1 存取預覽(#96)。Salesforce 外洩案例的根因是「規則對了但管理員理解錯」,
     而該產品無法在設定當下看見效果。唯讀試算,不做 impersonation。 */
  /* 可預覽的人員清單 —— 租戶內全部有角色的人,不限某個角色的成員 */
  @Get("access-preview/actors")
  @RequiresFormAction("design")
  previewActors(@Tenant() tenant: TenantContext): Promise<number[]> {
    return this.preview.listActors(tenant.tenantId)
  }

  @Get(":formId/access-preview/:actorId")
  @RequiresFormAction("design")
  previewAccess(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("actorId", ParseIntPipe) actorId: number,
  ): Promise<unknown> {
    return this.preview.preview(tenant.tenantId, formId, actorId)
  }

  /* 🔴 型別轉換(#105 四態)。preview 是唯讀 dry-run,**回兩個數字**
     (會被清空 / 值會被改變)+ 樣本值 —— 合併成一個 N 會把最危險的那類藏起來。 */
  @Post(":formId/fields/:fieldId/convert/preview")
  @RequiresFormAction("design")
  async previewConvert(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(convertFieldTypeBodySchema))
    body: z.infer<typeof convertFieldTypeBodySchema>,
  ): Promise<unknown> {
    return this.ddl.previewFieldTypeChange(tenant.tenantId, formId, fieldId, body.type, body)
  }

  @Post(":formId/fields/:fieldId/convert")
  @RequiresFormAction("design")
  async convertField(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(convertFieldTypeBodySchema))
    body: z.infer<typeof convertFieldTypeBodySchema>,
  ): Promise<unknown> {
    return this.ddl.convertFieldType(tenant.tenantId, formId, fieldId, body.type, body)
  }

  /* 還原一次 lossy 轉換 —— Ragic 的型別轉換是非破壞性的,這是補回那個體驗 */
  @Post(":formId/fields/:fieldId/convert/:conversionId/revert")
  @RequiresFormAction("design")
  async revertConvert(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Param("conversionId", ParseIntPipe) conversionId: number,
  ): Promise<unknown> {
    return this.ddl.revertFieldConversion(tenant.tenantId, formId, fieldId, conversionId)
  }

  /* 選項增刪改名(#105):與 /type 分開,因為這條會改寫既有記錄的資料 */
  @Get(":formId/fields/:fieldId/options/usage")
  @RequiresFormAction("design")
  async optionUsage(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
  ): Promise<Record<string, number>> {
    return this.options.usageCounts(tenant.tenantId, formId, fieldId)
  }

  @Patch(":formId/fields/:fieldId/options")
  @RequiresFormAction("design")
  async updateOptions(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(updateOptionsBodySchema))
    body: z.infer<typeof updateOptionsBodySchema>,
  ): Promise<{ renamed: number; affectedRows: number }> {
    return this.options.updateOptions(
      tenant.tenantId,
      formId,
      fieldId,
      body.choices,
      body.deleteMode,
      body.replaceWith,
    )
  }

  /* 🔴 解析在後端(OQ-IMP-6,推翻既有的前端解析裁定)。
     前端只上傳 + 顯示預覽與對映 —— Airtable 的 25,000 列上限正是前端解析的代價。
     沿用檔案上傳端點的限流理由:此路徑同樣把整檔讀進記憶體。 */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(":formId/import/analyze")
  @RequiresFormAction("create")
  async analyzeImport(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Query("sheet") sheet: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<unknown> {
    const multipart = request as unknown as {
      isMultipart: () => boolean
      file: (opts?: { limits?: { fileSize?: number } }) => Promise<
        { filename: string; file: { truncated: boolean }; toBuffer: () => Promise<Buffer> } | undefined
      >
    }
    if (!multipart.isMultipart()) {
      throw new BadRequestException({ code: "NOT_MULTIPART", message: "需以 multipart 上傳" })
    }
    const part = await multipart.file({ limits: { fileSize: IMPORT_MAX_BYTES } })
    if (part === undefined) {
      throw new BadRequestException({ code: "NO_FILE", message: "未附檔案" })
    }
    const buffer = await part.toBuffer()
    // multipart 超限時是**截斷**而非拋錯 → 不明示拒絕就會解析出半截資料
    if (part.file.truncated) {
      throw new BadRequestException({
        code: "FILE_TOO_LARGE",
        message: `檔案超過上限 ${String(IMPORT_MAX_BYTES / 1024 / 1024)} MB`,
      })
    }

    const form = await this.metadata.getForm(tenant.tenantId, formId)
    const parsed = parseSheet(buffer, sheet)
    const writable = form.fields
      .filter((f) => !fieldType(f.cellValueType as CellValueType).systemManaged)
      .map((f) => f.name)
    return {
      sheetNames: sheetNames(buffer),
      sheetName: parsed.sheetName,
      headerRowIndex: parsed.headerRowIndex,
      columns: parsed.columns,
      totalRows: parsed.totalRows,
      truncated: parsed.truncated,
      maxRows: MAX_IMPORT_ROWS,
      preview: parsed.rows.slice(0, 20),
      rows: parsed.rows,
      suggestedMapping: suggestMapping(parsed.columns, writable),
      fields: writable,
    }
  }

  /* 匯入既有表單(#106)。plan 是 dry-run 不寫任何資料;commit 必須帶回 planHash */
  @Post(":formId/import/plan")
  @RequiresFormAction("create")
  async planImport(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(importPlanSchema)) body: z.infer<typeof importPlanSchema>,
  ): Promise<unknown> {
    return this.imports.plan(tenant.tenantId, formId, body)
  }

  @Post(":formId/import/commit")
  @RequiresFormAction("create")
  async commitImport(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(commitImportSchema)) body: z.infer<typeof commitImportSchema>,
  ): Promise<unknown> {
    return this.imports.commit(tenant.tenantId, formId, tenant.actorId, body.planHash, body.plan)
  }

  /* 撤銷 = 補償批次,不刪歷史。需 delete 權(可能會軟刪除本批新增的記錄)*/
  @Post(":formId/import/:batchId/revert")
  @RequiresFormAction("delete")
  async revertImport(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("batchId", ParseIntPipe) batchId: number,
  ): Promise<unknown> {
    return this.imports.revert(tenant.tenantId, formId, tenant.actorId, batchId)
  }

  @Patch(":formId/fields/:fieldId/position")
  @HttpCode(204)
  @RequiresFormAction("design")
  async moveField(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(moveFieldBodySchema))
    body: z.infer<typeof moveFieldBodySchema>,
  ): Promise<void> {
    await this.ddl.moveField(tenant.tenantId, formId, fieldId, body.direction)
  }

  @Delete(":formId/fields/:fieldId")
  @HttpCode(204)
  @RequiresFormAction("design")
  async dropField(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
  ): Promise<void> {
    await this.ddl.dropField(tenant.tenantId, formId, fieldId)
  }
}
