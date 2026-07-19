import { hash, verify } from "@node-rs/argon2"
import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import type { Pool } from "pg"

/* org 建立時的 provisioning 回呼(M2 IdentityService 綁入,見 auth.module.ts):
   org → 建 tenant + 連結。idempotent,故重放安全。 */
export interface AuthProvisioningHooks {
  readonly onOrganizationCreated?: (input: {
    readonly authOrgId: string
    readonly name: string
  }) => Promise<void>
}

/* F-2|Better Auth 認證權威(掛 apps/api,同 Weyver PG,OQ-AUTH-1)。
   密碼 Argon2id(@node-rs/argon2 預設即 Argon2id;覆寫 Better Auth 預設 scrypt — AGENTS 🔒-4)。
   organization plugin = 多租戶 org(對映 Weyver tenants,M2);org 建立 hook → 建 tenant(M3)。
   session 驗證見 AuthGuard(M3)。secret 由呼叫端(NestJS ConfigService)注入,不散落 process.env。 */
export function createAuth(pool: Pool, secret: string, hooks?: AuthProvisioningHooks) {
  const onOrgCreated = hooks?.onOrganizationCreated
  const orgPlugin = onOrgCreated
    ? organization({
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org }): Promise<void> => {
            await onOrgCreated({ authOrgId: org.id, name: org.name })
          },
        },
      })
    : organization()

  return betterAuth({
    database: pool,
    secret,
    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password: string): Promise<string> => hash(password),
        verify: (data: { hash: string; password: string }): Promise<boolean> =>
          verify(data.hash, data.password),
      },
    },
    plugins: [orgPlugin],
  })
}

export type Auth = ReturnType<typeof createAuth>
