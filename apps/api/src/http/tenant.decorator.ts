import { createParamDecorator, type ExecutionContext } from "@nestjs/common"
import type { RequestWithTenant, TenantContext } from "./tenant-context.js"

export const Tenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const request = context.switchToHttp().getRequest<RequestWithTenant>()
    const tenantContext = request.tenantContext
    if (tenantContext === undefined) {
      throw new Error("tenant context missing; guard not applied")
    }
    return tenantContext
  },
)
