import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { AuthzRepository } from "../authz/authz.repository.js"
import { RecordNotFoundError } from "../form-engine/errors.js"
import { RecordService } from "../form-engine/records/record.service.js"
import type { TenantContext } from "../http/tenant-context.js"
import { NOTIFICATION_EVENTS } from "../notifications/notification-specs.js"
import { NotificationService } from "../notifications/notification.service.js"
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
   金額條件由結構化 config(`amountField` / `minAmount`)直接比較 —— 2026-08-03 稽核移除 ZEN,見 `stepEnabled`。
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
    /* 🔴 OQ-AP2-2|**送簽當下就把每一關解析一遍**,解析不出人就擋在這裡。
       Salesforce 是等簽核人回應時才炸,那時單子已經走到一半、申請人早就以為送出去了。 */
    await this.assertResolvable(tenant.tenantId, def.steps, tenant.actorId, {
      formId,
      recordId,
    })

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
    await this.notifyStep(tenant, formId, recordId, firstStep.approverRoleId ?? null)
    return this.toInstanceDto(tenant, instance.id)
  }

  /* 簽核決策。gate:操作者須為 current step 之 approverRole 成員(角色閉包)。 */
  /* 🔴 OQ-AP2-6/7/8|退回到指定關。

     與 reject 刻意分開:reject 是「這件事不成立」,return 是「改一改再來」——
     後續動作、通知對象、稽核意義都不同,擠成同一個型別事後就分不出來。

     **可退任意先前關卡,並可逐關以 `returnableTo` 收窄**(Kissflow 形態)。
     只能退一關(Salesforce)對多關流程不夠用:第 4 關發現第 1 關填錯,
     退給第 3 關的人毫無意義。

     **退回後由該關重新解析簽核人**(OQ-AP2-7 = B),不指名原簽核人 ——
     指名原簽核人在「那個人已離職」時直接卡死,而那正是我們要避免的形態。

     **從目標關往後全部重簽**(OQ-AP2-8 = A):由 `approversWhoApproved` 只算
     最後一次退回之後的核准來達成,不另存「這一輪誰簽過」的狀態。
     業界無人做「只重簽受影響關卡」,連 Kissflow 都只能承認這是痛點。 */
  async returnTo(
    tenant: TenantContext,
    instanceId: number,
    targetStep: number,
    comment: string,
  ): Promise<ApprovalInstanceDto> {
    const instance = await this.repo.getInstance(tenant.tenantId, instanceId)
    if (instance === null) {
      throw new NotFoundException({ code: "APPROVAL_NOT_FOUND", message: `instance ${instanceId}` })
    }
    if (instance.status !== "pending") {
      throw new ConflictException({ code: "APPROVAL_CLOSED", message: "此簽核已結束" })
    }
    const def = await this.repo.getApprovalDef(tenant.tenantId, instance.defId)
    const step = def?.steps.find((s) => s.stepNo === instance.currentStep)
    if (step === undefined) {
      throw new ConflictException({ code: "APPROVAL_STEP_MISSING", message: "步驟定義遺失" })
    }
    const me = await this.approverOf(tenant, step, {
      submittedBy: instance.submittedBy,
      instanceId,
      record: { formId: instance.formId, recordId: instance.recordId },
    })
    if (!me.allowed) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "非本步驟之簽核者" })
    }
    if (targetStep >= instance.currentStep || targetStep < 1) {
      throw new UnprocessableEntityException({
        code: "INVALID_RETURN_TARGET",
        message: "只能退回到目前關卡之前的關卡",
      })
    }
    /* 未設 `returnableTo` = 可退所有先前關卡(Kissflow:「When you disable this
       option, items can be sent to all preceding steps.」) */
    if (step.returnableTo !== undefined && !step.returnableTo.includes(targetStep)) {
      throw new UnprocessableEntityException({
        code: "RETURN_TARGET_NOT_ALLOWED",
        message: `本關只能退回到第 ${step.returnableTo.join("、")} 關`,
      })
    }
    /* 同 reject:退回一定要說為什麼,否則收到單子的人不知道要改什麼 */
    if (comment.trim() === "") {
      throw new BadRequestException({
        code: "RETURN_REASON_REQUIRED",
        message: "退回時必須填寫理由",
      })
    }

    await this.repo.appendStepLog({
      tenantId: tenant.tenantId,
      instanceId,
      stepNo: step.stepNo,
      actorId: tenant.actorId,
      onBehalfOfActorId: me.onBehalfOf,
      decision: "return",
      comment,
    })
    const won = await this.repo.updateInstance(
      tenant.tenantId,
      instanceId,
      { currentStep: targetStep },
      { status: "pending", currentStep: step.stepNo },
    )
    if (!won) throw raceLost()

    const target = def?.steps.find((s) => s.stepNo === targetStep)
    await this.notifyStep(
      tenant,
      instance.formId,
      instance.recordId,
      target?.approverRoleId ?? null,
    )
    return this.toInstanceDto(tenant, instanceId)
  }

  /* 🔴 OQ-AP2-10|管理員強制解鎖。**與 withdraw 不同**:withdraw 把整個簽核作廢、
     要從頭送過,連帶丟掉已簽關卡的稽核意義;解鎖是「簽核照跑,但這筆暫時可以改」。

     對應 Salesforce 的 Unlock action。沒有它,簽核人一離職記錄就永久鎖死,
     而唯一的解是作廢重來。**不可逆且必須留痕** —— 解鎖是繞過內控的動作,
     寫進 append-only log(且已串進 hash chain)。 */
  async unlockRecord(
    tenant: TenantContext,
    instanceId: number,
    comment: string,
  ): Promise<ApprovalInstanceDto> {
    const isAdmin =
      tenant.isSuperAdmin === true ||
      (await this.authz.isAdminActor(tenant.tenantId, tenant.actorId))
    if (!isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "僅管理員可強制解鎖" })
    }
    const instance = await this.repo.getInstance(tenant.tenantId, instanceId)
    if (instance === null || instance.status !== "pending") {
      throw new NotFoundException({ code: "APPROVAL_NOT_FOUND", message: "無進行中簽核" })
    }
    if (comment.trim() === "") {
      throw new BadRequestException({
        code: "UNLOCK_REASON_REQUIRED",
        message: "強制解鎖必須填寫理由 —— 這是繞過內控的動作",
      })
    }
    await this.repo.appendStepLog({
      tenantId: tenant.tenantId,
      instanceId,
      stepNo: instance.currentStep,
      actorId: tenant.actorId,
      decision: "unlock",
      comment,
    })
    await this.repo.markUnlocked(tenant.tenantId, instanceId, tenant.actorId)
    return this.toInstanceDto(tenant, instanceId)
  }

  /* 🔴 OQ-AP2-5 = B|臨時加簽(Ragic 三種之中的「同一階增加新的簽核人」)。

     **只做這一種**:另外兩種(向前 / 向後加簽)會在執行期插入關卡,而 ServiceNow
     社群對此有明確警告 ——「approvals aren't really designed to be added manually
     in this way」,手動加的 approval 不會正確反應 rejection。同關加人只是擴充
     這一關的 N-of-M 成員集合,那個結構本來就有,零額外狀態機風險。

     ⚠️ **加簽會放寬這一關的簽核圈**,所以三件事一起做:限現任簽核人才能加、
     被加的人不得是送簽者(否則加簽變成自簽的後門)、整件事寫進 append-only log。 */
  async addApprover(
    tenant: TenantContext,
    instanceId: number,
    targetActorId: number,
  ): Promise<ApprovalInstanceDto> {
    const instance = await this.repo.getInstance(tenant.tenantId, instanceId)
    if (instance === null) {
      throw new NotFoundException({ code: "APPROVAL_NOT_FOUND", message: `instance ${instanceId}` })
    }
    if (instance.status !== "pending") {
      throw new ConflictException({ code: "APPROVAL_CLOSED", message: "此簽核已結束" })
    }
    const def = await this.repo.getApprovalDef(tenant.tenantId, instance.defId)
    const step = def?.steps.find((s) => s.stepNo === instance.currentStep)
    if (step === undefined) {
      throw new ConflictException({ code: "APPROVAL_STEP_MISSING", message: "步驟定義遺失" })
    }
    /* 只有這一關現在簽得了的人才能加人 —— 否則任何人都能把自己的同夥塞進任何一關 */
    const me = await this.approverOf(tenant, step, {
      submittedBy: instance.submittedBy,
      instanceId,
      record: { formId: instance.formId, recordId: instance.recordId },
    })
    /* 🔴 OQ-AP2-10 之第三條逃生路徑:**管理員可改派** ——
       原簽核人離職時,admin 把單子加給接手的人,不必作廢整個簽核重送。 */
    const isAdmin =
      tenant.isSuperAdmin === true ||
      (await this.authz.isAdminActor(tenant.tenantId, tenant.actorId))
    if (!me.allowed && !isAdmin) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "只有本關的簽核人或管理員可以加簽",
      })
    }
    if (instance.submittedBy !== null && targetActorId === instance.submittedBy) {
      throw new UnprocessableEntityException({
        code: "SELF_APPROVAL_FORBIDDEN",
        message: "不得把送簽者本人加為簽核人 —— 那等於繞過自簽禁令",
      })
    }
    await this.repo.appendStepLog({
      tenantId: tenant.tenantId,
      instanceId,
      stepNo: step.stepNo,
      /* actorId = 被加的人;addedBy = 加人的人。分開存,事後才看得出是誰擴大了簽核圈 */
      actorId: targetActorId,
      addedByActorId: tenant.actorId,
      decision: "addApprover",
    })
    return this.toInstanceDto(tenant, instanceId)
  }

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
    const approver = await this.approverOf(tenant, step, {
      submittedBy: instance.submittedBy,
      instanceId,
      record: { formId: instance.formId, recordId: instance.recordId },
    })
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

    /* 🔴 OQ-AP2-3|會簽 / 擇辦。**達標與否由 log 推導**,不另存計數欄 ——
       計數欄與 log 是兩份真相,遲早分岔,而 log 是 append-only 的那一份。

       未填 = 任一人(既有行為);`"all"` = 全體。「全體」取**解析後的實際人數**
       而非設定裡的某個數字 —— 動態簽核人下,那一關有幾個人要到執行期才知道。 */
    const eligible = await this.effectiveApprovers(tenant.tenantId, step, instance)
    const approvedBy = await this.repo.approversWhoApproved(
      tenant.tenantId,
      instanceId,
      step.stepNo,
    )
    /* 未填 = 任一人(既有行為);"all" = 全體(人數到執行期才知道,故取解析後的實際人數) */
    const required =
      step.quorum === undefined
        ? 1
        : step.quorum === "all"
          ? Math.max(1, eligible.length)
          : step.quorum
    if (approvedBy.length < required) {
      /* 還沒到門檻 → 這一關留在原地,不推進也不算完成。
         回傳目前狀態讓畫面顯示「3 人中已有 1 人核准」。 */
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
      await this.notifyStep(tenant, instance.formId, instance.recordId, next.approverRoleId ?? null)
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
      /* 靜態關卡沿用角色比對(便宜);動態關卡必須真的解析一次 ——
         否則「送給直屬主管」的單子永遠不會出現在主管的待簽匣裡。 */
      const mine =
        tenant.isSuperAdmin === true ||
        (step.approverRule === "role"
          ? step.approverRoleId !== undefined && roleIds.has(step.approverRoleId)
          : (
              await this.resolveApprovers(tenant.tenantId, step, {
                submittedBy: inst.submittedBy,
                instanceId: inst.id,
                record: { formId: inst.formId, recordId: inst.recordId },
              })
            ).includes(tenant.actorId))
      if (mine) {
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
    approverRoleId: number | null,
  ): Promise<void> {
    /* 動態關卡沒有靜態角色 —— 通知對象由呼叫端另行解析後傳入。
       這裡拿 null 就代表「這一關的收件人不是一個角色」,直接跳過角色查詢。 */
    if (approverRoleId === null) return
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
  /* 🔴 OQ-AP2-1 / OQ-AP2-2|把一個關卡解析成**實際的簽核人集合**。

     動態規則(直屬主管 / 主管的主管 / 前一簽核人的主管)在此展開;
     `role` 維持既有行為。回空集合 = 這一關現在沒有人簽得了。

     **解析失敗一律硬失敗**(OQ-AP2-2 = A)。業界一致如此,沒有人做 fallback:
     Salesforce 直接報錯、SAP 卡在 "No agent found"。但 Salesforce 是**在簽核人
     回應時**才炸(離職與空值同等對待),那時單子已經走到一半、申請人早就以為送出去了
     —— 所以我方改在**送簽當下就解析全部關卡並擋下**(見 `assertResolvable`)。 */
  /* 🔴 **真的簽得了這一關的人** = 解析出的簽核人 **扣掉送簽者**。

     送簽者永遠不能核准自己的單(SOX 自簽禁令),所以把他算進「全體同意」的分母
     會讓那一關**永遠不可能通過** —— 瀏覽器實走時就撞到:角色 3 人、其中一人是
     送簽者,畫面停在 2/3 然後永遠卡住,而且沒有任何錯誤訊息。 */
  private async effectiveApprovers(
    tenantId: number,
    step: ApprovalStep,
    instance: { id: number; submittedBy: number; formId: number; recordId: number },
  ): Promise<number[]> {
    const all = await this.resolveApprovers(tenantId, step, {
      submittedBy: instance.submittedBy,
      instanceId: instance.id,
      record: { formId: instance.formId, recordId: instance.recordId },
    })
    return all.filter((a) => a !== instance.submittedBy)
  }

  private async resolveApprovers(
    tenantId: number,
    step: ApprovalStep,
    ctx: {
      submittedBy: number | null
      instanceId: number | null
      /* `fieldRef` 需要讀這筆記錄的欄位值;其餘規則用不到,故為選配 */
      record?: { formId: number; recordId: number } | undefined
    },
  ): Promise<number[]> {
    const base = await this.baseApprovers(tenantId, step, ctx)
    if (ctx.instanceId === null) return base
    /* 臨時加簽的人與原本的簽核人是同一個集合 —— 加簽的語意就是「這一關多一個人能簽」 */
    const adhoc = await this.repo.adhocApproversOf(tenantId, ctx.instanceId, step.stepNo)
    return [...new Set([...base, ...adhoc])]
  }

  private async baseApprovers(
    tenantId: number,
    step: ApprovalStep,
    ctx: {
      submittedBy: number | null
      instanceId: number | null
      /* `fieldRef` 需要讀這筆記錄的欄位值;其餘規則用不到,故為選配 */
      record?: { formId: number; recordId: number } | undefined
    },
  ): Promise<number[]> {
    switch (step.approverRule) {
      case "role":
        return step.approverRoleId === undefined
          ? []
          : this.repo.actorsInRole(tenantId, step.approverRoleId)
      case "manager":
        return ctx.submittedBy === null ? [] : this.repo.managersOf(tenantId, ctx.submittedBy, 1)
      case "managerOfManager":
        return ctx.submittedBy === null ? [] : this.repo.managersOf(tenantId, ctx.submittedBy, 2)
      case "managerOfPrevApprover": {
        if (ctx.instanceId === null) return []
        const prev = await this.repo.lastDecider(tenantId, ctx.instanceId)
        return prev === null ? [] : this.repo.managersOf(tenantId, prev, 1)
      }
      /* 🔴 OQ-AP2-9 = C|讀這筆記錄上指定 member 欄位的值。

         **系統層讀取,不帶呼叫者的權限** —— 簽核人是誰不該因為「誰在問」而改變;
         若帶呼叫者權限,一個看不到該欄的人會得到「這關沒人能簽」,那是錯的答案。

         欄位不存在 / 被改成非 member 型別 / 值為空 → 回空陣列,
         由 `assertResolvable` 在**送簽當下**擋下並指名是哪一關。
         **絕不靜默跳過該關** —— 跳過一關簽核是權限事故,不是體驗問題。 */
      case "fieldRef": {
        if (step.approverField === undefined || ctx.record === undefined) return []
        /* 記錄被刪 / 表單被刪 → 這一關解析不出人,由 assertResolvable 擋。
           **只吞 NotFound,不吞其他例外** —— 一律 catch 會把真正的故障
           偽裝成「這關沒人能簽」,而那是查不出來的那種錯。 */
        const record = await this.records
          .getRecord(tenantId, ctx.record.formId, ctx.record.recordId)
          .catch((e: unknown) => {
            if (e instanceof RecordNotFoundError) return null
            throw e
          })
        /* 🔴 `member` 欄存的是 `bigint`,而 pg 的 int8 **預設回字串**。
           原本只收 `typeof raw === "number"` → 永遠解析不出人,
           而且型別檢查與單元測試都不會抱怨(真 PG 整合測試才抓得到)。 */
        const raw = record?.values[step.approverField]
        const id = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN
        return Number.isInteger(id) && id > 0 ? [id] : []
      }
      default:
        return []
    }
  }

  /* 送簽當下就把每一關解析一遍,解析不出人就擋 —— 不讓單子走到一半才發現沒人能簽。
     訊息要指名是哪一關、為什麼:「第 2 關找不到簽核人」比「送簽失敗」有用得多。 */
  private async assertResolvable(
    tenantId: number,
    steps: readonly ApprovalStep[],
    submittedBy: number,
    record: { formId: number; recordId: number },
  ): Promise<void> {
    for (const step of steps) {
      if (step.approverRule === "managerOfPrevApprover") continue // 依賴執行期,送簽時無從解析
      const actors = await this.resolveApprovers(tenantId, step, {
        submittedBy,
        instanceId: null,
        record,
      })
      const usable = actors.filter((a) => a !== submittedBy)
      if (usable.length === 0) {
        throw new UnprocessableEntityException({
          code: "APPROVER_UNRESOLVED",
          message:
            actors.length === 0
              ? `第 ${String(step.stepNo)} 關找不到簽核人,請先確認該關的角色有成員、或申請人已設有主管`
              : /* 唯一人選就是送簽者本人 —— 比照 Odoo Exclusive Approval 明確擋下,
                   不靜默跳關(跳關等於這一關的內控從未發生過) */
                `第 ${String(step.stepNo)} 關唯一可簽的人就是送簽者本人,不得自簽;請調整簽核設定`,
        })
      }
    }
  }

  private async approverOf(
    tenant: TenantContext,
    step: ApprovalStep,
    ctx: {
      submittedBy: number | null
      instanceId: number | null
      /* `fieldRef` 需要讀這筆記錄的欄位值;其餘規則用不到,故為選配 */
      record?: { formId: number; recordId: number } | undefined
    },
  ): Promise<{ allowed: boolean; onBehalfOf: number | null }> {
    if (tenant.isSuperAdmin === true) return { allowed: true, onBehalfOf: null }
    const eligible = new Set(await this.resolveApprovers(tenant.tenantId, step, ctx))
    if (eligible.has(tenant.actorId)) return { allowed: true, onBehalfOf: null }

    /* 代理:操作者是某人的有效代理,而**那個人**在該關角色內。
       🔴 **只查一層,不遞移** —— A 代 B、B 代 C 不使 A 得到 C 的簽核權。
       代理鏈會讓實際權限無人能一眼算出,那正是內控最怕的東西。 */
    const principals = await this.delegates.activeDelegatorsOf(tenant.tenantId, tenant.actorId)
    for (const principal of principals) {
      if (eligible.has(principal)) return { allowed: true, onBehalfOf: principal }
    }
    return { allowed: false, onBehalfOf: null }
  }

  /* 🔴 會簽進度「已 N / 需 M」。**在後端算**,不讓前端從 log 推導 ——
     推導要重現「只算最後一次退回之後的核准」那條規則,等於兩份實作,遲早分岔
     (而分岔的表現會是「畫面說 2/2 了卻還沒過關」這種沒人查得出來的事)。 */
  private async stepProgress(
    tenantId: number,
    instance: {
      id: number
      currentStep: number
      status: string
      submittedBy: number
      formId: number
      recordId: number
    },
    steps: readonly ApprovalStep[],
  ): Promise<{ approved: number; required: number }> {
    const step = steps.find((s) => s.stepNo === instance.currentStep)
    if (step === undefined || instance.status !== "pending") return { approved: 0, required: 0 }
    const eligible = await this.effectiveApprovers(tenantId, step, instance)
    const approved = await this.repo.approversWhoApproved(tenantId, instance.id, step.stepNo)
    const required =
      step.quorum === undefined
        ? 1
        : step.quorum === "all"
          ? Math.max(1, eligible.length)
          : step.quorum
    return { approved: approved.length, required }
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
      unlockedAt: instance.unlockedAt === null ? null : instance.unlockedAt.toISOString(),
      stepProgress: await this.stepProgress(tenant.tenantId, instance, def?.steps ?? []),
      updatedAt: instance.updatedAt.toISOString(),
      steps: def?.steps ?? [],
      log,
    }
  }
}

/* 下一個「啟用」步驟:序號 > afterStep 且條件成立者之最小步。
   條件來自結構化 config(`amountField` / `minAmount`),非使用者任意字串。 */
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
  /* 🔴 2026-08-03 稽核:此處原本呼叫 `evaluateExpressionSync("amount >= threshold", …)`。
     那個表達式是**寫死的字串常量**,兩個運算元在上面幾行已經是驗證過的 `number` ——
     為了一個 `>=` 背了 `@gorules/zen-engine` 與每平台 10MB 的原生二進位。
     原本的 try/catch fail-closed 也只是因為 ZEN 會 throw,直接比較不會。

     **這不是放棄 docs/20 選 ZEN 的決策**:那個決策要的是它的 no-code 決策表編輯器
     (docs/04 v2.4 列 R1「C ZEN 規則編輯器」3 人月,尚未動工),而編輯器產出的 JDM
     確實需要 `ZenEngine` 執行。**要用的時候再裝回來是一行的事**,在那之前不需要
     為未來的能力先付原生相依的供應鏈與映像檔成本(AGENTS 供應鏈鐵則)。 */
  return amount >= step.minAmount
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
