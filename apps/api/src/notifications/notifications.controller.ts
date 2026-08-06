import { Body, Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { LEVEL_VALUES, NOTIFICATION_EVENTS, type NotificationLevel } from "./notification-specs.js"
import { NotificationRepository } from "./notification.repository.js"
import { NotificationService } from "./notification.service.js"

/* H-1 通知端點(薄 controller)。

   **刻意不掛 `PermissionGuard`**:通知是「我的」收件匣,授權邊界是
   `tenantContext.actorId` 本身 —— 所有查詢都以它為條件,不存在「看別人的通知」的路徑。
   套表單級權限反而錯位(通知可能來自多張表單)。 */

const markReadSchema = z.object({ ids: z.array(z.number().int().positive()).max(200) })

const eventCodes = Object.values(NOTIFICATION_EVENTS)

const prefSchema = z.object({
  scope: z.enum(["tenant", "category", "form"]),
  scopeId: z.number().int().positive().nullable(),
  level: z
    .number()
    .int()
    .refine((v) => LEVEL_VALUES.includes(v), { message: "未知的通知層級" }),
  customEvents: z
    .array(z.enum(eventCodes as [string, ...string[]]))
    .max(20)
    .nullable(),
})

const clearPrefSchema = z.object({
  scope: z.enum(["tenant", "category", "form"]),
  scopeId: z.number().int().positive().nullable(),
})

const settingsSchema = z.object({
  enabled: z.boolean(),
  channels: z.record(z.string(), z.array(z.string())).nullable(),
})

@Controller("api/notifications")
@UseGuards(TenantGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(NotificationRepository) private readonly repo: NotificationRepository,
  ) {}

  @Get()
  async list(@Tenant() tenant: TenantContext) {
    const { items, unread } = await this.notifications.list(tenant.tenantId, tenant.actorId)
    return {
      unread,
      items: items.map((n) => ({
        id: n.id,
        event: n.event,
        formId: n.formId,
        recordId: n.recordId,
        title: n.title,
        actorId: n.actorId,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
    }
  }

  @Post("read")
  @HttpCode(204)
  async markRead(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(markReadSchema)) body: z.infer<typeof markReadSchema>,
  ): Promise<void> {
    await this.notifications.markRead(tenant.tenantId, tenant.actorId, body.ids)
  }

  @Post("read-all")
  @HttpCode(204)
  async markAllRead(@Tenant() tenant: TenantContext): Promise<void> {
    await this.notifications.markAllRead(tenant.tenantId, tenant.actorId)
  }

  @Get("settings")
  async settings(@Tenant() tenant: TenantContext) {
    const [prefs, settings] = await Promise.all([
      this.repo.listPrefs(tenant.tenantId, [tenant.actorId]),
      this.repo.listSettings(tenant.tenantId, [tenant.actorId]),
    ])
    const mine = settings.get(tenant.actorId)
    return {
      /* 缺列 = 預設啟用(既有使用者零遷移) */
      enabled: mine?.enabled ?? true,
      channels: mine?.channels ?? null,
      prefs: (prefs.get(tenant.actorId) ?? []).map((p) => ({
        scope: p.scope,
        scopeId: p.scopeId,
        level: p.level,
        customEvents: p.customEvents,
      })),
    }
  }

  @Post("settings")
  @HttpCode(204)
  async saveSettings(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
  ): Promise<void> {
    await this.repo.setSettings({
      tenantId: tenant.tenantId,
      actorId: tenant.actorId,
      enabled: body.enabled,
      channels: body.channels,
    })
  }

  @Post("prefs")
  @HttpCode(204)
  async savePref(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(prefSchema)) body: z.infer<typeof prefSchema>,
  ): Promise<void> {
    await this.repo.setPref({
      tenantId: tenant.tenantId,
      actorId: tenant.actorId,
      scope: body.scope,
      scopeId: body.scopeId,
      level: body.level as NotificationLevel,
      customEvents: body.customEvents,
    })
  }

  /* 🔴 恢復繼承。**授權邊界同本 controller 其餘端點**:只刪 `actorId` 自己那列,
     所以不存在「清掉別人的偏好」的路徑,不需要額外的權限判斷。

     ⚠️ 以 body 而非 query 傳 scope —— DELETE 帶 body 少見,但 scope+scopeId 是**一組**
     複合鍵,拆成兩個 query 參數會讓「只帶其一」變成可表達的錯誤狀態。 */
  @Delete("prefs")
  @HttpCode(204)
  async clearPref(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(clearPrefSchema)) body: z.infer<typeof clearPrefSchema>,
  ): Promise<void> {
    await this.repo.clearPref({
      tenantId: tenant.tenantId,
      actorId: tenant.actorId,
      scope: body.scope,
      scopeId: body.scopeId,
    })
  }
}
