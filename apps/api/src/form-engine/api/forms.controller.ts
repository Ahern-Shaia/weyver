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
import { Throttle } from "@nestjs/throttler"
import type { FastifyRequest } from "fastify"
import { TenantGuard } from "../../auth/tenant.guard.js"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../../authz/authz-http.js"
import { PermissionGuard } from "../../authz/permission.guard.js"
import type { TenantContext } from "../../http/tenant-context.js"
import { Tenant } from "../../http/tenant.decorator.js"
import { ZodValidationPipe } from "../../http/zod-validation.pipe.js"
import { AccessPreviewService } from "../access/access-preview.service.js"
import { DdlService } from "../ddl/ddl.service.js"
import { type CellValueType, fieldType } from "../field-types/field-type-registry.js"
import { OptionService } from "../field-types/option.service.js"
import { commitImportSchema, importPlanSchema } from "../import/import-specs.js"
import { ImportService } from "../import/import.service.js"
import { MAX_IMPORT_ROWS, parseSheet, sheetNames, suggestMapping } from "../import/workbook.js"
import { RelookupService } from "../relations/relookup.service.js"

/* 5 萬列的 xlsx 壓縮後約 5–10MB;20MB 留餘裕且與既有檔案上傳同量級 */
const IMPORT_MAX_BYTES = 20 * 1024 * 1024
import { z } from "zod"
import { type Layout, layoutSchema } from "../layout/layout-specs.js"
import { LayoutService } from "../layout/layout.service.js"
import { FieldNotFoundError } from "../errors.js"
import { type BatchUndoSkip, RecordService } from "../records/record.service.js"
import { LinkOptionsService } from "../relations/link-options.service.js"
import { MetadataService } from "../metadata/metadata.service.js"
import {
  type AddFieldSpec,
  type CreateFormSpec,
  addFieldSpecSchema,
  createFormSpecSchema,
} from "../specs/form-specs.js"
import {
  type FieldDto,
  type FormDto,
  alterFieldTypeBodySchema,
  convertFieldTypeBodySchema,
  moveFieldBodySchema,
  toFieldDto,
  toFormDto,
  updateDisplayBodySchema,
  updateLoadMapBodySchema,
  updateOptionsBodySchema,
} from "./api-schemas.js"

/* 薄 controller(AGENTS 分層鐵則):只做 HTTP 形狀 ↔ service 呼叫,零業務邏輯 */
@Controller("api/forms")
@UseGuards(TenantGuard, PermissionGuard)
export class FormsController {
  constructor(
    @Inject(DdlService) private readonly ddl: DdlService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(LinkOptionsService) private readonly linkOptionsService: LinkOptionsService,
    @Inject(LayoutService) private readonly layout: LayoutService,
    @Inject(OptionService) private readonly options: OptionService,
    @Inject(RelookupService) private readonly relookup: RelookupService,
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(AccessPreviewService) private readonly preview: AccessPreviewService,
    /* R1·H-4|全庫修改紀錄 */
    @Inject(RecordService) private readonly records: RecordService,
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
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<FormDto> {
    /* 🔴 過欄位級權限:值有 maskRead 擋著,但**欄位名稱**原本照回。
       名稱本身就是業務資訊,而下游(圖表軸 / 篩選面板 / 看板分欄)都在列它們。 */
    return toFormDto(await this.metadata.getForm(tenant.tenantId, formId), permissions)
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
    await this.ddl.dropForm(tenant.tenantId, formId, tenant.actorId)
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
  /* 租戶人員清單:預覽器與 member 欄選人器共用。
     權限為 view —— 填單者要指派負責人,不該需要 design 權。 */
  @Get("access-preview/actors")
  @RequiresFormAction("view")
  previewActors(@Tenant() tenant: TenantContext): Promise<unknown[]> {
    return this.preview.listActors(tenant.tenantId)
  }

  /* 群組清單:群組欄位的選人器用。權限同 actors —— view 即可(見 service 註解)。 */
  @Get("access-preview/groups")
  @RequiresFormAction("view")
  previewGroups(@Tenant() tenant: TenantContext): Promise<{ id: number; name: string }[]> {
    return this.preview.listGroups(tenant.tenantId)
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

  /* 🔴 #113 快照帶入重整。Ragic 對應功能是無差別覆蓋、無 diff、無稽核,
     其官方另闢專篇教「被蓋掉怎麼從備份救」。這裡先 dry-run 給人看再寫,每筆留稽核。 */
  @Post(":formId/fields/:fieldId/relookup")
  @HttpCode(200)
  @RequiresFormAction("design")
  relookupField(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(z.object({ dryRun: z.boolean().default(true) })))
    body: { dryRun: boolean },
  ): Promise<unknown> {
    return this.relookup.relookup(tenant.tenantId, formId, fieldId, tenant.actorId, body.dryRun)
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
      body.parentField,
    )
  }

  /* 🔴 R1·FMT M2|欄位的顯示格式。**與選項端點分開**:選項會改寫既有記錄的資料,
     這個一個位元組都不動 —— 混在一起會讓「改格式」背上「可能改資料」的風險感。

     為什麼需要它:`local` 之下格式由租戶/使用者的 `locale` 決定,而 `en` 是
     設定白名單裡的合法值 —— 選了它整個產品的日期就變美式。**設計者必須能指定。** */
  /* 🔴 R1·LNK M2|Load 帶入:取目標記錄已對映的欄值。
     權限與遮罩由 service 內的 `getRecord` 承擔(來源欄被遮就不會出現在回傳裡)。 */
  @Get(":formId/fields/:fieldId/link-record/:recordId")
  @RequiresFormAction("view")
  async linkRecordValues(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<{ values: Record<string, unknown> }> {
    return {
      values: await this.linkOptionsService.loadValues(
        tenant.tenantId,
        formId,
        fieldId,
        recordId,
        permissions,
        tenant.actorId,
      ),
    }
  }

  /* 🔴 R1·LNK M2|設定 Load 對映。 */
  @Patch(":formId/fields/:fieldId/load-map")
  @RequiresFormAction("design")
  async updateLoadMap(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(updateLoadMapBodySchema))
    body: z.infer<typeof updateLoadMapBodySchema>,
  ): Promise<void> {
    const loaded = await this.metadata.getForm(tenant.tenantId, formId)
    const field = loaded.fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new FieldNotFoundError(fieldId)
    const options = (field.options ?? {}) as Record<string, unknown>
    const targetFormId = typeof options.targetFormId === "number" ? options.targetFormId : null
    if (field.cellValueType !== "link" || targetFormId === null) {
      throw new FieldNotFoundError(fieldId)
    }
    const target = await this.metadata.getForm(tenant.tenantId, targetFormId)
    const targetIds = new Set(target.fields.map((f) => f.id))
    const localIds = new Set(loaded.fields.map((f) => f.id))
    for (const pair of body.loadMap) {
      /* 🔴 兩端都要驗歸屬 —— 綁了租戶不等於這個欄位屬於這張表。
         少了這一條,帶著自己有 design 權的 formId 就能把**任意兩個欄位**配成對映,
         而下次有人選記錄時那個值就會被讀出來。 */
      if (!targetIds.has(pair.fromFieldId) || !localIds.has(pair.toFieldId)) {
        throw new FieldNotFoundError(pair.fromFieldId)
      }
      /* 連結欄自己不能當帶入目標 —— 帶進來會把使用者剛選的那筆蓋掉 */
      if (pair.toFieldId === fieldId) throw new FieldNotFoundError(fieldId)
    }
    await this.metadata.updateFieldOptions(tenant.tenantId, fieldId, {
      ...options,
      loadMap: body.loadMap,
    })
  }

  /* 🔴 R1·LNK M1|連結欄的候選記錄。**目標表單的 view 權在 service 內再驗一次** ——
     來源表單的權限不蘊含目標表單的權限(你在填採購單不代表你看得到供應商),
     而只在前端過濾等於沒做(同 OQ-PC-12 的教訓,直接打 API 就能繞)。 */
  /* 🔴 R1·H-4|**全庫資料修改紀錄**(Ragic 官方 `doc/81`:漢堡選單 → 資料庫管理 → 資料修改紀錄)。

     掛在 `api/forms` 之下而非 `:formId` 之下 —— 它跨表單。
     **可見範圍由 `readableFormIds` 決定**,不在 service 裡再判一次權限(第二份權限來源必然分岔)。 */
  @Get("revisions/recent")
  async recentRevisions(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Query("formId") formIdRaw?: string,
  ): Promise<{
    revisions: {
      formId: number
      formName: string
      recordId: number
      version: number
      action: string
      actorId: number | null
      createdAt: string
      changedFields: string[]
    }[]
    /* v1.2|批次(匯入 / 貼上)折成一列,與上面那串合併成同一條時間軸 */
    batches: {
      id: number
      formId: number
      formName: string
      kind: string
      actorId: number | null
      createdAt: string
      recordCount: number
      undoneAt: string | null
      undoable: boolean
    }[]
  }> {
    const forms = await this.metadata.listForms(tenant.tenantId)
    const visible = permissions.readableFormIds(forms.map((f) => f.id))
    const wanted = formIdRaw === undefined ? undefined : Number(formIdRaw)
    const filter = {
      ...(wanted !== undefined && Number.isInteger(wanted) ? { formId: wanted } : {}),
      limit: 100,
    }
    const rows = await this.records.listTenantRevisions(tenant.tenantId, visible, filter)
    const batches = await this.records.listBatches(tenant.tenantId, visible, filter)
    const nameOf = new Map(forms.map((f) => [f.id, f.name]))
    const named = (id: number): string => nameOf.get(id) ?? `#${String(id)}`
    return {
      revisions: rows.map((r) => ({ ...r, formName: named(r.formId) })),
      batches: batches.map((b) => ({ ...b, formName: named(b.formId) })),
    }
  }

  /* 🔴 R1·H-4 v1.2|**批次還原**(Ragic 官方 `doc/81` 的「還原符號」)。

     權限:批次的表單必須可編輯;匯入的還原是**軟刪**,故另要 delete 權。
     兩者都在這裡驗 —— service 不重寫一份權限判斷。 */
  @Post("revisions/batches/:batchId/undo")
  @HttpCode(200)
  /* 路由上沒有 `:formId` → Guard 的預設會退成「寫入需 admin」,那會讓
     自己貼錯資料的一般使用者連還原都按不了。標成 view 讓 Guard 放行,
     **真正的判斷在 service**(它載入批次後才知道是哪張表單)。 */
  @RequiresFormAction("view")
  async undoBatch(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("batchId", ParseIntPipe) batchId: number,
  ): Promise<{ formId: number; undoneRecords: number; skipped: BatchUndoSkip[] }> {
    return this.records.undoBatch(tenant.tenantId, batchId, tenant.actorId, permissions)
  }

  /* 🔴 R1·H-4 v1.2|**資料庫設計變更**(Ragic 官方 `doc/81`:與資料修改紀錄同一頁的下半部)。
     ⚠️ 回應**不含 `executed_sql`** —— 見 `DdlService.listDesignChanges` 的理由。 */
  @Get("revisions/design-changes")
  async designChanges(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
  ): Promise<{
    changes: {
      id: number
      formId: number | null
      formName: string | null
      action: string
      spec: Record<string, unknown>
      result: string
      errorMessage: string | null
      createdAt: string
    }[]
  }> {
    const forms = await this.metadata.listForms(tenant.tenantId)
    const visible = permissions.readableFormIds(forms.map((f) => f.id))
    const rows = await this.ddl.listDesignChanges(tenant.tenantId, visible, permissions.isAdmin)
    const nameOf = new Map(forms.map((f) => [f.id, f.name]))
    return {
      changes: rows.map((r) => ({
        ...r,
        formName: r.formId === null ? null : (nameOf.get(r.formId) ?? `#${String(r.formId)}`),
      })),
    }
  }

  @Get(":formId/fields/:fieldId/link-options")
  @RequiresFormAction("view")
  async linkOptions(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Query("q") q?: string,
    /* `ids=1,2,3` = 指名解析(記錄頁顯示用);不給則回候選清單 */
    @Query("ids") ids?: string,
  ): Promise<{ options: { id: number; label: string }[] }> {
    const wanted =
      ids === undefined || ids.trim() === ""
        ? undefined
        : ids
            .split(",")
            .map((x) => Number(x.trim()))
            .filter((n) => Number.isInteger(n) && n > 0)
    /* 🔴 audit-E §3-2|**不靜默截斷**。原本是 `.slice(0, 50)`,於是呼叫端要了 80 個
       只拿回 50 個,而少掉的那 30 個在畫面上是「顯示數字 id」——
       沒有錯誤、沒有訊號,只有「有些筆好好的、有些筆怪怪的」。
       上限仍要有(這是一支會掃表的端點),但**超過就明說**,讓呼叫端自己分批。 */
    if (wanted !== undefined && wanted.length > 50) {
      throw new BadRequestException({
        code: "TOO_MANY_IDS",
        message: "一次最多解析 50 筆,請分批查詢",
      })
    }
    return {
      options: await this.linkOptionsService.listOptions(
        tenant.tenantId,
        formId,
        fieldId,
        (q ?? "").trim(),
        wanted === undefined ? 20 : 50,
        permissions,
        tenant.actorId,
        wanted,
      ),
    }
  }

  @Patch(":formId/fields/:fieldId/display")
  @RequiresFormAction("design")
  async updateDisplay(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(updateDisplayBodySchema))
    body: z.infer<typeof updateDisplayBodySchema>,
  ): Promise<void> {
    const loaded = await this.metadata.getForm(tenant.tenantId, formId)
    const field = loaded.fields.find((f) => f.id === fieldId)
    /* 🔴 欄位必須屬於這張表。少了這一條,帶著自己有 design 權的 formId
       就能改別張表的欄位 —— 綁了租戶不等於有權存取這一筆。 */
    if (field === undefined) throw new FieldNotFoundError(fieldId)
    /* 🔴 型別閘。`options.dateFormat` 在 **autoNumber 是另一個語意**
       (取號的日期樣板,且其 optionsSchema 為 `.strict()` + 三值 enum)——
       少了這一條,對 autoNumber 欄打這支就會寫入它自己的 schema 不接受的值,
       而 `RecordService` 會據此把取號切成 patterned counter。

       ⚠️ UI 只對 date / dateTime 渲染這個設定,但**畫面上的閘不是閘**;
       上面那條「欄位必須屬於這張表」是同一個形狀的前一格(audit-D §2.6)。 */
    const isDate = field.cellValueType === "date" || field.cellValueType === "dateTime"
    if (body.dateFormat !== undefined && !isDate) {
      throw new BadRequestException({
        code: "DISPLAY_FORMAT_NOT_APPLICABLE",
        message: `「${field.name}」不是日期欄,沒有日期顯示格式可設`,
      })
    }
    if (
      (body.showAsQr !== undefined || body.displayMask !== undefined) &&
      field.cellValueType !== "text"
    ) {
      throw new BadRequestException({
        code: "DISPLAY_FORMAT_NOT_APPLICABLE",
        message: `「${field.name}」不是單行文字欄,沒有條碼與遮罩可設`,
      })
    }
    /* 🔴 型別閘,同上一段的理由:畫面上的閘不是閘。
       遮罩設定寫到別的型別上,`optionsSchema` 是 `.strict()` 會直接爆,
       但更糟的是**寫得進去卻沒有任何效果**的那種型別組合。 */
    const isMask =
      body.maskMode !== undefined || body.maskKeep !== undefined || body.revealRoleIds !== undefined
    if (isMask && field.cellValueType !== "textMask") {
      throw new BadRequestException({
        code: "DISPLAY_FORMAT_NOT_APPLICABLE",
        message: `「${field.name}」不是文字遮罩欄`,
      })
    }
    await this.metadata.updateFieldOptions(tenant.tenantId, fieldId, {
      ...(field.options as Record<string, unknown>),
      ...(body.dateFormat === undefined ? {} : { dateFormat: body.dateFormat }),
      ...(body.showAsQr === undefined ? {} : { showAsQr: body.showAsQr }),
      ...(body.maskMode === undefined ? {} : { mode: body.maskMode }),
      ...(body.maskKeep === undefined ? {} : { keep: body.maskKeep }),
      ...(body.revealRoleIds === undefined ? {} : { revealRoleIds: body.revealRoleIds }),
      /* 空字串 = 取消遮罩 → 直接移除該鍵,不留一個空值在 options 裡 */
      ...(body.displayMask === undefined
        ? {}
        : body.displayMask === ""
          ? { displayMask: undefined }
          : { displayMask: body.displayMask }),
    })
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
        | { filename: string; file: { truncated: boolean }; toBuffer: () => Promise<Buffer> }
        | undefined
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
      /* 合併儲存格已自動填滿 —— 要讓使用者知道「我看到的空白被填了什麼」 */
      mergedCells: parsed.mergedCells,
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
    return this.imports.commit(
      tenant.tenantId,
      formId,
      tenant.actorId,
      body.planHash,
      body.plan,
      body.confirmFormName,
    )
  }

  /* 批次清單:**看得到才撤得掉** —— 原本有 revert 端點卻沒有清單,使用者無從得知 batchId。 */
  @Get(":formId/import/batches")
  @RequiresFormAction("view")
  listImportBatches(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<unknown> {
    return this.imports.listBatches(tenant.tenantId, formId)
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
    await this.ddl.dropField(tenant.tenantId, formId, fieldId, tenant.actorId)
  }
}
