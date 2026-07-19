import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { DevTenantGuard } from "../http/dev-tenant.guard.js"
import { AuthGuard } from "./auth-guard.js"

/* 依環境分派租戶解析:production = 真實 session(AuthGuard);dev/test = x-dev-tenant(DevTenantGuard)。
   prod 路徑不觸 dev header,dev 路徑不觸 session —— 職責與攻擊面清楚隔離(OQ-AUTH-7)。 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthGuard) private readonly authGuard: AuthGuard,
    @Inject(DevTenantGuard) private readonly devGuard: DevTenantGuard,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    return this.config.get<string>("NODE_ENV") === "production"
      ? this.authGuard.canActivate(context)
      : this.devGuard.canActivate(context)
  }
}
