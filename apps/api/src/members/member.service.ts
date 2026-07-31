import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common"
import { and, eq, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../db/db.module.js"
import { memberStates, initialCredentials, users } from "../db/schema.js"
import { generateInitialPassword, initialPasswordExpiry } from "./initial-password.js"

/* 🔴 R1·A-1 M2|使用者管理(OQ-SC-13=A 管理員建帳號 + 系統產生一次性初始密碼)。

   ## 為什麼不是邀請信

   Ragic **兩條路都有**(認證信 + 「隨機產生 10 碼」),故「管理員建帳號」不是
   偏離 parity 的權宜。而邀請信在本專案卡死:`requireEmailVerificationOnInvitation`
   已設 true(#99 修 CVE-2026-53514),但 `sendVerificationEmail` 從未實作
   → **邀請永遠無法被接受**。邀請信列為殘留。

   ⚠️ 曾誤以為「改用管理員自行轉發邀請連結」可繞過該前提。讀 Better Auth 1.6.23
   `crud-invites.mjs` 後**不成立**:驗證檢核依旗標判定、與連結怎麼送達無關。

   ## 停權 = 擋進入該租戶,不是擋登入(OQ-SC-17 之修正)

   一個帳號可屬多個 org;甲公司停權若擋掉登入,會連帶讓他進不了乙公司。
   故停權逐成員(tenant × actor),由 AuthGuard 在**逐請求重驗成員資格**的同一處執法
   —— 與 #97「不驗 = 移除成員形同 no-op」同一個理由。 */

export interface MemberRow {
  readonly actorId: number
  readonly email: string
  readonly name: string | null
  readonly status: "active" | "suspended"
  /* 尚未使用初始密碼者 = 「未啟用」。UI 要說得出這個狀態,
     否則管理員不知道對方到底登入過沒有(Ragic 的成員頁也有這一欄)。 */
  readonly credential: "pending" | "expired" | "set"
}

export interface CreatedMember {
  readonly actorId: number
  readonly email: string
  /* 🔴 明文**只在這一次回傳**,不落任何日誌、不再查得到 */
  readonly initialPassword: string
  readonly expiresAt: Date
}

@Injectable()
export class MemberService {
  constructor(
    @Inject(TenantDb) private readonly tdb: TenantDb,
    /* 建帳號需要跨租戶讀寫 Better Auth 的表與 initial_credential(無 RLS),
       故另取特權 drizzle;租戶範疇的讀寫一律走 tdb。 */
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  /* 🔴 兩條車道各取所長,刻意不合成一個 join:

     · `users` / `initial_credential` 走**特權車道** —— `weyver_app` 對 `users`
       完全無權限,而 metadata / authz / notifications 等既有服務也都是這樣讀它。
       為了這個清單去開 app 車道對全域 `users` 的 SELECT,等於為單一功能放寬
       一張跨租戶表的存取面。範圍由呼叫端傳進來的 `memberActorIds` 界定
       —— 那份清單來自 org 成員解析,已經是授權結論。
     · `member_state` 走 **app 車道** —— 它有 RLS,跨租戶讀不到是**資料庫執法**,
       不是靠這裡記得加 WHERE。

     ⚠️ 首版寫成單一 join 掛在 app 車道上,`permission denied for table users`。
     測試當場抓到,因為它跑在 app 車道 —— 承 settings 那次的教訓。 */
  async list(tenantId: number, memberActorIds: readonly number[]): Promise<MemberRow[]> {
    if (memberActorIds.length === 0) return []
    const ids = memberActorIds.filter((n) => Number.isSafeInteger(n) && n > 0)
    if (ids.length === 0) return []

    const profiles = await this.db
      .select({
        actorId: users.id,
        email: users.email,
        name: users.name,
        usedAt: initialCredentials.usedAt,
        expiresAt: initialCredentials.expiresAt,
      })
      .from(users)
      .leftJoin(initialCredentials, eq(initialCredentials.authUserId, users.authUserId))
      .where(
        sql`${users.id} = ANY(${sql`ARRAY[${sql.join(
          ids.map((n) => sql`${n}`),
          sql`, `,
        )}]::bigint[]`})`,
      )

    const statuses = await this.tdb.withTenant(tenantId, async (tx) =>
      tx
        .select({ actorId: memberStates.actorId, status: memberStates.status })
        .from(memberStates)
        .where(eq(memberStates.tenantId, tenantId)),
    )
    const statusOf = new Map(statuses.map((s) => [s.actorId, s.status]))

    return profiles.map((r) => ({
      actorId: r.actorId,
      email: r.email,
      name: r.name,
      /* 缺列 = active(既有成員零遷移;見 migration 0040) */
      status: (statusOf.get(r.actorId) ?? "active") as "active" | "suspended",
      credential:
        r.expiresAt === null || r.usedAt !== null
          ? ("set" as const)
          : r.expiresAt.getTime() < Date.now()
            ? ("expired" as const)
            : ("pending" as const),
    }))
  }

  /* 🔴 建立成員。**沒有讓呼叫端指定密碼的參數** —— ASVS §V6.4.6 反對管理員
     知道使用者密碼,故這裡連那個入口都不存在,而不是靠檢核擋掉。 */
  async create(input: {
    readonly tenantId: number
    readonly issuedByActorId: number
    readonly email: string
    readonly name: string
    readonly createAuthUser: (email: string, name: string, password: string) => Promise<string>
    readonly addToOrg: (authUserId: string) => Promise<void>
  }): Promise<CreatedMember> {
    const email = input.email.trim().toLowerCase()

    const existing = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    if (existing.length > 0) {
      /* 已存在的帳號要加進租戶是另一件事(它已有自己的密碼,不該被重設)。
         合併成同一條路徑會讓「新人入職」不小心改掉別人的密碼。 */
      throw new ConflictException({
        code: "USER_EXISTS",
        message: "這個 email 已經有帳號,請改用「加入既有帳號」",
      })
    }

    const password = generateInitialPassword()
    const authUserId = await input.createAuthUser(email, input.name.trim(), password)
    await input.addToOrg(authUserId)

    const expiresAt = initialPasswordExpiry(new Date())
    /* 走特權車道:`initial_credential` 刻意無 RLS(登入流程需在租戶語境之前查它),
       且 app 車道**沒有 INSERT 權限** —— 簽發只能從這裡發生。 */
    await this.db.insert(initialCredentials).values({
      authUserId,
      expiresAt,
      issuedByActorId: input.issuedByActorId,
      issuedInTenantId: input.tenantId,
    })

    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authUserId, authUserId))
      .limit(1)
    if (row === undefined) {
      throw new BadRequestException({ code: "USER_NOT_PROVISIONED", message: "帳號建立未完成" })
    }

    return { actorId: row.id, email, initialPassword: password, expiresAt }
  }

  async setStatus(
    tenantId: number,
    actorId: number,
    status: "active" | "suspended",
    byActorId: number,
  ): Promise<void> {
    if (actorId === byActorId && status === "suspended") {
      /* 停掉自己會讓租戶可能沒有任何人能管理 —— 與 actions-approval 禁自簽同一類守衛 */
      throw new BadRequestException({ code: "CANNOT_SUSPEND_SELF", message: "不能停用自己的帳號" })
    }
    await this.tdb.withTenant(tenantId, async (tx) => {
      await tx
        .insert(memberStates)
        .values({
          tenantId,
          actorId,
          status,
          suspendedAt: status === "suspended" ? new Date() : null,
          suspendedBy: status === "suspended" ? byActorId : null,
        })
        .onConflictDoUpdate({
          target: [memberStates.tenantId, memberStates.actorId],
          set: {
            status,
            suspendedAt: status === "suspended" ? new Date() : null,
            suspendedBy: status === "suspended" ? byActorId : null,
            updatedAt: new Date(),
          },
        })
    })
  }

  /* AuthGuard 用:此人在此租戶是否被停權。缺列 = active。 */
  async isSuspended(tenantId: number, actorId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ status: memberStates.status })
      .from(memberStates)
      .where(and(eq(memberStates.tenantId, tenantId), eq(memberStates.actorId, actorId)))
      .limit(1)
    return row?.status === "suspended"
  }
}
