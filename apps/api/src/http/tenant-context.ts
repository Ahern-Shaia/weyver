import type { FastifyRequest } from "fastify"

/* 每請求解析出的可信租戶身分。來源必為伺服器驗證(prod = Better Auth session;dev = x-dev-tenant)
   —— client 永不能指定租戶(AGENTS 鐵則 3 / docs/21 §4)。 */
export interface TenantContext {
  readonly tenantId: number
  readonly actorId: number
  /* dev 流程(DevTenantGuard)標記為超級管理員 → PermissionGuard 授予全權,保 dev 建表/填單體驗不斷。
     prod 一律 undefined,授權走真實 role 解析(P0-4a)。 */
  readonly isSuperAdmin?: boolean
}

export type RequestWithTenant = FastifyRequest & { tenantContext?: TenantContext }
