import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { RecordService } from "../form-engine/records/record.service.js"
import type { TenantContext } from "../http/tenant-context.js"
import type {
  ButtonConfig,
  ButtonDto,
  CreateButtonBody,
  UpdateButtonBody,
} from "./action-specs.js"
import { ActionsRepository, type ButtonRow } from "./actions.repository.js"
import { compileValues } from "./compile-values.js"

/* R1·後續-1 M1 按鈕動作執行器。docs/22 載重不變量:
 **封閉 allowlist 動作 → config 確定性編譯(非 eval)→ 權限 gate → 冪等 key → audit**。 */

export interface ActionResult {
  readonly outcome: "updated" | "created" | "openUrl" | "duplicate"
  readonly targetRecordId?: number
  readonly url?: string
}

@Injectable()
export class ButtonService {
  constructor(
    @Inject(ActionsRepository) private readonly repo: ActionsRepository,
    @Inject(RecordService) private readonly records: RecordService,
  ) {}

  async list(tenant: TenantContext, formId: number): Promise<ButtonDto[]> {
    const rows = await this.repo.listButtons(tenant.tenantId, formId)
    return rows.map(toDto)
  }

  async create(tenant: TenantContext, formId: number, body: CreateButtonBody): Promise<ButtonDto> {
    const row = await this.repo.createButton({
      tenantId: tenant.tenantId,
      formId,
      label: body.label,
      config: body.config,
      confirm: body.confirm,
    })
    return toDto(row)
  }

  async update(
    tenant: TenantContext,
    formId: number,
    buttonId: number,
    body: UpdateButtonBody,
  ): Promise<ButtonDto> {
    await this.requireButton(tenant, formId, buttonId)
    const patch: {
      label?: string
      config?: ButtonConfig
      confirm?: boolean
      position?: number
    } = {}
    if (body.label !== undefined) patch.label = body.label
    if (body.config !== undefined) patch.config = body.config
    if (body.confirm !== undefined) patch.confirm = body.confirm
    if (body.position !== undefined) patch.position = body.position
    await this.repo.updateButton(tenant.tenantId, buttonId, patch)
    const updated = await this.repo.getButton(tenant.tenantId, buttonId)
    if (updated === null) throw new NotFoundException({ code: "BUTTON_NOT_FOUND", message: "gone" })
    return toDto(updated)
  }

  async remove(tenant: TenantContext, formId: number, buttonId: number): Promise<void> {
    await this.requireButton(tenant, formId, buttonId)
    await this.repo.softDeleteButton(tenant.tenantId, buttonId)
  }

  /* 執行按鈕。冪等 key 預設 = button:record:actor(呼叫端可覆寫);已執行過 → 回 duplicate 不重跑。 */
  async execute(
    tenant: TenantContext,
    formId: number,
    recordId: number,
    buttonId: number,
    permissions: EffectivePermissions | undefined,
    idempotencyKey?: string,
  ): Promise<ActionResult> {
    const button = await this.requireButton(tenant, formId, buttonId)

    /* 🔴 C-3|條件式的「隱藏 / 上鎖動作按鈕」**在這裡執法**。
       前端不畫那顆按鈕只是體驗;按鈕的效果是伺服器跑的,擋也要擋在伺服器。
       官方逐字:上鎖時「還可以**客製提醒訊息**」→ 規則上的 message 效果即為該文案。 */
    const gate = await this.records.evaluateActionGate(tenant.tenantId, formId, recordId, {
      buttonId,
    })
    if (gate.hidden || gate.locked) {
      throw new ForbiddenException({
        code: "BUTTON_BLOCKED_BY_RULE",
        /* 沒設客製文案時給一句說得出原因的預設 —— 一個按不動又不說為什麼的按鈕,
           使用者只會一直按,然後來問為什麼壞掉 */
        message: gate.message ?? "此記錄目前的狀態不允許執行這個動作",
      })
    }

    const key = idempotencyKey ?? `btn:${buttonId}:rec:${recordId}`
    const existing = await this.repo.findAuditByKey(tenant.tenantId, key)
    if (existing !== null) return { outcome: "duplicate" }

    const result = await this.runAction(tenant, formId, recordId, button, permissions)
    await this.repo.writeAudit({
      tenantId: tenant.tenantId,
      buttonId,
      formId,
      recordId,
      actorId: tenant.actorId,
      idempotencyKey: key,
      outcome: result.outcome,
      detail:
        result.targetRecordId === undefined ? null : { targetRecordId: result.targetRecordId },
    })
    return result
  }

  /* 供簽核完自動執行復用(§4.3);冪等 key 由呼叫端給(instance 綁定)。 */
  async runAction(
    tenant: TenantContext,
    formId: number,
    recordId: number,
    button: ButtonRow,
    permissions: EffectivePermissions | undefined,
  ): Promise<ActionResult> {
    const config = button.config
    if (config.actionType === "openUrl") return { outcome: "openUrl", url: config.url }

    const source = await this.records.getRecord(
      tenant.tenantId,
      formId,
      recordId,
      permissions,
      tenant.actorId,
    )

    if (config.actionType === "updateSelf") {
      const values = compileValues(config.setFields, source.values, tenant.actorId)
      await this.records.updateRecord(
        tenant.tenantId,
        formId,
        recordId,
        source.version,
        values,
        tenant.actorId,
        permissions,
      )
      return { outcome: "updated" }
    }

    // pushTo:依 fieldMap 於 target 表建記錄(權限由 RecordService assertWritable 兜底)
    const values = compileValues(config.fieldMap, source.values, tenant.actorId)
    if (permissions !== undefined && !permissions.hasAction(config.targetFormId, "create")) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "無權於目標表單建立記錄",
      })
    }
    const created = await this.records.createRecord(
      tenant.tenantId,
      config.targetFormId,
      values,
      tenant.actorId,
      permissions,
    )
    return { outcome: "created", targetRecordId: created.id }
  }

  private async requireButton(
    tenant: TenantContext,
    formId: number,
    buttonId: number,
  ): Promise<ButtonRow> {
    const button = await this.repo.getButton(tenant.tenantId, buttonId)
    if (button === null || button.formId !== formId) {
      throw new NotFoundException({ code: "BUTTON_NOT_FOUND", message: `button ${buttonId}` })
    }
    return button
  }
}

function toDto(row: ButtonRow): ButtonDto {
  return {
    id: row.id,
    formId: row.formId,
    label: row.label,
    actionType: row.actionType,
    config: row.config,
    confirm: row.confirm,
    position: row.position,
  }
}
