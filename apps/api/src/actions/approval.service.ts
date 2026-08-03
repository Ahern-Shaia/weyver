import { evaluateExpressionSync } from "@gorules/zen-engine"
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { AuthzRepository } from "../authz/authz.repository.js"
import { NOTIFICATION_EVENTS } from "../notifications/notification-specs.js"
import { NotificationService } from "../notifications/notification.service.js"
import { RecordService } from "../form-engine/records/record.service.js"
import type { TenantContext } from "../http/tenant-context.js"
import type {
  ApprovalDefDto,
  ApprovalInstanceDto,
  ApprovalStep,
  CreateApprovalDefBody,
} from "./action-specs.js"
import {
  ActionsRepository,
  type ApprovalChainBreak,
  type ApprovalDefRow,
} from "./actions.repository.js"
import { ApprovalDelegateRepository } from "./approval-delegate.repository.js"
import { ButtonService } from "./button.service.js"

/* R1·後續-1 M2 簽核狀態機(OQ-AA-1=A:DB pending step 由 approve 推進,無 DBOS)。
   金額條件走 **ZEN 表達式**(OQ-AA-4;expression 由結構化 config 確定性組出,非使用者任意字串)。
   人核准為 gate(承 authz `approve` + 該步角色成員);完成 → 觸發 onComplete 按鈕(冪等)。 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(ActionsRepository) private readonly repo: ActionsRepository,
    @Inject(ApprovalDelegateRepository) private readonly delegates: ApprovalDelegateRepository,
    @Inject(AuthzRepository) private readonly authz: AuthzRepository,
    @Inject(RecordService) private readonly records: RecordService,
    @Inject(ButtonService) private readonly buttons: ButtonService,
    @Inject(NotificationService) private readonly notify: NotificationService,
  ) {}

  // ---- 定義 ----

  async listDefs(tenant: TenantContext, formId: number): Promise<ApprovalDefDto[]> {
    const rows = await this.repo.listApprovalDefs(tenant.tenantId, formId)
    return rows.map(toDefDto)
  }

  async createDef(
    tenant: TenantContext,
    formId: number,
    body: CreateApprovalDefBody,
  ): Promise<ApprovalDefDto> {
    const seen = new Set<number>()
    for (const s of body.steps) {
      if (seen.has(s.stepNo)) {
        throw new BadRequestException({ code: "INVALID_APPROVAL_DEF", message: "步驟序號重複" })
      }
      seen.add(s.stepNo)
    }
    const row = await this.repo.createApprovalDef({
      tenantId: tenant.tenantId,
      formId,
      name: body.name,
      steps: [...body.steps].sort((a, b) => a.stepNo - b.stepNo),
      onCompleteButtonId: body.onCompleteButtonId ?? null,
      active: body.active,
    })
    return toDefDto(row)
  }

  async removeDef(tenant: TenantContext, formId: number, defId: number): Promise<void> {
    const def = await this.repo.getApprovalDef(tenant.tenantId, defId)
    if (def === null || def.formId !== formId) {
      throw new NotFoundException({ code: "APPROVAL_DEF_NOT_FOUND", message: `def ${defId}` })
    }
    await this.repo.softDeleteApprovalDef(tenant.tenantId, defId)
  }

  // ---- 實例(狀態機)----

  /* 送簽:建 pending 實例(記錄自此鎖定,§4.2)。同記錄已有進行中 → 409。 */
  async submit(
    tenant: TenantContext,
    formId: number,
    recordId: number,
    permissions: EffectivePermissions | undefined,
  ): Promise<ApprovalInstanceDto> {
    const active = await this.repo.getActiveInstance(tenant.tenantId, formId, recordId)
    if (active !== null) {
      throw new ConflictException({ code: "APPROVAL_IN_PROGRESS", message: "此記錄已在簽核中" })
    }
    const defs = await this.repo.listApprovalDefs(tenant.tenantId, formId)
    const def = defs.find((d) => d.active)
    if (def === undefined) {
      throw new BadRequestException({ code: "NO_APPROVAL_DEF", message: "此表單未設定簽核流程" })
    }
    /* 記錄範圍(#96 sweep):送簽者對這筆沒有可見權時直接擋 —— 送簽本質是對記錄動作 */
    const record = await this.records.getRecord(
      tenant.tenantId,
      formId,
      recordId,
      permissions,
      tenant.actorId,
    )
    const firstStep = nextActiveStep(def.steps, 0, record.values)
    if (firstStep === null) {
      throw new BadRequestException({
        code: "NO_ACTIVE_STEP",
        message: "依條件無任何簽核步驟啟用",
      })
    }
    const instance = await this.repo.createInstance({
      tenantId: tenant.tenantId,
      defId: def.id,
      formId,
      recordId,
      currentStep: firstStep.stepNo,
      submittedBy: tenant.actorId,
    })
    await this.repo.appendStepLog({
      tenantId: tenant.tenantId,
      instanceId: instance.id,
      stepNo: 0,
      actorId: tenant.actorId,
      decision: "submit",
    })
    /* H-1:通知該關卡的簽核者。**旁路呼叫,失敗不影響送簽**(非關鍵路徑)。
       這是本模組存在的理由 —— 簽核流程原本無任何機制告知下一關的人。 */
    await this.notifyStep(tenant, formId, recordId, firstStep.approverRoleId)
    return this.toInstanceDto(tenant, instance.id)
  }

  /* 簽核決策。gate:操作者須為 current step 之 approverRole 成員(角色閉包)。 */
  /* 🔴 OQ-AP2-9|簽核紀錄鏈完整性報告(21 CFR 11.10(e) 的「可偵測竄改」那一半)。

     **admin 限定**:斷點清單會透露哪些簽核實例存在、什麼時候被動過 ——
     那是內控資訊,不是一般使用者該看的。

     0021 已經做完防護層(no_mutate trigger + REVOKE + event trigger 擋 DROP),
     但它自己誠實寫著擋不住 superuser。這份報告是它明列的後續:
     擋不住不代表不能**證明**有沒有發生。 */
  async chainReport(
    tenant: TenantContext,
    permissions: EffectivePermissions | undefined,
  ): Promise<{ breaks: ApprovalChainBreak[]; checkedAt: string }> {
    if (permissions !== undefined && !permissions.isAdmin) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "簽核紀錄完整性報告限管理員檢視",
      })
    }
    return {
      breaks: await this.repo.chainBreaks(tenant.tenantId),
      checkedAt: new Date().toISOString(),
    }
  }

  async decide(
    tenant: TenantContext,
    instanceId: number,
    decision: "approve" | "reject",
    comment: string | undefined,
    permissions: EffectivePermissions | undefined,
  ): Promise<ApprovalInstanceDto> {
    const instance = await this.repo.getInstance(tenant.tenantId, instanceId)
    if (instance === null) {
      throw new NotFoundException({ code: "APPROVAL_NOT_FOUND", message: `instance ${instanceId}` })
    }
    if (instance.status !== "pending") {
      throw new ConflictException({ code: "APPROVAL_CLOSED", message: "此簽核已結束" })
    }
    const def = await this.repo.getApprovalDef(tenant.tenantId, instance.defId)
    if (def === null) {
      throw new NotFoundException({ code: "APPROVAL_DEF_NOT_FOUND", message: "def gone" })
    }
    const step = def.steps.find((s) => s.stepNo === instance.currentStep)
    if (step === undefined) {
      throw new ConflictException({ code: "APPROVAL_STEP_MISSING", message: "步驟定義遺失" })
    }
    const approver = await this.approverOf(tenant, step)
    if (!approver.allowed) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "非本步驟之簽核者" })
    }

    /* 🔴 禁止自簽(SOX checkpoint 明列「financial transactions 不得自簽」)。
       原本只驗「是否為該關角色成員」—— 送簽者若本身在該角色內,即可核准自己的單。
       superAdmin 亦不豁免:內控的意義正在於**沒有人可以自己批准自己**。 */
    if (instance.submittedBy !== null && instance.submittedBy === tenant.actorId) {
      throw new ForbiddenException({
        code: "SELF_APPROVAL_FORBIDDEN",
        message: "不得核准自己送出的單據,請改由其他簽核者處理",
      })
    }

    /* 🔴 駁回強制填理由 —— 退回重工與稽核都需要知道為什麼。核准則不強制。 */
    if (decision === "reject" && (comment === undefined || comment.trim() === "")) {
      throw new BadRequestException({
        code: "REJECT_REASON_REQUIRED",
        message: "駁回時必須填寫理由",
      })
    }

    await this.repo.appendStepLog({
      tenantId: tenant.tenantId,
      instanceId,
      stepNo: step.stepNo,
      actorId: tenant.actorId,
      /* 代理成立時記下被代理者 —— 只記「B 核准」的話,代理在事後完全看不見 */
      onBehalfOfActorId: approver.onBehalfOf,
      decision,
      comment,
    })

    if (decision === "reject") {
      const won = await this.repo.updateInstance(
        tenant.tenantId,
        instanceId,
        { status: "rejected" },
        { status: "pending", currentStep: step.stepNo },
      )
      if (!won) throw raceLost()
      await this.notifySubmitter(tenant, instance, NOTIFICATION_EVENTS.approvalRejected)
      return this.toInstanceDto(tenant, instanceId)
    }

    const record = await this.records.getRecord(
      tenant.tenantId,
      instance.formId,
      instance.recordId,
      permissions,
      tenant.actorId,
    )
    const next = nextActiveStep(def.steps, step.stepNo, record.values)
    if (next !== null) {
      const won = await this.repo.updateInstance(
        tenant.tenantId,
        instanceId,
        { currentStep: next.stepNo },
        { status: "pending", currentStep: step.stepNo },
      )
      if (!won) throw raceLost()
      await this.notifyStep(tenant, instance.formId, instance.recordId, next.approverRoleId)
      return this.toInstanceDto(tenant, instanceId)
    }

    /* 全部步驟通過 → 觸發 onComplete 按鈕,**成功後**才標 approved(F-6 M5)。
       簽核狀態(Tier-1 車道)與副作用(記錄 DML,app 車道)跨車道,無法同一 DB tx;
       改以「先副作用、後定案」+ 既有冪等 key(綁 instance)取代:
       副作用失敗 → 實例維持 pending,可重按核准;冪等 key 保證不會重複執行。
       反之(先標 approved)會產生「已核准但單據未動」且無法自動修復的狀態。 */
    if (def.onCompleteButtonId !== null) {
      await this.buttons.execute(
        tenant,
        instance.formId,
        instance.recordId,
        def.onCompleteButtonId,
        permissions,
        `approval:${instanceId}:complete`,
      )
    }
    /* 併發守衛置於副作用**之後** —— 前面的「先副作用後定案」設計不變:
       副作用由冪等 key 保護不會重複;此處只保證「定案」這一步不被競態重複寫。 */
    const won = await this.repo.updateInstance(
      tenant.tenantId,
      instanceId,
      { status: "approved" },
      { status: "pending", currentStep: step.stepNo },
    )
    if (!won) throw raceLost()

    /* 🔴 定案即固化(#113):把 lookup / rollup 的即時值寫成快照。
       否則主檔日後一改,**已核准單據的顯示內容會被靜默改寫** —— 不可觀察也不可修復
       (Odoo #23756 正是這個,2018 開至今 OPEN)。承 AGENTS 鐵則 4 傳票不可變。
       置於定案之後:凍結失敗不該讓已通過的簽核回退成 pending。 */
    await this.records.freezeComputed(
      tenant.tenantId,
      instance.formId,
      instance.recordId,
      "approval",
    )
    await this.notifySubmitter(tenant, instance, NOTIFICATION_EVENTS.approvalApproved)
    return this.toInstanceDto(tenant, instanceId)
  }

  /* 撤回(送簽者本人或 admin)→ 解鎖記錄 */
  async withdraw(tenant: TenantContext, instanceId: number): Promise<ApprovalInstanceDto> {
    const instance = await this.repo.getInstance(tenant.tenantId, instanceId)
    if (instance === null || instance.status !== "pending") {
      throw new NotFoundException({ code: "APPROVAL_NOT_FOUND", message: "無進行中簽核" })
    }
    const isAdmin =
      tenant.isSuperAdmin === true ||
      (await this.authz.isAdminActor(tenant.tenantId, tenant.actorId))
    if (instance.submittedBy !== tenant.actorId && !isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "僅送簽者或管理員可撤回" })
    }
    await this.repo.appendStepLog({
      tenantId: tenant.tenantId,
      instanceId,
      stepNo: instance.currentStep,
      actorId: tenant.actorId,
      decision: "withdraw",
    })
    const won = await this.repo.updateInstance(
      tenant.tenantId,
      instanceId,
      { status: "withdrawn" },
      { status: "pending" },
    )
    if (!won) throw raceLost()
    return this.toInstanceDto(tenant, instanceId)
  }

  async getForRecord(
    tenant: TenantContext,
    formId: number,
    recordId: number,
  ): Promise<ApprovalInstanceDto | null> {
    const instance = await this.repo.getLatestInstance(tenant.tenantId, formId, recordId)
    if (instance === null) return null
    return this.toInstanceDto(tenant, instance.id)
  }

  /* 我的待簽:pending 實例中,當前步簽核角色 ∈ 我的角色閉包 */
  /* 🔴 待簽匣必須含**代理來的**單據。少了這段,代理人「簽得了但找不到」——
     API 放行、畫面上卻沒有那一筆,等於代理功能只做了一半。 */
  async listMyPending(tenant: TenantContext): Promise<ApprovalInstanceDto[]> {
    const instances = await this.repo.listPendingInstances(tenant.tenantId)
    if (instances.length === 0) return []
    const roleIds = new Set(await this.authz.resolveActorRoleIds(tenant.tenantId, tenant.actorId))
    for (const principal of await this.delegates.activeDelegatorsOf(
      tenant.tenantId,
      tenant.actorId,
    )) {
      for (const r of await this.authz.resolveActorRoleIds(tenant.tenantId, principal)) {
        roleIds.add(r)
      }
    }
    const out: ApprovalInstanceDto[] = []
    for (const inst of instances) {
      const def = await this.repo.getApprovalDef(tenant.tenantId, inst.defId)
      const step = def?.steps.find((s) => s.stepNo === inst.currentStep)
      if (step === undefined) continue
      if (tenant.isSuperAdmin === true || roleIds.has(step.approverRoleId)) {
        out.push(await this.toInstanceDto(tenant, inst.id))
      }
    }
    return out
  }

  /* 待簽通知:收件人 = 該關卡 approverRole 的成員。
     簽核類事件不受訂閱層級管(specs.isApprovalEvent)—— 層級管的是「旁觀資訊要收多少」,
     而簽核是**指名要你做事**。 */
  private async notifyStep(
    tenant: TenantContext,
    formId: number,
    recordId: number,
    approverRoleId: number,
  ): Promise<void> {
    const approvers = await this.authz.listRoleMembers(tenant.tenantId, approverRoleId)
    /* 代理人也要收到 —— Ragic 的設定名稱就叫「啟用及**通知**代理人」。
       通知不到的話,代理人得自己想到去翻待簽匣,而請假期間沒有人會這樣做。 */
    const withDelegates = new Set([
      ...approvers,
      ...(await this.delegates.activeDelegatesFor(tenant.tenantId, approvers)),
    ])
    await this.notify.emit({
      tenantId: tenant.tenantId,
      event: NOTIFICATION_EVENTS.approvalPending,
      formId,
      recordId,
      actorId: tenant.actorId,
      recipientActorIds: [...withDelegates],
    })
  }

  /* 結果通知送回送簽者。 */
  private async notifySubmitter(
    tenant: TenantContext,
    instance: { formId: number; recordId: number; submittedBy: number | null },
    event: string,
  ): Promise<void> {
    if (instance.submittedBy === null) return
    await this.notify.emit({
      tenantId: tenant.tenantId,
      event,
      formId: instance.formId,
      recordId: instance.recordId,
      actorId: tenant.actorId,
      recipientActorIds: [instance.submittedBy],
    })
  }

  /* 🔴 是否可簽。回傳 `onBehalfOf` —— 代理成立時要指名代的是誰,
     否則稽核只看得到「B 核准」而答不出「他有什麼權?」

     順序有意義:**先看本人**。若本人就在該關角色內,那是親自核准不是代理,
     不該在日誌裡誤記成代理行為。 */
  private async approverOf(
    tenant: TenantContext,
    step: ApprovalStep,
  ): Promise<{ allowed: boolean; onBehalfOf: number | null }> {
    if (tenant.isSuperAdmin === true) return { allowed: true, onBehalfOf: null }
    const roleIds = await this.authz.resolveActorRoleIds(tenant.tenantId, tenant.actorId)
    if (roleIds.includes(step.approverRoleId)) return { allowed: true, onBehalfOf: null }

    /* 代理:操作者是某人的有效代理,而**那個人**在該關角色內。
       🔴 **只查一層,不遞移** —— A 代 B、B 代 C 不使 A 得到 C 的簽核權。
       代理鏈會讓實際權限無人能一眼算出,那正是內控最怕的東西。 */
    const principals = await this.delegates.activeDelegatorsOf(tenant.tenantId, tenant.actorId)
    for (const principal of principals) {
      const theirRoles = await this.authz.resolveActorRoleIds(tenant.tenantId, principal)
      if (theirRoles.includes(step.approverRoleId)) return { allowed: true, onBehalfOf: principal }
    }
    return { allowed: false, onBehalfOf: null }
  }

  private async toInstanceDto(
    tenant: TenantContext,
    instanceId: number,
  ): Promise<ApprovalInstanceDto> {
    const instance = await this.repo.getInstance(tenant.tenantId, instanceId)
    if (instance === null) {
      throw new NotFoundException({ code: "APPROVAL_NOT_FOUND", message: `instance ${instanceId}` })
    }
    const def = await this.repo.getApprovalDef(tenant.tenantId, instance.defId)
    const log = await this.repo.listStepLogs(tenant.tenantId, instanceId)
    return {
      id: instance.id,
      defId: instance.defId,
      formId: instance.formId,
      recordId: instance.recordId,
      currentStep: instance.currentStep,
      status: instance.status,
      submittedBy: instance.submittedBy,
      updatedAt: instance.updatedAt.toISOString(),
      steps: def?.steps ?? [],
      log,
    }
  }
}

/* 下一個「啟用」步驟:序號 > afterStep 且條件成立者之最小步。
   條件由結構化 config 確定性組成 ZEN 表達式(非使用者任意字串);評估失敗 → 視為不啟用(fail-closed)。 */
function nextActiveStep(
  steps: readonly ApprovalStep[],
  afterStep: number,
  values: Record<string, unknown>,
): ApprovalStep | null {
  const ordered = [...steps].sort((a, b) => a.stepNo - b.stepNo)
  for (const step of ordered) {
    if (step.stepNo <= afterStep) continue
    if (stepEnabled(step, values)) return step
  }
  return null
}

function stepEnabled(step: ApprovalStep, values: Record<string, unknown>): boolean {
  if (step.amountField === undefined || step.minAmount === undefined) return true
  const raw = values[step.amountField]
  const amount = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(amount)) return false
  try {
    // ZEN 表達式(OQ-AA-4):amount >= minAmount;參數以 context 傳入,不字串拼接值
    return (
      evaluateExpressionSync("amount >= threshold", {
        amount,
        threshold: step.minAmount,
      }) === true
    )
  } catch {
    return false // fail-closed
  }
}

function toDefDto(row: ApprovalDefRow): ApprovalDefDto {
  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    steps: row.steps,
    onCompleteButtonId: row.onCompleteButtonId,
    active: row.active,
  }
}

/* 併發守衛落敗 —— 另一位簽核者已搶先改變狀態。
   回 409 而非靜默成功:讓 client 重新載入實際狀態,避免兩人都以為自己簽成了。 */
function raceLost(): ConflictException {
  return new ConflictException({
    code: "APPROVAL_RACE_LOST",
    message: "此簽核已由其他人處理,請重新載入",
  })
}
