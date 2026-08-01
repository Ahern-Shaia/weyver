import type { Pool } from "pg"

/* 🔴 租戶層強制二步驟驗證的閘門(#112)。

   ## 設計依據(一手)

   GitHub 逐字:「Members and billing managers who do not use 2FA **will not be able
   to access your organization's resources until they enable 2FA on their account**.」
   —— 擋在資源外,不刪帳號,而且**登記那條路必須留著**。

   所以這個閘門只有兩件事要做對:
   1. 擋住租戶資料
   2. **不要把人擋在啟用 2FA 的路上** —— 擋住了就是全公司一起鎖死,沒有救援途徑

   ## 為什麼豁免清單這麼短

   Better Auth 的端點(`/api/auth/*`,含 `/two-factor/enable`)根本不經過 TenantGuard,
   本來就通。需要在這裡豁免的,只有「帳號安全」那一頁自己要讀的東西 ——
   使用者得看得到自己的狀態才知道要做什麼。其餘一律擋。 */

/* 前綴比對,且必須以 `/` 或結尾為界 —— 否則 `/api/securityfoo` 會被誤放行。 */
const EXEMPT_PREFIXES = [
  /* 帳號安全頁:裝置清單 / 認證紀錄 / 密碼政策。要啟用 2FA 就得先進得來 */
  "/api/security",
  /* 個人設定:語言時區。被鎖住時仍應可讀,否則整個 app shell 都渲染不出來 */
  "/api/settings/me",
] as const

/* 缺值時回 **false = 不豁免**(fail-closed,同 export-gate)。 */
export function isMfaExemptPath(path: string | undefined): boolean {
  if (path === undefined) return false
  const clean = path.split("?")[0] ?? path
  return EXEMPT_PREFIXES.some((p) => clean === p || clean.startsWith(`${p}/`))
}

/* 這個人是否已啟用 2FA。查 Better Auth 的 `user."twoFactorEnabled"` ——
   它是 plugin 在 enable/disable 時維護的權威旗標(見 plugins/two-factor)。 */
export async function hasMfaEnabled(pool: Pool, authUserId: string): Promise<boolean> {
  const res = await pool.query<{ on: boolean | null }>(
    `SELECT "twoFactorEnabled" AS on FROM "user" WHERE id = $1`,
    [authUserId],
  )
  return res.rows[0]?.on === true
}

export async function tenantRequiresMfa(pool: Pool, tenantId: number): Promise<boolean> {
  const res = await pool.query<{ require_mfa: boolean }>(
    "SELECT require_mfa FROM tenants WHERE id = $1",
    [tenantId],
  )
  return res.rows[0]?.require_mfa === true
}
