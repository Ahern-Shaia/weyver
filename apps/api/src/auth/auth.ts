import { hash, verify } from "@node-rs/argon2"
import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { organization, twoFactor } from "better-auth/plugins"
import {
  BACKUP_CODE_COUNT,
  generateBackupCode,
  hashBackupCode,
  isHashed,
} from "./backup-codes.js"
import { claimTotpStep, revokeSessionByToken } from "./totp-replay.js"
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
  /* MFA 備用碼雜湊之 pepper;未設則退回 app secret(見 createAuth 註解)*/
  readonly backupCodePepper?: string
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
  /* 🔴 備用碼 pepper 與 app secret 分開(NIST §5.1.1.2:keyed-hash 之金鑰宜與資料分離)。
     未另設時退回 app secret —— 仍是單向雜湊,只是共用金鑰。 */
  const backupPepper = options?.backupCodePepper ?? secret
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
    /* 🔴 兩個 MFA 安全修補(追溯稽核 #111)。 */
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        /* (1) 備用碼:plugin 以 `storedCodes.includes(使用者輸入)` 比對,而我們存的是雜湊
               → 必須把使用者輸入也雜湊。這是「單向雜湊」在此 plugin 架構下成立的另一半。 */
        if (ctx.path === "/two-factor/verify-backup-code") {
          const body = ctx.body as { code?: unknown } | undefined
          if (typeof body?.code === "string") {
            return {
              context: {
                ...ctx,
                body: { ...body, code: hashBackupCode(body.code, backupPepper) },
              },
            }
          }
        }
        return undefined
      }),
      /* (2) TOTP 重放防護(RFC 6238 §5.2)—— better-auth 無 used 記錄。
             全部在 after 做,因為 verify-totp 執行時使用者尚在 challenge 狀態、
             before hook 拿不到身分(詳見 totp-replay.ts 檔頭)。 */
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/two-factor/verify-totp") return undefined
        const session = ctx.context.newSession
        const userId = session?.user?.id
        if (typeof userId !== "string") return undefined
        if (await claimTotpStep(pool, userId, Date.now())) return undefined

        /* 此 time step 已被成功驗證過 → 重放。撤銷剛發出的 session 再拒絕。 */
        const token = session?.session?.token
        if (typeof token === "string") await revokeSessionByToken(pool, token)
        throw new APIError("UNAUTHORIZED", {
          code: "TOTP_CODE_ALREADY_USED",
          message: "此驗證碼已使用過,請等待下一組",
        })
      }),
    },
    plugins: [
      twoFactor({
        issuer: "Weyver",
        backupCodeOptions: {
          /* 24 字元 base32 = 120 bits ≥ NIST 的 112 bits 門檻 → 可用 approved hash
             而不必 password-hashing scheme(見 backup-codes.ts 檔頭)。 */
          customBackupCodesGenerate: () =>
            Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode()),
          /* plugin 把備用碼當成「整批 blob」處理:`encrypt(JSON.stringify(codes))` 存,
             驗證時 `decrypt()` → JSON.parse → `includes(使用者輸入)`。
             故以此擴充點改成單向雜湊需要兩件事同時成立:
             (a) 這裡把每一組碼雜湊後才存;
             (b) 一個 before hook 把**使用者輸入**也雜湊,才能被 includes 命中(見下)。 */
          storeBackupCodes: {
            encrypt: async (json: string): Promise<string> => {
              const codes = JSON.parse(json) as string[]
              /* **冪等**:用掉一組後 plugin 會把「剩餘碼」再送進來一次,
                 那些已是雜湊值 —— 不可重複雜湊,否則全部作廢。 */
              return JSON.stringify(
                codes.map((c) => (isHashed(c) ? c : hashBackupCode(c, backupPepper))),
              )
            },
            /* 直通:存的就是雜湊,plugin 的 includes 比對的也是雜湊 */
            decrypt: async (stored: string): Promise<string> => stored,
          },
        },
      }),
      orgPlugin,
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
