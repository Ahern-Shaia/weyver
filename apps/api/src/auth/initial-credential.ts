import type { Pool } from "pg"

/* 🔴 R1·A-1 M2 補完 / OQ-SC-16=A|初始密碼的生命週期執法。

   ASVS 5.0.0 §V6.4.1 逐字要求初始密碼「expire after a short period of time
   **or** after they are initially used」,且「**must not be permitted to become
   the long term password**」。

   M2 建了 `initial_credential`(72 小時效期 + `used_at`)並在成員頁顯示狀態,
   但**登入流程從未查過它、`used_at` 從未被寫入** —— 三個後果:
     1. 管理員發的初始密碼可以永遠當長期密碼用(正是上面那句禁止的事)
     2. 72 小時效期形同虛設,過期憑證照樣登入
     3. 成員頁的「未啟用」永遠不會變「已設定」,畫面在說謊

   ## 狀態機(刻意只用既有欄位,不新增旗標)

     列存在 + `used_at` IS NULL   → 未啟用(初始密碼尚未用過)
     列存在 + `used_at` NOT NULL  → **必須改密碼**(已用過初始密碼,但還沒自設)
     列不存在                      → 已自設密碼

   最後一態靠**改密碼成功即刪列**達成,而這正好與成員頁既有的狀態推導
   (`expiresAt === null || usedAt !== null → set`)一致 —— 不必改前端邏輯。

   ⚠️ 本表**刻意無 RLS**:這些判斷發生在租戶語境建立**之前**。 */

export type CredentialClaim = "none" | "claimed" | "expired"

/* 登入成功當下呼叫。回 "expired" 表示這次登入必須被撤銷。
   以 `UPDATE … WHERE used_at IS NULL` 單句完成認領 —— 併發下只有一方會拿到列。 */
export async function claimInitialCredential(
  pool: Pool,
  authUserId: string,
): Promise<CredentialClaim> {
  const row = await pool.query<{ expires_at: Date; used_at: Date | null }>(
    "SELECT expires_at, used_at FROM initial_credential WHERE auth_user_id = $1",
    [authUserId],
  )
  const found = row.rows[0]
  if (found === undefined) return "none"

  if (found.used_at === null) {
    if (found.expires_at.getTime() <= Date.now()) return "expired"
    await pool.query(
      "UPDATE initial_credential SET used_at = now() WHERE auth_user_id = $1 AND used_at IS NULL",
      [authUserId],
    )
  }
  return "claimed"
}

/* AuthGuard 每請求都會問一次 → 只查存在性,不回內容。
   `used_at IS NOT NULL` = 已經用初始密碼進來過但還沒自己設一組。 */
export async function mustChangePassword(pool: Pool, authUserId: string): Promise<boolean> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM initial_credential
      WHERE auth_user_id = $1 AND used_at IS NOT NULL`,
    [authUserId],
  )
  return (r.rows[0]?.n ?? 0) > 0
}

/* 使用者自己改完密碼 → 憑證退場。**刪列**而不是加旗標:
   少一個「已改但列還在」的中間態,也讓成員頁的既有推導直接得到「已設定」。 */
export async function clearInitialCredential(pool: Pool, authUserId: string): Promise<void> {
  await pool.query("DELETE FROM initial_credential WHERE auth_user_id = $1", [authUserId])
}
