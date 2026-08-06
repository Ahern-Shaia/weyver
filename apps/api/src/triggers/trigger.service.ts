import { Inject, Injectable, NotFoundException } from "@nestjs/common"

import type { FormatCondition } from "@weyver/rules"
import type { TenantContext } from "../http/tenant-context.js"
import type {
  CreateTriggerBody,
  TriggerDto,
  TriggerRunDto,
  UpdateTriggerBody,
} from "./trigger-specs.js"
import { TriggerSyncService } from "./trigger-sync.service.js"
import { type TriggerRow, TriggersRepository } from "./triggers.repository.js"

const RUN_PAGE = 100

@Injectable()
export class TriggerService {
  constructor(
    @Inject(TriggersRepository) private readonly repo: TriggersRepository,
    @Inject(TriggerSyncService) private readonly sync: TriggerSyncService,
  ) {}

  async list(tenant: TenantContext, formId: number): Promise<TriggerDto[]> {
    return (await this.repo.listByForm(tenant.tenantId, formId)).map(toDto)
  }

  async create(
    tenant: TenantContext,
    formId: number,
    body: CreateTriggerBody,
  ): Promise<TriggerDto> {
    const id = await this.repo.create({
      tenantId: tenant.tenantId,
      formId,
      name: body.name,
      onCreate: body.onCreate,
      onUpdate: body.onUpdate,
      watchFields: body.watchFields,
      conditions: body.conditions as FormatCondition[],
      config: body.config,
      enabled: body.enabled,
    })
    return toDto(await this.require(tenant, formId, id))
  }

  async update(
    tenant: TenantContext,
    formId: number,
    triggerId: number,
    body: UpdateTriggerBody,
  ): Promise<TriggerDto> {
    await this.require(tenant, formId, triggerId)
    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.onCreate !== undefined) patch.onCreate = body.onCreate
    if (body.onUpdate !== undefined) patch.onUpdate = body.onUpdate
    if (body.watchFields !== undefined) patch.watchFields = body.watchFields
    if (body.conditions !== undefined) patch.conditions = body.conditions
    if (body.position !== undefined) patch.position = body.position
    if (body.enabled !== undefined) patch.enabled = body.enabled
    if (body.config !== undefined) {
      patch.config = body.config
      /* 兩欄要一起改:`action_type` 是 CHECK 與查詢過濾用的,`config` 才是真內容。
         只改一邊的話,同步側的查詢會照舊撈到它,然後在迴圈裡才發現型別不對。 */
      patch.actionType = body.config.actionType
    }
    await this.repo.update(tenant.tenantId, triggerId, patch)
    return toDto(await this.require(tenant, formId, triggerId))
  }

  async remove(tenant: TenantContext, formId: number, triggerId: number): Promise<void> {
    await this.require(tenant, formId, triggerId)
    await this.repo.softDelete(tenant.tenantId, triggerId)
  }

  async runs(tenant: TenantContext, formId: number): Promise<TriggerRunDto[]> {
    return (await this.repo.listRuns(tenant.tenantId, formId, RUN_PAGE)).map((r) => ({
      id: r.id,
      triggerId: r.triggerId,
      triggerName: r.triggerName,
      recordId: r.recordId,
      outcome: r.outcome,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  /* 🔴 試跑。**不寫入**,只回「這些值存下去會變成什麼」。

     這一支不是便利功能,是 OQ-ET-6 的配套:同步觸發器算不出來時會**擋住存檔**,
     所以設計者必須有辦法在不弄壞一張表的前提下驗證自己設的規則。
     沒有它的話,試錯的成本是「整張表存不了,而且不知道為什麼」。 */
  async dryRun(
    tenant: TenantContext,
    formId: number,
    values: Record<string, unknown>,
    previous: Record<string, unknown> | null,
  ): Promise<{ values: Record<string, unknown>; ran: readonly { triggerId: number }[] }> {
    const result = await this.sync.apply(tenant.tenantId, formId, values, previous, tenant.actorId)
    return { values: result.values, ran: result.ran.map((r) => ({ triggerId: r.triggerId })) }
  }

  private async require(
    tenant: TenantContext,
    formId: number,
    triggerId: number,
  ): Promise<TriggerRow> {
    const row = await this.repo.get(tenant.tenantId, triggerId)
    /* 🔴 也要驗 formId:只查 id 的話,同租戶內從別張表的路由讀得到這張表的觸發器 ——
       綁了 tenant_id 不等於有權存取這一筆(本 repo 已記為 BOLA 的典型形態)。 */
    if (row === null || row.formId !== formId) {
      throw new NotFoundException({ code: "TRIGGER_NOT_FOUND", message: `trigger ${triggerId}` })
    }
    return row
  }
}

function toDto(row: TriggerRow): TriggerDto {
  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    onCreate: row.onCreate,
    onUpdate: row.onUpdate,
    watchFields: row.watchFields,
    conditions: row.conditions,
    actionType: row.config.actionType,
    config: row.config,
    position: row.position,
    enabled: row.enabled,
  }
}
