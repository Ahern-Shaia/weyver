import { hash, verify } from "@node-rs/argon2"
import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { organization, twoFactor } from "better-auth/plugins"
import { BACKUP_CODE_COUNT, generateBackupCode, hashBackupCode, isHashed } from "./backup-codes.js"
import { PEER_IP_HEADER, recordAuthEvent, recordFromContext } from "./auth-events.js"
import { claimInitialCredential, clearInitialCredential } from "./initial-credential.js"
import { LOCKOUT_MINUTES, isAccountLocked } from "./login-throttle.js"
import { blockedPasswordMessage, checkPassword } from "./password-blocklist.js"
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
      /* 多因子地板(63B-4 §3.1.1.2 後半);單因子的 15 字由 before hook 執行 —— 見該處註解 */
      minPasswordLength: 8,
      password: {
        hash: (password: string): Promise<string> => hash(password),
        verify: (data: { hash: string; password: string }): Promise<boolean> =>
          verify(data.hash, data.password),
      },
    },
    /* 🔴 來源 IP 一律取自 `mountAuthHandler` 覆寫過的 peer header,不採預設的
       `x-forwarded-for`。這個設定同時決定**兩件事**:

       (a) **限流的分桶依據**。better-auth 1.6.23 的 `getIp()` 在未設 `trustedProxies`
           時,對單一值的 `x-forwarded-for` **照收**(見 core `utils/ip.mjs`)。
           於是「5 次/分」變成「每個偽造 IP 5 次/分」= 無上限。
           實測:輪換假 IP 打 12 次登入,修正前 **0 次**被擋。
       (b) **session 的 `ipAddress` 欄**,也就是「登入中的裝置」顯示的內容 ——
           否則那一欄顯示的是攻擊者自己填的字串。

       ⚠️ 正式部署在 LB / Cloud Run 之後時,Fastify 的 peer 會是 proxy,
       全體使用者將落入同一個桶。屆時須設定 Fastify `trustProxy` 的信任範圍
       (而非改回直接相信 client 的 `x-forwarded-for`)。 */
    advanced: { ipAddress: { ipAddressHeaders: [PEER_IP_HEADER] } },
    /* 暴力防護集中在認證「寫」端點;其餘放寬。

       🔴 **全域上限不能兼任暴力防護**。原本 300/分 把「可被暴力攻擊的端點」和
       「無害的已認證讀取」(organization/list、set-active、get-full-organization…)
       放進同一個逐 IP 的桶 —— 一整間辦公室共用一個對外 IP,正常使用就會撞到。
       實測(e2e trace):連跑五輪即出現 `429 POST /api/auth/change-password`,
       而 change-password 從頭到尾沒有被任何人暴力嘗試過。

       → 全域改為單純的洪水保護;真正的門檻由 (a) 逐端點規則
       (b) **逐帳號**節流(login-throttle.ts,63B-4 §3.2.2 要求的那一個)把守。 */
    rateLimit: {
      enabled: true,
      window: 60,
      max: 2000,
      customRules: {
        /* 🔴 20 而非 5:同一間辦公室共用一個對外 IP,早上陸續上班就會互相鎖住
           (better-auth 的限流**不分成敗**,登入成功也照算)。
           真正的暴力防護改由**逐帳號**節流把守 —— 見 login-throttle.ts;
           per-IP 這一層留著只是擋最粗暴的單機洪水。 */
        "/sign-in/email": { window: 60, max: 20 },
        "/sign-up/email": { window: 60, max: 5 },
        "/get-session": { window: 60, max: 2000 },
        /* 敏感寫入,但必須先有「目前密碼」才可能成功 → 不必壓到與登入同級 */
        "/change-password": { window: 60, max: 30 },
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
        /* 🔴 (0) 密碼長度:單因子 **15**,已啟用 MFA 者 8(OQ-SC-9=C)。

           NIST SP 800-63B-**4** §3.1.1.2 逐字:「Verifiers and CSPs SHALL require
           passwords that are used as a **single-factor** authentication mechanism to be
           a minimum of **15 characters**… MAY allow passwords that are only used as part
           of **multi-factor** authentication processes to be shorter but SHALL require
           them to be a minimum of **eight characters**.」

           ⚠️ **rev 3 的臨時/隨機密碼 6 字豁免已在 rev 4 被刪除**,無例外可援引。
           Better Auth 的 `minPasswordLength` 是 **instance 級**、無法逐使用者分流,
           故 instance 設 8(多因子地板),15 這一段在此 hook 執行。

           註冊時定義上還沒有 MFA → 一律 15。 */
        if (ctx.path === "/sign-up/email" || ctx.path === "/change-password") {
          const body = ctx.body as { password?: unknown; newPassword?: unknown } | undefined
          const pw = typeof body?.newPassword === "string" ? body.newPassword : body?.password
          if (typeof pw === "string" && pw.length < 15) {
            /* 註冊時無 session → mfaOn 為 false → 一律 15,正是我們要的。
               改密碼時使用者已認證,由 ctx 取既有 session 判斷是否已啟用 MFA。 */
            const current = (ctx.context as { session?: { user?: { twoFactorEnabled?: unknown } } })
              .session
            const mfaOn = current?.user?.twoFactorEnabled === true
            if (!mfaOn) {
              throw new APIError("BAD_REQUEST", {
                code: "PASSWORD_TOO_SHORT",
                message: "密碼至少 15 個字;若已啟用二步驟驗證則可 8 個字",
              })
            }
          }

          /* 🔴 (0b) 外洩 / 常見 / 情境字比對(63B-4 §3.1.1.2 亦為 SHALL)。
             在長度檢查**之後**跑:先講「太短」比先講「太常見」更可行動。 */
          if (typeof pw === "string") {
            const who = ctx.body as { email?: unknown; name?: unknown } | undefined
            const reason = checkPassword(pw, {
              email: typeof who?.email === "string" ? who.email : undefined,
              name: typeof who?.name === "string" ? who.name : undefined,
            })
            if (reason !== null) {
              throw new APIError("BAD_REQUEST", {
                code: "PASSWORD_BLOCKED",
                message: blockedPasswordMessage(reason),
              })
            }
          }
        }
        /* 🔴 (0c) 逐帳號節流(63B-4 §3.2.2:consecutive failed attempts on a
         **single account**)。放在 before —— 密碼根本不該被驗證。 */
        if (ctx.path === "/sign-in/email") {
          const email = (ctx.body as { email?: unknown } | undefined)?.email
          if (typeof email === "string" && (await isAccountLocked(pool, email))) {
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "ACCOUNT_TEMPORARILY_LOCKED",
              message: `連續登入失敗過多,請 ${String(LOCKOUT_MINUTES)} 分鐘後再試`,
            })
          }
        }
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
        /* 🔴 IP 取自 `mountAuthHandler` 覆寫的 peer header,**不是** client 送的
           `x-forwarded-for` —— 後者可任意偽造,在稽核紀錄裡就是讓攻擊者自己填來源。 */
        const ip = ctx.headers?.get(PEER_IP_HEADER) ?? null
        const ua = ctx.headers?.get("user-agent") ?? null

        if (ctx.path === "/two-factor/verify-totp") {
          const session = ctx.context.newSession
          const userId = session?.user?.id
          if (typeof userId === "string" && !(await claimTotpStep(pool, userId, Date.now()))) {
            /* 此 time step 已被成功驗證過 → 重放。撤銷剛發出的 session 再拒絕。 */
            const token = session?.session?.token
            if (typeof token === "string") await revokeSessionByToken(pool, token)
            /* 這是「有人拿到了一組用過的碼」——最該留下痕跡的事件之一。
               在此處記,是因為拋出後就走不到下面的通用記錄了。 */
            await recordAuthEvent(pool, {
              event: "login.failure",
              authUserId: userId,
              ipAddress: ip,
              userAgent: ua,
              detail: { reason: "totp_replay" },
            })
            throw new APIError("UNAUTHORIZED", {
              code: "TOTP_CODE_ALREADY_USED",
              message: "此驗證碼已使用過,請等待下一組",
            })
          }
        }

        /* 🔴 初始密碼的生命週期(ASVS §V6.4.1;見 initial-credential.ts)。
           在記錄事件**之前**做,因為過期會把這次登入撤掉 —— 那該記成失敗而非成功。 */
        if (ctx.path === "/sign-in/email") {
          const newSession = ctx.context.newSession
          const userId = newSession?.user?.id
          if (typeof userId === "string") {
            const claim = await claimInitialCredential(pool, userId)
            if (claim === "expired") {
              const token = newSession?.session?.token
              if (typeof token === "string") await revokeSessionByToken(pool, token)
              await recordAuthEvent(pool, {
                event: "login.failure",
                authUserId: userId,
                ipAddress: ip,
                userAgent: ua,
                detail: { reason: "initial_credential_expired" },
              })
              throw new APIError("UNAUTHORIZED", {
                code: "INITIAL_PASSWORD_EXPIRED",
                message: "初始密碼已逾期,請聯絡管理員重新產生",
              })
            }
          }
        }

        /* 自己改完密碼 → 初始憑證退場,強制改密碼的閘門隨之解除 */
        if (ctx.path === "/change-password") {
          const userId = ctx.context.session?.user?.id
          if (typeof userId === "string") await clearInitialCredential(pool, userId)
        }

        await recordFromContext(pool, ctx, ip, ua)
        return undefined
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
