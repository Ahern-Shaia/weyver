import { APIError } from "better-auth/api"
import type { Pool } from "pg"
import type { AuthEvent } from "../security/security.service.js"

/* R1·A-1 M3|認證事件的**寫入端**(讀取端在 `security/security.service.ts`)。

   放在 auth 資料夾、走 raw pool 而非 drizzle —— 與 `totp-replay.ts` 同一手法。
   理由:這段跑在 Better Auth 的 hook 裡,那裡拿不到 Nest 的 DI 容器。

   ## 🔴 after hook 在失敗時**確實會跑**(實測,非推測)

   讀 better-auth 1.6.23 `dist/api/dispatch.mjs`:handler 拋出的 APIError 被
   `.catch(e => isAPIError(e) ? { response: e, … } : throw)` 接住轉成結果,
   **之後才呼叫 `runAfterHooks`**。實測輸出:

     path=/sign-in/email  returned=APIError  statusCode=401  code=INVALID_EMAIL_OR_PASSWORD
     path=/sign-in/email  returned=Object    newSession=set                    ← 成功

   故判定規則為:
   · 失敗 ⟺ `ctx.context.returned instanceof APIError`
   · 成功 ⟺ `ctx.context.newSession` 有值
   · 兩者皆非(二步驟驗證的 `twoFactorRedirect`)⟺ **還沒登入完,先不記** ——
     真正的成敗會在 `/two-factor/verify-totp` 那一趟落下。

   ⚠️ `ctx.context.returned` **不在 1.6.23 的公開型別裡**(只在 runtime 設定),
   故需 cast。升版時這裡會安靜地失效,`security.integration.test` 的
   「登入失敗要記得到」那條就是它的警報器。 */

/* 由 `mountAuthHandler` 以 Fastify 的 socket peer IP **覆寫**後才進入 Better Auth。
   `Headers.set` 會取代 client 送來的同名值 → 呼叫端偽造不了。
   ⚠️ Fastify 未開 `trustProxy`(預設 false),故這是「直連對端」的 IP。
   正式部署若在 Cloud Run / LB 之後,會是 proxy 的 IP —— 屆時要一併設定
   `trustProxy` 的信任範圍,而不是改成直接相信 `x-forwarded-for`。 */
export const PEER_IP_HEADER = "x-weyver-peer-ip"

export async function recordAuthEvent(
  pool: Pool,
  input: {
    readonly event: AuthEvent
    readonly authUserId?: string | null
    readonly ipAddress?: string | null
    readonly userAgent?: string | null
    readonly detail?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auth_audit (event, auth_user_id, ip_address, user_agent, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.event,
        input.authUserId ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.detail === undefined ? null : JSON.stringify(input.detail),
      ],
    )
  } catch (error) {
    /* 🔴 記不成稽核**不該連帶讓登入失敗** —— 但也不得靜默吞掉,否則稽核會在
       沒有人知道的情況下停止運作(那正是最糟的失效模式:看起來一切正常)。 */
    console.error("[auth-audit] 寫入失敗", error)
  }
}

/* Better Auth 的 hook context —— 只取本檔用得到的形狀。
   `returned` 為 runtime-only 欄位(見檔頭),故在此顯式宣告。 */
interface HookContextShape {
  readonly path: string
  readonly body?: unknown
  readonly context: {
    readonly returned?: unknown
    readonly newSession?: { readonly user?: { readonly id?: unknown } } | null
    readonly session?: { readonly user?: { readonly id?: unknown } } | null
  }
}

export async function recordFromContext(
  pool: Pool,
  ctx: HookContextShape,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<void> {
  const newUserId = ctx.context.newSession?.user?.id
  const hasSession = typeof newUserId === "string"
  const event = eventFromContext(ctx.path, ctx.context.returned, hasSession)
  if (event === null) return

  /* 已認證的動作(登出 / 改密碼 / 開關 MFA)取現有 session 的人 */
  const sessionUserId = ctx.context.session?.user?.id
  let authUserId = hasSession ? newUserId : typeof sessionUserId === "string" ? sessionUserId : null

  /* 🔴 登入失敗時還沒有 session —— 但「有人在試我的帳號」正是這頁最該顯示的事。
     由 email 反查使用者,失敗紀錄才掛得到對的人身上。
     ⚠️ 查無此人時**不把對方輸入的 email 存進 detail** —— 那是攻擊者可控的自由文字,
     存了等於讓稽核表變成任人寫入的欄位。只記「帳號不存在」這個事實。 */
  let detail: Record<string, unknown> | undefined
  if (authUserId === null && event === "login.failure") {
    const email = (ctx.body as { email?: unknown } | undefined)?.email
    if (typeof email === "string") {
      const found = await pool
        .query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1 LIMIT 1`, [email])
        .catch(() => null)
      authUserId = found?.rows[0]?.id ?? null
    }
    if (authUserId === null) detail = { reason: "unknown_account" }
  }

  await recordAuthEvent(pool, {
    event,
    authUserId,
    ipAddress,
    userAgent,
    ...(detail === undefined ? {} : { detail }),
  })
}

/* 由 hook context 判定該記哪個事件。回傳 null = 這一趟不該記。 */
export function eventFromContext(
  path: string,
  returned: unknown,
  hasSession: boolean,
): AuthEvent | null {
  const failed = returned instanceof APIError
  switch (path) {
    case "/sign-up/email":
      return failed ? null : "account.create"
    case "/sign-in/email":
    case "/two-factor/verify-totp":
    case "/two-factor/verify-backup-code":
      /* 二步驟驗證中途(twoFactorRedirect):既未成功也未失敗 → 不記 */
      return failed ? "login.failure" : hasSession ? "login.success" : null
    case "/sign-out":
      return failed ? null : "logout"
    case "/change-password":
      return failed ? null : "password.change"
    case "/two-factor/enable":
      return failed ? null : "mfa.enable"
    case "/two-factor/disable":
      return failed ? null : "mfa.disable"
    default:
      return null
  }
}
