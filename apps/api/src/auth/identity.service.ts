import { Inject, Injectable } from "@nestjs/common"
import { and, eq, isNull } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import { tenants, users } from "../db/schema.js"

/* F-2 M2|org↔tenant · user↔actor 對映(AGENTS 分層:repository 層之上的窄領域服務)。
   對映表(tenants / users)為 Tier-1 系統表、跨租戶非 RLS → 走特權 DRIZZLE 車道。
   所有寫入 idempotent(upsert),故無論由 Better Auth 事件 hook 或首次登入 JIT 觸發(M3 決定)皆安全。 */
@Injectable()
export class IdentityService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /* org 建立 → 建 tenant + 連結;已連結則回既有 tenantId(不重命名既有租戶)。並發下以 unique(auth_org_id) 兜底。 */
  async ensureTenantForOrg(input: {
    readonly authOrgId: string
    readonly name: string
  }): Promise<number> {
    const existing = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.authOrgId, input.authOrgId))
      .limit(1)
    if (existing[0]) return existing[0].id

    const inserted = await this.db
      .insert(tenants)
      .values({ name: input.name, authOrgId: input.authOrgId })
      .onConflictDoNothing({ target: tenants.authOrgId })
      .returning({ id: tenants.id })
    if (inserted[0]) return inserted[0].id

    // 競態:另一交易搶先插入 → 再查(unique 約束保證僅一列)
    const raced = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.authOrgId, input.authOrgId))
      .limit(1)
    const row = raced[0]
    if (!row) throw new Error("ensureTenantForOrg: conflict raced but no row found")
    return row.id
  }

  /* 首次登入 / 加入 org → upsert users;回 actorId(= users.id)。email/name 漂移時更新。 */
  async upsertUser(input: {
    readonly authUserId: string
    readonly email: string
    readonly name: string | null
  }): Promise<number> {
    const inserted = await this.db
      .insert(users)
      .values({ authUserId: input.authUserId, email: input.email, name: input.name })
      .onConflictDoUpdate({
        target: users.authUserId,
        set: { email: input.email, name: input.name, deletedAt: null },
      })
      .returning({ id: users.id })
    const row = inserted[0]
    if (!row) throw new Error("upsertUser: upsert returned no row")
    return row.id
  }

  async getTenantIdByOrg(authOrgId: string): Promise<number | null> {
    const rows = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.authOrgId, authOrgId))
      .limit(1)
    return rows[0]?.id ?? null
  }

  async getActorIdByUser(authUserId: string): Promise<number | null> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.authUserId, authUserId), isNull(users.deletedAt)))
      .limit(1)
    return rows[0]?.id ?? null
  }
}
