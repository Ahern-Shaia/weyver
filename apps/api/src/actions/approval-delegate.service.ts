import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common"
import type { TenantContext } from "../http/tenant-context.js"
import { ApprovalDelegateRepository, type DelegateRow } from "./approval-delegate.repository.js"

/* #104 簽核代理人。

   ## 為什麼自助設定,而不是只有 admin 能設

   代理的觸發事件是「我要請假」—— 那件事只有本人事先知道。做成 admin 專屬的話,
   每次請假都要先找管理員,結果就是沒人設,單據照樣卡住。
   Ragic 的「代理人」與 Salesforce 的 Delegated Approver 都掛在使用者自己的設定上。

   ## 但 admin 仍能代設 —— 因為最需要代理的是「人突然不在」

   SAP 把代理分成計畫性(請假,本人事先設)與非計畫性(突發,由他人設)。
   只做自助的話,人一出事就沒有任何人能補設,而那正是最該有代理的時候。
   故 `principalActorId` 可指定他人,但**限租戶 admin**。 */

export interface DelegateDto {
  readonly id: number
  readonly principalActorId: number
  readonly delegateActorId: number
  readonly startsAt: string
  readonly endsAt: string | null
  readonly active: boolean
}

const toDto = (row: DelegateRow, now: number): DelegateDto => ({
  id: row.id,
  principalActorId: row.principalActorId,
  delegateActorId: row.delegateActorId,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt === null ? null : row.endsAt.toISOString(),
  active: row.startsAt.getTime() <= now && (row.endsAt === null || row.endsAt.getTime() > now),
})

@Injectable()
export class ApprovalDelegateService {
  constructor(
    @Inject(ApprovalDelegateRepository) private readonly repo: ApprovalDelegateRepository,
  ) {}

  /* 兩個方向都回:我交出去的 + 我背在身上的。少了後者,代理人會不知道
     簽核匣裡為什麼多出別人的單。

     一併回 `actorId` —— 前端要知道「我是誰」才能在挑選代理人時把自己排除;
     web 目前沒有任何管道拿得到 actorId(session 只有 auth user)。 */
  async listMine(
    tenant: TenantContext,
  ): Promise<{ actorId: number; granted: DelegateDto[]; received: DelegateDto[] }> {
    const now = Date.now()
    const [granted, received] = await Promise.all([
      this.repo.listByPrincipal(tenant.tenantId, tenant.actorId),
      this.repo.listByDelegate(tenant.tenantId, tenant.actorId),
    ])
    return {
      actorId: tenant.actorId,
      granted: granted.map((r) => toDto(r, now)),
      received: received.map((r) => toDto(r, now)),
    }
  }

  async create(
    tenant: TenantContext,
    isAdmin: boolean,
    input: {
      delegateActorId: number
      principalActorId?: number | undefined
      startsAt?: string | undefined
      endsAt?: string | undefined
    },
  ): Promise<DelegateDto> {
    const principal = input.principalActorId ?? tenant.actorId
    if (principal !== tenant.actorId && !isAdmin) {
      throw new ForbiddenException({
        code: "DELEGATE_FORBIDDEN",
        message: "只能設定自己的代理人",
      })
    }
    /* DB 也有 CHECK。這裡再擋一次是為了給人看得懂的訊息,而不是 23514 約束違反 */
    if (principal === input.delegateActorId) {
      throw new BadRequestException({
        code: "DELEGATE_SELF",
        message: "代理人不可以是本人",
      })
    }
    const startsAt = input.startsAt === undefined ? null : new Date(input.startsAt)
    const endsAt = input.endsAt === undefined ? null : new Date(input.endsAt)
    if (endsAt !== null && endsAt.getTime() <= (startsAt?.getTime() ?? Date.now())) {
      throw new BadRequestException({
        code: "DELEGATE_RANGE",
        message: "結束時間必須晚於開始時間",
      })
    }
    const row = await this.repo.create({
      tenantId: tenant.tenantId,
      principalActorId: principal,
      delegateActorId: input.delegateActorId,
      startsAt,
      endsAt,
      createdByActorId: tenant.actorId,
    })
    return toDto(row, Date.now())
  }

  /* 🔴 刪除只認**被代理者本人**(或 admin)—— 代理人不得自行解除,
     否則「我幫你簽」變成「我決定要不要幫你簽」,授權的一端不在授權者手上。 */
  async revoke(tenant: TenantContext, isAdmin: boolean, id: number): Promise<void> {
    const row = await this.repo.getById(tenant.tenantId, id)
    if (row === null) return
    if (row.principalActorId !== tenant.actorId && !isAdmin) {
      throw new ForbiddenException({
        code: "DELEGATE_FORBIDDEN",
        message: "只能取消自己設定的代理",
      })
    }
    await this.repo.delete(tenant.tenantId, id)
  }
}
