import { Body, Controller, ForbiddenException, Get, Inject, Patch, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import {
  type EffectiveUserSettings,
  SettingsService,
  type TenantSettings,
} from "./settings.service.js"

/* R1·A-1 M1|設定中心 API。

   **讀租戶設定不限 admin**(公司名 / 時區是全體都需要知道的顯示前提),
   **寫租戶設定限 admin**。個人設定則恆為「只能改自己的」——
   actorId 一律取自 `TenantContext`,**不接受呼叫端指定**,否則就是一條改別人偏好的路徑。 */

/* IANA 時區白名單靠執行期驗證,不自己維護清單 —— Intl 是 Node 內建的權威來源 */
const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz })
      return true
    } catch {
      return false
    }
  },
  { message: "unknown IANA time zone" },
)

const LOCALES = ["zh-Hant", "en", "ja"] as const

const tenantPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    // 台灣統編 8 碼;空字串視為清空(DB CHECK 只接受 NULL 或 8 碼數字)
    taxId: z
      .string()
      .trim()
      .regex(/^[0-9]{8}$/)
      .nullable(),
    timezone: timezoneSchema,
    defaultLocale: z.enum(LOCALES),
    defaultCurrency: z.string().trim().length(3).toUpperCase(),
  })
  .partial()

/* `null` = 取消自訂回到繼承;未帶該鍵 = 不動。兩者必須分得開(見 service) */
const userPatchSchema = z
  .object({
    locale: z.enum(LOCALES).nullable(),
    displayTimezone: timezoneSchema.nullable(),
  })
  .partial()

@Controller("api/settings")
@UseGuards(TenantGuard, PermissionGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get("tenant")
  async tenant(@Tenant() tenant: TenantContext): Promise<TenantSettings> {
    return this.settings.getTenant(tenant.tenantId)
  }

  @Patch("tenant")
  async patchTenant(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(tenantPatchSchema)) body: z.infer<typeof tenantPatchSchema>,
  ): Promise<TenantSettings> {
    if (!permissions.isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "僅管理員可修改公司設定" })
    }
    return this.settings.updateTenant(tenant.tenantId, body)
  }

  @Get("me")
  async me(@Tenant() tenant: TenantContext): Promise<EffectiveUserSettings> {
    return this.settings.getUser(tenant.tenantId, tenant.actorId)
  }

  @Patch("me")
  async patchMe(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(userPatchSchema)) body: z.infer<typeof userPatchSchema>,
  ): Promise<EffectiveUserSettings> {
    return this.settings.updateUser(tenant.tenantId, tenant.actorId, body)
  }
}
