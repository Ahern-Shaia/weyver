import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { TEMPLATE_PACKS, findPack } from "./packs.js"
import { type ApplyResult, TemplateService } from "./template.service.js"

const applySchema = z.object({ withRecords: z.boolean().default(false) })

/* R1·TPL M3|建表的第三條路(與空白、Excel 匯入並列)。

   ⚠️ 清單刻意**不回 `forms` 全文** —— 它是給挑選用的,
   一次回 9 個包的完整欄位定義只是把 payload 撐大。 */
@Controller("api/templates")
@UseGuards(TenantGuard)
export class TemplatesController {
  constructor(@Inject(TemplateService) private readonly templates: TemplateService) {}

  @Get()
  list(): {
    key: string
    name: string
    description: string
    industry?: string
    formCount: number
  }[] {
    return TEMPLATE_PACKS.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      ...(p.industry === undefined ? {} : { industry: p.industry }),
      formCount: p.forms.length,
    }))
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
