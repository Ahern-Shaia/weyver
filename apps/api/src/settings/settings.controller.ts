import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common"
import type pg from "pg"
import { z } from "zod"
import { hasMfaEnabled } from "../auth/mfa-gate.js"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions, SelfService } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import { PG_POOL } from "../db/db.module.js"
import type { RequestWithTenant } from "../http/tenant-context.js"
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
    requireMfa: z.boolean(),
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
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    /* `user."twoFactorEnabled"` 是 Better Auth 的表,無 RLS → 特權車道 */
    @Inject(PG_POOL) private readonly pool: pg.Pool,
  ) {}

  @Get("tenant")
  async tenant(@Tenant() tenant: TenantContext): Promise<TenantSettings> {
    return this.settings.getTenant(tenant.tenantId)
  }

  @Patch("tenant")
  async patchTenant(
    @Tenant() tenant: TenantContext,
    @Req() request: RequestWithTenant,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(tenantPatchSchema)) body: z.infer<typeof tenantPatchSchema>,
  ): Promise<TenantSettings> {
    if (!permissions.isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "僅管理員可修改公司設定" })
    }
    /* 🔴 開啟強制 2FA 之前,開啟的人本人必須先啟用(GitHub 逐字前置規定:
       「Before you can require organization members... you must enable 2FA for
       your account.」)。少了這一條,第一個被自己鎖在門外的就是管理員 ——
       而他正是唯一能把開關關掉的人。 */
    if (body.requireMfa === true) {
      const authUserId = request.authUserId ?? null
      if (authUserId === null || !(await hasMfaEnabled(this.pool, authUserId))) {
        throw new ForbiddenException({
          code: "MFA_SELF_REQUIRED",
          message: "請先為自己啟用二步驟驗證,才能要求全公司啟用",
        })
      }
    }
    return this.settings.updateTenant(tenant.tenantId, body)
  }

  @Get("me")
  async me(@Tenant() tenant: TenantContext): Promise<EffectiveUserSettings> {
    return this.settings.getUser(tenant.tenantId, tenant.actorId)
  }

  @Patch("me")
  @SelfService()
  async patchMe(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(userPatchSchema)) body: z.infer<typeof userPatchSchema>,
  ): Promise<EffectiveUserSettings> {
    return this.settings.updateUser(tenant.tenantId, tenant.actorId, body)
  }
}
