import { Inject, Injectable } from "@nestjs/common"
import { eq } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import { tenants } from "../db/schema.js"

/* F-8 M1|方案能力檢查點(OQ-SB-6=A 能力碼粒度)。

   **本服務目前一律放行。** 存在的理由不是「現在會擋什麼」,而是把**呼叫點的位置固定下來** ——
   模組數正在快速增加,每多一個沒有 entitlement 縫的模組,日後補做方案分級的成本就多一份
   (成本隨模組數線性成長,見 design doc §1.2)。

   ⚠️ **fail-open,絕不可與 authz 的 deny-by-default 混用**(FMEA B2)。
   計費是**商業邊界**不是安全邊界:設定漏填時,正確行為是讓已付費客戶繼續使用,
   而非擋住他們。存取控制請走 `PermissionService`(deny-by-default),不要走這裡。

   OQ-SB-8=A:方案內容(哪個能力屬哪個方案)刻意**不入庫** —— docs/05 明載其定價
   「是模型不是斷言」,不把未定案的商業決策固化成程式碼。`plan_code` 現階段一律 NULL。 */

/* 能力碼由各模組自行宣告,與 docs/04 的 A–U 模組劃分**解耦** ——
   方案分級切的是「客戶感知的價值包」,不是我們的程式碼模組邊界。 */
export type Capability = string

export interface TenantPlan {
  readonly planCode: string | null
  readonly status: string
  readonly trialEndsAt: Date | null
}

@Injectable()
export class EntitlementService {
  /* tenants 為系統設定表(非 RLS)→ 特權車道,與 QuotaService 同 */
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async planFor(tenantId: number): Promise<TenantPlan> {
    const rows = await this.db
      .select({
        planCode: tenants.planCode,
        status: tenants.status,
        trialEndsAt: tenants.trialEndsAt,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const row = rows[0]
    return {
      planCode: row?.planCode ?? null,
      status: row?.status ?? "active",
      trialEndsAt: row?.trialEndsAt ?? null,
    }
  }

  /* P0 一律 true。日後填方案內容時,**未知能力碼仍須預設放行**(FMEA B2)。 */
  async canUse(_tenantId: number, _capability: Capability): Promise<boolean> {
    return true
  }

  /* null = 不限席位。日後由 plan 決定(Starter 10 / Pro 25 / Enterprise 不限)。 */
  async seatLimit(_tenantId: number): Promise<number | null> {
    return null
  }
}
