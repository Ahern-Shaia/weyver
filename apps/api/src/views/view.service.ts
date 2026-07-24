import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common"
import { AuthzRepository } from "../authz/authz.repository.js"
import type { TenantContext } from "../http/tenant-context.js"
import { type UpdateViewPatch, ViewRepository, type ViewRow } from "./view.repository.js"
import type { CreateViewBody, UpdateViewBody, ViewDto } from "./view-specs.js"

/* R1·UP-2 視圖業務規則(docs/modules/R1/views-list.md §4.5)。
   個人視圖:任何可 view 表單者可建/改/刪自己的;共通 / 設預設 / config-lock = admin 專屬。
   預設檢視唯一性由 view_def 部分唯一索引 + repo 交易內清舊保證。 */
@Injectable()
export class ViewService {
  constructor(
    @Inject(ViewRepository) private readonly repo: ViewRepository,
    @Inject(AuthzRepository) private readonly authz: AuthzRepository,
  ) {}

  private async isAdmin(tenant: TenantContext): Promise<boolean> {
    if (tenant.isSuperAdmin === true) return true
    return this.authz.isAdminActor(tenant.tenantId, tenant.actorId)
  }

  async list(tenant: TenantContext, formId: number): Promise<ViewDto[]> {
    // dev superadmin 看全部(dev 便利,個人 view 之 created_by 於 dev 為 null);prod 走 owner-or-shared
    const rows =
      tenant.isSuperAdmin === true
        ? await this.repo.listAll(tenant.tenantId, formId)
        : await this.repo.listForActor(tenant.tenantId, formId, tenant.actorId)
    return rows.map(toDto)
  }

  async create(tenant: TenantContext, formId: number, body: CreateViewBody): Promise<ViewDto> {
    if (!(await this.repo.formExists(tenant.tenantId, formId))) {
      throw new NotFoundException({ code: "FORM_NOT_FOUND", message: `form ${formId} not found` })
    }
    const adminGated = body.scope === "shared" || body.isDefault || body.locked
    if (adminGated && !(await this.isAdmin(tenant))) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "共通視圖 / 預設 / 鎖定僅管理員可設",
      })
    }
    if (body.isDefault && body.scope !== "shared") {
      throw new BadRequestException({
        code: "INVALID_VIEW",
        message: "預設檢視必須為共通(shared)視圖",
      })
    }
    const row = await this.repo.create({
      tenantId: tenant.tenantId,
      formId,
      actorId: tenant.actorId,
      name: body.name,
      scope: body.scope,
      config: body.config,
      isDefault: body.isDefault,
      locked: body.locked,
    })
    return toDto(row)
  }

  async update(
    tenant: TenantContext,
    formId: number,
    viewId: number,
    body: UpdateViewBody,
  ): Promise<ViewDto> {
    const existing = await this.requireView(tenant, formId, viewId)
    const admin = await this.isAdmin(tenant)
    this.assertCanModify(existing, admin, tenant.actorId)

    // 提升為共通 / 設預設 / 鎖定 = admin 專屬
    const escalates = body.scope === "shared" || body.isDefault === true || body.locked === true
    if (escalates && !admin) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "共通 / 預設 / 鎖定僅管理員可設",
      })
    }
    if (body.isDefault === true) {
      const effectiveScope = body.scope ?? existing.scope
      if (effectiveScope !== "shared") {
        throw new BadRequestException({
          code: "INVALID_VIEW",
          message: "預設檢視必須為共通(shared)視圖",
        })
      }
    }

    const patch: { -readonly [K in keyof UpdateViewPatch]?: UpdateViewPatch[K] } = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.config !== undefined) patch.config = body.config
    if (body.scope !== undefined) patch.scope = body.scope
    if (body.isDefault !== undefined) patch.isDefault = body.isDefault
    if (body.locked !== undefined) patch.locked = body.locked
    if (body.position !== undefined) patch.position = body.position
    await this.repo.update(tenant.tenantId, viewId, patch)

    const updated = await this.repo.getById(tenant.tenantId, viewId)
    if (updated === null)
      throw new NotFoundException({ code: "VIEW_NOT_FOUND", message: "view gone" })
    return toDto(updated)
  }

  async remove(tenant: TenantContext, formId: number, viewId: number): Promise<void> {
    const existing = await this.requireView(tenant, formId, viewId)
    this.assertCanModify(existing, await this.isAdmin(tenant), tenant.actorId)
    await this.repo.softDelete(tenant.tenantId, viewId)
  }

  private async requireView(
    tenant: TenantContext,
    formId: number,
    viewId: number,
  ): Promise<ViewRow> {
    const existing = await this.repo.getById(tenant.tenantId, viewId)
    if (existing === null || existing.formId !== formId) {
      throw new NotFoundException({ code: "VIEW_NOT_FOUND", message: `view ${viewId} not found` })
    }
    return existing
  }

  /* 共通 / 鎖定視圖 → 僅 admin;個人視圖 → 擁有者或 admin。 */
  private assertCanModify(view: ViewRow, admin: boolean, actorId: number): void {
    const adminOnly = view.scope === "shared" || view.locked
    const allowed = adminOnly ? admin : admin || view.createdBy === actorId
    if (!allowed) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "無權修改此視圖" })
    }
  }
}

function toDto(row: ViewRow): ViewDto {
  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    scope: row.scope,
    isDefault: row.isDefault,
    locked: row.locked,
    config: row.config,
    position: row.position,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}
