import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import { AuthzRepository } from "../authz/authz.repository.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { type InstallRecord, TemplateInstallService } from "./install.service.js"
import { TEMPLATE_PACKS, findPack } from "./packs.js"
import { type TemplatePack, compareVersion } from "./template-specs.js"
import { type ApplyResult, TemplateService } from "./template.service.js"
import { TemplateUpdateService, type UpdatePlan } from "./update.service.js"

const applySchema = z.object({ withRecords: z.boolean().default(false) })

export interface TemplateDetail {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly industry?: string
  readonly categoryName?: string
  readonly version: string
  readonly installedVersion: string | null
  readonly updateAvailable: boolean
  /* 這個租戶已經有這個分類 → 套用時沿用而不是新建(OQ-TPL-10=A) */
  readonly categoryExists: boolean
  readonly fieldCount: number
  readonly hasSampleRows: boolean
  readonly hasLayout: boolean
  readonly forms: readonly {
    readonly ref: string
    readonly name: string
    readonly parentRef?: string
    readonly fields: readonly {
      readonly name: string
      readonly type: string
      readonly required: boolean
      readonly targetRef?: string
    }[]
  }[]
}

/* R1·TPL M3|建表的第三條路(與空白、Excel 匯入並列)。

   ⚠️ 清單刻意**不回 `forms` 全文** —— 它是給挑選用的,
   一次回 9 個包的完整欄位定義只是把 payload 撐大。 */
@Controller("api/templates")
@UseGuards(TenantGuard)
export class TemplatesController {
  constructor(
    @Inject(TemplateService) private readonly templates: TemplateService,
    @Inject(TemplateInstallService) private readonly installs: TemplateInstallService,
    @Inject(TemplateUpdateService) private readonly updates: TemplateUpdateService,
    @Inject(AuthzRepository) private readonly authz: AuthzRepository,
  ) {}

  /* M6:清單帶上「這個租戶裝過沒 / 裝的是哪一版 / 有沒有新版」。
     ⚠️ 仍然**不回 `forms` 全文** —— 那是給挑選用的清單,不是詳情。 */
  @Get()
  async list(@Tenant() tenant: TenantContext): Promise<
    {
      key: string
      name: string
      description: string
      industry?: string
      formCount: number
      version: string
      installedVersion: string | null
      updateAvailable: boolean
    }[]
  > {
    const installed = await this.installs.highestVersions(tenant.tenantId)
    return TEMPLATE_PACKS.map((p) => {
      const iv = installed.get(p.key) ?? null
      return {
        key: p.key,
        name: p.name,
        description: p.description,
        ...(p.industry === undefined ? {} : { industry: p.industry }),
        formCount: p.forms.length,
        version: p.version,
        installedVersion: iv,
        /* 沒裝過 → 不是「有新版」,是「沒裝」。兩者在 UI 上是不同的字。 */
        updateAvailable: iv !== null && compareVersion(p.version, iv) > 0,
      }
    })
  }

  /* 這個租戶的安裝史。同一個 pack 可以有多筆(M4 已確立那是合法意圖)。 */
  @Get("installs")
  installsList(@Tenant() tenant: TenantContext): Promise<readonly InstallRecord[]> {
    return this.installs.list(tenant.tenantId)
  }

  /* M8|詳情。清單刻意不回 `forms` 全文,但**詳情頁需要它來畫關聯圖** ——
     圖是由 `ref` / `parentRef` / `targetRef` 推導的,不是另外畫的圖,
     所以它不可能和實際裝進去的東西不一致。

     ⚠️ 不回 `sampleRows` 內容,只回「有沒有」 —— 那是示範資料,
     使用者要決定的是帶不帶,不是看內容。 */
  @Get(":key/detail")
  async detail(
    @Tenant() tenant: TenantContext,
    @Param("key") key: string,
  ): Promise<TemplateDetail> {
    const pack = this.mustFind(key)
    const installed = (await this.installs.highestVersions(tenant.tenantId)).get(key) ?? null
    /* 「分類『採購』你已經有了 → 直接放進去」是所見即後果的核心一行。
       OQ-TPL-10=A 的行為(同名沿用,否則建立)必須在按下去**之前**就講清楚。 */
    const categoryExists =
      pack.categoryName !== undefined &&
      (await this.authz.listCategories(tenant.tenantId)).some((c) => c.name === pack.categoryName)
    return {
      key: pack.key,
      name: pack.name,
      description: pack.description,
      ...(pack.industry === undefined ? {} : { industry: pack.industry }),
      ...(pack.categoryName === undefined ? {} : { categoryName: pack.categoryName }),
      version: pack.version,
      installedVersion: installed,
      updateAvailable: installed !== null && compareVersion(pack.version, installed) > 0,
      categoryExists,
      fieldCount: pack.forms.reduce((n, f) => n + f.fields.length, 0),
      hasSampleRows: pack.forms.some((f) => f.sampleRows.length > 0),
      hasLayout: pack.forms.some((f) => f.layout !== undefined),
      forms: pack.forms.map((f) => ({
        ref: f.ref,
        name: f.name,
        ...(f.parentRef === undefined ? {} : { parentRef: f.parentRef }),
        fields: f.fields.map((x) => ({
          name: x.name,
          type: x.type,
          required: x.required === true,
          ...(x.targetRef === undefined ? {} : { targetRef: x.targetRef }),
        })),
      })),
    }
  }

  /* OQ-TPL-11=B|**預覽先於套用**。預覽與套用走同一段計算,
     否則「預覽講的」與「實際做的」會漂 —— 那比不給預覽更糟。 */
  @Get(":key/update-preview")
  updatePreview(@Tenant() tenant: TenantContext, @Param("key") key: string): Promise<UpdatePlan> {
    return this.updates.plan(tenant.tenantId, this.mustFind(key))
  }

  /* 僅新增式更新:只建缺的表 / 補缺的欄位,**絕不改名、不改型別、不刪除**。 */
  @Post(":key/update")
  update(@Tenant() tenant: TenantContext, @Param("key") key: string): Promise<UpdatePlan> {
    return this.updates.apply(tenant.tenantId, this.mustFind(key), tenant.actorId)
  }

  @Post(":key/apply")
  async apply(
    @Tenant() tenant: TenantContext,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(applySchema)) body: z.infer<typeof applySchema>,
  ): Promise<ApplyResult> {
    return this.templates.apply(tenant.tenantId, this.mustFind(key), tenant.actorId, {
      withRecords: body.withRecords,
    })
  }

  private mustFind(key: string): TemplatePack {
    const pack = findPack(key)
    /* 不用 NotFoundException 的通用訊息 —— 講清楚是「這個範本不存在」,
       而不是讓使用者以為是路由錯了 */
    if (pack === undefined) throw new NotFoundException(`找不到範本「${key}」`)
    return pack
  }
}
