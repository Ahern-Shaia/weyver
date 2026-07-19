import type { FastifyRequest } from "fastify"

/* 每請求解析出的可信租戶身分。來源必為伺服器驗證(prod = Better Auth session;dev = x-dev-tenant)
   —— client 永不能指定租戶(AGENTS 鐵則 3 / docs/21 §4)。 */
export interface TenantContext {
  readonly tenantId: number
  readonly actorId: number
}

export type RequestWithTenant = FastifyRequest & { tenantContext?: TenantContext }
