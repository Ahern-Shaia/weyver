import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common"

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
    /* 🔴 **新建直接發布,編輯才進草稿。**

       Teable 的用語是「Editing a live workflow」—— 草稿要解的是「改到一半的東西
       在對真實資料動作」,而新建沒有這個問題(它之前不存在)。
       反過來若新建也要按發布,使用者建完會看到一條**什麼都不做**的觸發器,
       而畫面上沒有任何東西告訴他為什麼。 */
    await this.repo.publish(tenant.tenantId, id)
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

  /* 把草稿發布上線。**這是唯一讓定義變更生效的動作。** */
  async publish(tenant: TenantContext, formId: number, triggerId: number): Promise<TriggerDto> {
    await this.require(tenant, formId, triggerId)
    await this.repo.publish(tenant.tenantId, triggerId)
    return toDto(await this.require(tenant, formId, triggerId))
  }

  /* 丟掉草稿。從未發布過的觸發器不能丟(丟了會變成空的)—— 那種要刪不是丟。 */
  async discardDraft(
    tenant: TenantContext,
    formId: number,
    triggerId: number,
  ): Promise<TriggerDto> {
    const row = await this.require(tenant, formId, triggerId)
    if (row.published === null) {
      throw new BadRequestException({
        code: "TRIGGER_NEVER_PUBLISHED",
        message: "這條觸發器從未發布過,沒有可以還原的版本",
      })
    }
    await this.repo.discardDraft(tenant.tenantId, triggerId)
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
    /* 設計器要編輯的是草稿,要顯示的是「跑的是哪一版」。兩者都給。 */
    draft: row.draft,
    isPublished: row.published !== null,
    hasUnpublishedChanges: row.hasUnpublishedChanges,
  }
}
