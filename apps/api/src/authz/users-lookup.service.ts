import { Inject, Injectable } from "@nestjs/common"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import { roleMembers, users } from "../db/schema.js"

/* R1·workbench-uplift A5(OQ-RWB-7=A)|actor id → 顯示名。
   稽核區顯示「王小明」而非「actor #7」。

   **只回同租戶成員**(`role_members` 為租戶內成員之權威來源)且**只回 `{id, name}`** ——
   email 等可識別資訊不外流(docs/22:回應 DTO 只回需要欄)。
   `users` 為跨租戶系統表(非 RLS、app 角色無 grant)→ 走特權車道,防線為此處的 join 條件。 */

const MAX_IDS = 100

@Injectable()
export class UsersLookupService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async lookup(
    tenantId: number,
    actorIds: readonly number[],
  ): Promise<{ id: number; name: string }[]> {
    const ids = [...new Set(actorIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(
      0,
      MAX_IDS,
    )
    if (ids.length === 0) return []

    const rows = await this.db
      .selectDistinct({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .innerJoin(roleMembers, eq(roleMembers.actorId, users.id))
      .where(
        and(
          inArray(users.id, ids),
          eq(roleMembers.tenantId, tenantId), // 跨租戶隔離之唯一防線(users 非 RLS)
          isNull(users.deletedAt),
        ),
      )
    // name 可為空 → 退回 email 本地部分(仍不回完整 email)
    return rows.map((r) => ({ id: r.id, name: r.name ?? r.email.split("@")[0] ?? `#${r.id}` }))
  }
}
