import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { type InstallRecord, TemplateInstallService } from "./install.service.js"
import { TEMPLATE_PACKS, findPack } from "./packs.js"
import { compareVersion } from "./template-specs.js"
import { type ApplyResult, TemplateService } from "./template.service.js"

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

  @Post(":key/apply")
  async apply(
    @Tenant() tenant: TenantContext,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(applySchema)) body: z.infer<typeof applySchema>,
  ): Promise<ApplyResult> {
    const pack = findPack(key)
    if (pack === undefined) {
      /* 不用 NotFoundException 的通用訊息 —— 講清楚是「這個範本不存在」,
         而不是讓使用者以為是路由錯了 */
      throw new Error(`template not found: ${key}`)
    }
    return this.templates.apply(tenant.tenantId, pack, tenant.actorId, {
      withRecords: body.withRecords,
    })
  }
}
