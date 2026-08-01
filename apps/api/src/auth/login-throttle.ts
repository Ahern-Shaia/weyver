import type { Pool } from "pg"

/* 🔴 逐**帳號**的登入節流(NIST SP 800-63B-4 §3.2.2)。

   原文要求「limit consecutive failed authentication attempts on a single
   account to no more than **100**」—— 注意主詞是 **single account**,不是 IP。

   ## 為什麼不能只靠 IP 限流

   原本只有「每 IP 每分鐘 5 次」。它同時做錯兩件事:

   · **誤傷合法使用者** —— 一間辦公室共用一個對外 IP,早上十個人陸續上班就會
     互相把對方鎖在門外。而且 better-auth 的限流**不分成敗**,登入成功也照算。
     (本專案的 e2e 就先撞上了:整套測試共用一個來源 IP,加一支登入型 spec 即 429。)
   · **擋不住真正的攻擊** —— 憑證填充本來就是分散在大量 IP 上進行的,
     每個 IP 只試少數幾次,永遠碰不到 per-IP 上限。

   → IP 限流放寬到容得下合法尖峰,真正的門檻改由**帳號**這一側把守。

   ## 判定

   「連續」= 自該帳號**最近一次登入成功之後**累積的失敗次數(成功即歸零),
   資料就用 M3 已經在寫的 `auth_audit`,不另立表。
   上限取 **10**,遠低於原文的 100 天花板;鎖定 **15 分鐘**後自動解除
   —— 不做永久鎖定,否則攻擊者只要亂打就能把任何人鎖死(阻斷服務)。 */

export const MAX_CONSECUTIVE_FAILURES = 10
export const LOCKOUT_MINUTES = 15

export async function isAccountLocked(pool: Pool, email: string): Promise<boolean> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM auth_audit a
       JOIN "user" u ON u.id = a.auth_user_id
      WHERE u.email = $1
        AND a.event = 'login.failure'
        AND a.created_at > now() - ($2 || ' minutes')::interval
        AND a.created_at > COALESCE(
              (SELECT max(s.created_at) FROM auth_audit s
                WHERE s.auth_user_id = u.id AND s.event = 'login.success'),
              'epoch'::timestamptz)`,
    [email, String(LOCKOUT_MINUTES)],
  )
  return (r.rows[0]?.n ?? 0) >= MAX_CONSECUTIVE_FAILURES
}
