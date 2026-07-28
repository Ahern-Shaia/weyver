import type { Pool } from "pg"
import { currentTotpStep } from "./backup-codes.js"

/* 🔴 TOTP 重放防護的兩半(RFC 6238 §5.2)。

   **為什麼全部在 after 做**|`/two-factor/verify-totp` 執行時使用者尚在 two-factor
   challenge 狀態,`ctx.context.session` 為空 —— **before hook 拿不到身分**,無從查詢。
   故改為:`after`(驗證成功、已知 userId)以**條件式 INSERT** 記錄 time step;
   受影響列數為 0 即代表「此 step 已被成功用過」= 重放 → 撤銷剛發出的 session 並拒絕。

   失敗的嘗試不會走到 after,所以「同一窗內先打錯、再打對」仍可通過 —— 這是對的:
   RFC 禁止的是**重用已成功驗證過的碼**,不是禁止同一窗內重試。

   代價:重放時 session 會先建立再撤銷。可接受 —— 重放是攻擊路徑而非正常流程,
   且撤銷與拒絕在同一個請求內完成,client 拿不到可用的 session。 */

/* 回傳 true = 此 step 是新的(已記錄);false = 已被成功用過 → 重放。
   條件式 UPSERT 讓「判定 + 記錄」在單一原子操作內完成,並發下不會兩個都通過。 */
export async function claimTotpStep(pool: Pool, userId: string, nowMs: number): Promise<boolean> {
  const step = currentTotpStep(nowMs)
  const res = await pool.query(
    `INSERT INTO totp_replay_guard (auth_user_id, last_used_step) VALUES ($1, $2)
       ON CONFLICT (auth_user_id) DO UPDATE
       SET last_used_step = EXCLUDED.last_used_step, updated_at = now()
       WHERE totp_replay_guard.last_used_step < EXCLUDED.last_used_step`,
    [userId, step],
  )
  return (res.rowCount ?? 0) > 0
}

/* 撤銷剛發出的 session —— 重放偵測後不可留下可用憑證。 */
export async function revokeSessionByToken(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM "session" WHERE token = $1', [token])
}
