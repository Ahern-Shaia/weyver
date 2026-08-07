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
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { type InstallRecord, TemplateInstallService } from "./install.service.js"
import { TEMPLATE_PACKS, findPack } from "./packs.js"
import { type TemplatePack, compareVersion } from "./template-specs.js"
import { type ApplyResult, TemplateService } from "./template.service.js"
import { TemplateUpdateService, type UpdatePlan } from "./update.service.js"

const applySchema = z.object({ withRecords: z.boolean().default(false) })

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
