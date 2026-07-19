import { hash, verify } from "@node-rs/argon2"
import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import type { Pool } from "pg"

/* F-2 M1|Better Auth 認證權威(掛 apps/api,同 Weyver PG,OQ-AUTH-1)。
   密碼 Argon2id(@node-rs/argon2 預設即 Argon2id;覆寫 Better Auth 預設 scrypt — AGENTS 🔒-4)。
   organization plugin = 多租戶 org(對映 Weyver tenants 見 M2)。session 驗證見 AuthGuard(M3)。
   secret 由呼叫端(NestJS ConfigService)注入,不散落 process.env(AGENTS)。 */
export function createAuth(pool: Pool, secret: string) {
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
    plugins: [organization()],
  })
}

export type Auth = ReturnType<typeof createAuth>
