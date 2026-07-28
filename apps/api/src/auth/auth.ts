import { hash, verify } from "@node-rs/argon2"
import { betterAuth } from "better-auth"
import { organization, twoFactor } from "better-auth/plugins"
import type { Pool } from "pg"

/* org 建立時的 provisioning 回呼(M2 IdentityService 綁入,見 auth.module.ts):
   org → 建 tenant + 連結。idempotent,故重放安全。 */
export interface AuthProvisioningHooks {
  readonly onOrganizationCreated?: (input: {
    readonly authOrgId: string
    readonly name: string
    // 建立者 = org owner;用於 owner→tenant admin 對映(OQ-AUTHZ-5)
    readonly owner: {
      readonly authUserId: string
      readonly email: string
      readonly name: string | null
    }
  }) => Promise<void>
}

export interface AuthOptions {
  readonly baseURL?: string
  readonly trustedOrigins?: readonly string[]
  readonly hooks?: AuthProvisioningHooks
}

/* F-2|Better Auth 認證權威(掛 apps/api,同 Weyver PG,OQ-AUTH-1)。
   密碼 Argon2id(@node-rs/argon2 預設即 Argon2id;覆寫 Better Auth 預設 scrypt — AGENTS 🔒-4)。
   organization plugin = 多租戶 org(對映 Weyver tenants,M2);org 建立 hook → 建 tenant(M3)。
   session 驗證見 AuthGuard(M3)。secret 由呼叫端(NestJS ConfigService)注入,不散落 process.env。 */
/* 🔴 organization plugin 的安全選項(兩個分支共用)。

   **`requireEmailVerificationOnInvitation`|不能靠預設。** Better Auth 於 1.6.11 修好
   CVE-2026-53514(GHSA-fmh4-wcc4-5jm3),但其 fallback 邏輯是:未顯式設定本選項、
   且使用內建 opaque invitation id 時判定為 **false** —— 也就是**不要求驗證**。
   本專案原本未設此選項亦無 email 驗證流程(`emailVerified` 恆為 false),
   等於該 CVE 的攻擊路徑重新打開:知道受邀 email → 搶註冊該 email → 接受邀請
   → 進入他人租戶。

   ⚠️ **開啟後 email 驗證流程即為必要前置** —— 目前 `sendVerificationEmail` 尚未實作,
   故**邀請功能在該流程完成前不可對外開放**(目前邀請亦尚未接入任何 UI,不影響既有流程)。

   **`allowUserToCreateOrganization`|維持開啟但標記風險**:每個 org 經 hook 會建一個
   tenant,對外開放註冊前必須改為受控(邀請制或後台審核),否則為資源濫用途徑。 */
const ORG_SECURITY = {
  requireEmailVerificationOnInvitation: true,
  allowUserToCreateOrganization: true,
} as const

export function createAuth(pool: Pool, secret: string, options?: AuthOptions) {
  const onOrgCreated = options?.hooks?.onOrganizationCreated
  const orgPlugin = onOrgCreated
    ? organization({
        ...ORG_SECURITY,
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, user }): Promise<void> => {
            await onOrgCreated({
              authOrgId: org.id,
              name: org.name,
              owner: { authUserId: user.id, email: user.email, name: user.name ?? null },
            })
          },
        },
      })
    : organization({ ...ORG_SECURITY })

  return betterAuth({
    database: pool,
    secret,
    ...(options?.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options?.trustedOrigins === undefined
      ? {}
      : { trustedOrigins: [...options.trustedOrigins] }),
    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password: string): Promise<string> => hash(password),
        verify: (data: { hash: string; password: string }): Promise<boolean> =>
          verify(data.hash, data.password),
      },
    },
    // 暴力防護集中在認證「寫」端點;高頻「讀」(session 輪詢)放寬,否則正常使用即被 429
    rateLimit: {
      enabled: true,
      window: 60,
      max: 300,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/get-session": { window: 60, max: 2000 },
        // 二步驟驗證碼暴力防護(F-4 MFA)
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    // F-4 MFA:TOTP 二步驟驗證(skipVerificationOnEnable 預設 false → enable 後須 verifyTotp 才啟用;
    // secret 由 app secret 加密、backup codes 雜湊,皆 Better Auth 內建)
    plugins: [twoFactor({ issuer: "Weyver" }), orgPlugin],
  })
}

export type Auth = ReturnType<typeof createAuth>
