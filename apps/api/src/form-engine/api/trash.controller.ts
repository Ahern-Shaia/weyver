import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common"
import { TenantGuard } from "../../auth/tenant.guard.js"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../../authz/authz-http.js"
import { PermissionGuard } from "../../authz/permission.guard.js"
import type { TenantContext } from "../../http/tenant-context.js"
import { Tenant } from "../../http/tenant.decorator.js"
import { RecordService } from "../records/record.service.js"
import {
  type RestoreBlocker,
  type TrashEntryRow,
  TRASH_RETENTION_DAYS,
  TrashService,
} from "../trash/trash.service.js"

/* H-2 M1/M2|回收桶 API。

   🔴 **兩層過濾,缺一不可**|(a) TrashService 走 app 車道 → RLS 保證只有本租戶的;
   (b) 本層再依 EffectivePermissions 收一次 —— RLS 管不了「這個人能不能看這張表」。
   OQ-RB-7=A 分層:表 / 欄需 design 權,記錄需 edit 權,永久刪除需 admin。
   「要看見已刪的」很容易被誤寫成「繞過限制」,這裡刻意不繞。 */

interface TrashItemDto {
  readonly id: number
  readonly resourceType: string
  readonly resourceId: number
  readonly formId: number | null
  readonly title: string
  readonly formName: string | null
  readonly deletedBy: number | null
  readonly deletedAt: string
  readonly purgeAfter: string
}

@Controller("api/trash")
@UseGuards(TenantGuard, PermissionGuard)
export class TrashController {
  constructor(
    @Inject(TrashService) private readonly trash: TrashService,
    @Inject(RecordService) private readonly records: RecordService,
  ) {}

  private visible(entry: TrashEntryRow, permissions: EffectivePermissions): boolean {
    if (entry.formId === null) return permissions.isAdmin
    return permissions.hasAction(entry.formId, entry.resourceType === "record" ? "edit" : "design")
  }

  @Get()
  @RequiresFormAction("view")
  async list(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
  ): Promise<{ items: readonly TrashItemDto[]; retentionDays: number }> {
    const rows = await this.trash.list(tenant.tenantId)
    const items = rows
      .filter((r) => this.visible(r, permissions))
      /* 範圍受限於「自己的」時,別人刪的記錄不該出現在回收桶 —— 回收桶不是繞過範圍限制的側門 */
      .filter(
        (r) =>
          r.resourceType !== "record" ||
          r.formId === null ||
          !permissions.isScopedToOwn(r.formId, "edit") ||
          r.deletedBy === tenant.actorId,
      )
      .map((r) => ({
        id: r.id,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        formId: r.formId,
        title: r.title,
        formName: r.formName,
        deletedBy: r.deletedBy,
        deletedAt: r.deletedAt.toISOString(),
        purgeAfter: r.purgeAfter.toISOString(),
      }))
    return { items, retentionDays: TRASH_RETENTION_DAYS }
  }

  /* dry-run:不動任何東西,只回「還原會不會成功、不成功是為什麼」。 */
  @Get(":entryId/plan")
  @RequiresFormAction("view")
  async plan(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("entryId", ParseIntPipe) entryId: number,
  ): Promise<{ blockers: readonly RestoreBlocker[]; relatedCount: number }> {
    const entry = await this.assertVisible(tenant, permissions, entryId)
    const plan = await this.trash.planRestore(tenant.tenantId, entryId)
    if (plan === null) throw new NotFoundException({ code: "NOT_FOUND", message: "trash entry" })
    /* 父表單已刪時不 probe:probe 要讀欄位 metadata,而那會在表單已入回收桶時丟錯。
       這種情況 planRestore 早已給出 parentDeleted 阻擋,再 probe 也沒有新資訊。 */
    const parentGone = plan.blockers.some((b) => b.kind === "parentDeleted")
    const extra =
      entry.resourceType === "record" && entry.formId !== null && !parentGone
        ? await this.probeRecord(tenant, entry.formId, entry.resourceId)
        : []
    return { blockers: [...plan.blockers, ...extra], relatedCount: plan.relatedCount }
  }

  @Post(":entryId/restore")
  @RequiresFormAction("view")
  async restore(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("entryId", ParseIntPipe) entryId: number,
  ): Promise<{ ok: boolean; blockers: readonly RestoreBlocker[] }> {
    const entry = await this.assertVisible(tenant, permissions, entryId)

    if (entry.resourceType === "record" && entry.formId !== null) {
      const plan = await this.trash.planRestore(tenant.tenantId, entryId)
      if (plan !== null && plan.blockers.length > 0) return { ok: false, blockers: plan.blockers }
      const done = await this.records.restoreRecord(
        tenant.tenantId,
        entry.formId,
        entry.resourceId,
        tenant.actorId,
      )
      if (!done.ok) {
        return {
          ok: false,
          blockers: [
            {
              kind: "constraintViolation",
              message: "還原後會違反目前的欄位設定。",
              fields: done.violations,
            },
          ],
        }
      }
      return { ok: true, blockers: [] }
    }

    const result = await this.trash.restore(tenant.tenantId, entryId)
    return result.ok ? { ok: true, blockers: [] } : { ok: false, blockers: result.blockers }
  }

  /* 🔴 立即硬刪(OQ-RB-8):繞過保留期,供個資法刪除請求使用。
     等 30 天在合規上不可行 —— 刪除請求有時效。限 admin,且必然留 audit。 */
  @Delete(":entryId")
  @HttpCode(204)
  @RequiresFormAction("view")
  async purgeNow(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("entryId", ParseIntPipe) entryId: number,
  ): Promise<void> {
    if (!permissions.isAdmin) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "永久刪除需要管理員權限",
      })
    }
    const entry = await this.assertVisible(tenant, permissions, entryId)
    if (entry.resourceType === "record" && entry.formId !== null) {
      await this.records.hardDeleteRecord(tenant.tenantId, entry.formId, entry.resourceId)
    }
    await this.trash.markPurged(tenant.tenantId, entryId)
  }

  private async assertVisible(
    tenant: TenantContext,
    permissions: EffectivePermissions,
    entryId: number,
  ): Promise<{ resourceType: string; resourceId: number; formId: number | null }> {
    const entry = await this.trash.getEntry(tenant.tenantId, entryId)
    if (entry === null) throw new NotFoundException({ code: "NOT_FOUND", message: "trash entry" })
    const required = entry.resourceType === "record" ? "edit" : "design"
    if (
      entry.formId === null ? !permissions.isAdmin : !permissions.hasAction(entry.formId, required)
    ) {
      /* 無權者一律 404 而非 403 —— 403 等於承認「這個 id 存在」 */
      throw new NotFoundException({ code: "NOT_FOUND", message: "trash entry" })
    }
    return entry
  }

  private async probeRecord(
    tenant: TenantContext,
    formId: number,
    recordId: number,
  ): Promise<RestoreBlocker[]> {
    const violations = await this.records.probeRestoreConflicts(tenant.tenantId, formId, recordId)
    return violations.length === 0
      ? []
      : [
          {
            kind: "constraintViolation",
            message: "還原後會違反目前的欄位設定。",
            fields: violations,
          },
        ]
  }
}
