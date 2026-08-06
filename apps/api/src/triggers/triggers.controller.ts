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
  UseGuards,
} from "@nestjs/common"
import { z } from "zod"

import { TenantGuard } from "../auth/tenant.guard.js"
import { RequiresFormAction } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import {
  type TriggerDto,
  type TriggerRunDto,
  createTriggerBodySchema,
  updateTriggerBodySchema,
} from "./trigger-specs.js"
import { TriggerService } from "./trigger.service.js"

const dryRunBodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
  previous: z.record(z.string(), z.unknown()).nullable().default(null),
})

/* 🔴 建立 / 修改觸發器一律 `design` 權,不是 `edit`。

   同步觸發器**豁免欄位級寫入權限**(見 `assertWritable`),所以
   「誰能建觸發器」= 「誰能繞過這張表的欄位權限」。用 `edit` 的話,
   一個只能改資料的人就能設一條規則去寫他本來不能寫的欄位。 */
@Controller("api/forms/:formId/triggers")
@UseGuards(TenantGuard, PermissionGuard)
export class TriggersController {
  constructor(@Inject(TriggerService) private readonly triggers: TriggerService) {}

  @Get()
  @RequiresFormAction("design")
  async list(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<TriggerDto[]> {
    return this.triggers.list(tenant, formId)
  }

  @Post()
  @RequiresFormAction("design")
  async create(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(createTriggerBodySchema))
    body: z.infer<typeof createTriggerBodySchema>,
  ): Promise<TriggerDto> {
    return this.triggers.create(tenant, formId, body)
  }

  @Patch(":triggerId")
  @RequiresFormAction("design")
  async update(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("triggerId", ParseIntPipe) triggerId: number,
    @Body(new ZodValidationPipe(updateTriggerBodySchema))
    body: z.infer<typeof updateTriggerBodySchema>,
  ): Promise<TriggerDto> {
    return this.triggers.update(tenant, formId, triggerId, body)
  }

  @Delete(":triggerId")
  @HttpCode(204)
  @RequiresFormAction("design")
  async remove(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("triggerId", ParseIntPipe) triggerId: number,
  ): Promise<void> {
    await this.triggers.remove(tenant, formId, triggerId)
  }

  @Get("runs")
  @RequiresFormAction("design")
  async runs(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<TriggerRunDto[]> {
    return this.triggers.runs(tenant, formId)
  }

  /* 試跑:不寫入。設計者要能在不弄壞一張表的前提下驗證自己設的規則。 */
  @Post("dry-run")
  @HttpCode(200)
  @RequiresFormAction("design")
  async dryRun(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(dryRunBodySchema)) body: z.infer<typeof dryRunBodySchema>,
  ): Promise<{ values: Record<string, unknown>; ran: readonly { triggerId: number }[] }> {
    return this.triggers.dryRun(tenant, formId, body.values, body.previous)
  }
}
