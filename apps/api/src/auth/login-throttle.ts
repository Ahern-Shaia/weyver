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
   上限取 **10**,遠低於 63B-4 的 100 天花板。

   ## 🔴 鎖定時間為**指數遞增**,不是固定值

   OWASP Authentication Cheat Sheet **明文點名**這個機制會被反過來利用:
   「When designing an account lockout system, **care must be taken to prevent it
   from being used to cause a denial of service by locking out other users'
   accounts**.」

   固定 15 分鐘正是它警告的形狀 —— 只要知道某人的 email,每 15 分鐘故意打錯 10 次,
   就能讓那個人**永遠登不進來**。同一份文件給了替代做法:
   「Rather than implementing a fixed lockout duration (e.g., ten minutes), some
   applications use an **exponential lockout**, where the lockout duration starts
   as a **very short period (e.g., one second)**, but doubles after each failed
   login attempt.」

   故:第 10 次失敗鎖 1 秒、第 11 次 2 秒、第 12 次 4 秒…上限 15 分鐘。
   · 隨手騷擾 → 對方只被擋一兩秒,幾乎無感
   · 持續暴力 → 幾次之後即進入分鐘級,嘗試速率被壓垮

   ⚠️ **殘留風險**:持續不斷的攻擊仍會把某帳號壓在上限。這無法用帳號層機制根除
   (原文說的是 "care must be taken",不是「有解」)。它給的逃生口是
   「allow the use of the **forgotten password** functionality to log in, even if
   the account is locked out」—— **本專案尚無忘記密碼流程**,補上之前這條殘留成立。

   ⚠️ OWASP **未給具體數字**(門檻與時長皆列為「須考量的因素」);10 次與 1 秒起跳
   為本專案取值,不是引用。 */

export const MAX_CONSECUTIVE_FAILURES = 10
/* 指數起點取原文的例子 1 秒;上限 15 分鐘避免無限增長 */
export const LOCKOUT_BASE_SECONDS = 1
export const LOCKOUT_MAX_SECONDS = 900
/* 統計視窗:更早的失敗不再計入,否則昨天的失敗會影響今天 */
const WINDOW_MINUTES = 60

/* 逾越門檻後的鎖定秒數;回 0 表示未達門檻。 */
export function lockoutSeconds(consecutiveFailures: number): number {
  if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) return 0
  const over = consecutiveFailures - MAX_CONSECUTIVE_FAILURES
  return Math.min(LOCKOUT_BASE_SECONDS * 2 ** over, LOCKOUT_MAX_SECONDS)
}

export async function isAccountLocked(pool: Pool, email: string): Promise<boolean> {
  const r = await pool.query<{ n: number; last: Date | null }>(
    `SELECT count(*)::int AS n, max(a.created_at) AS last
       FROM auth_audit a
       JOIN "user" u ON u.id = a.auth_user_id
      WHERE u.email = $1
        AND a.event = 'login.failure'
        AND a.created_at > now() - ($2 || ' minutes')::interval
        AND a.created_at > COALESCE(
              (SELECT max(s.created_at) FROM auth_audit s
                WHERE s.auth_user_id = u.id AND s.event = 'login.success'),
              'epoch'::timestamptz)`,
    [email, String(WINDOW_MINUTES)],
  )
  const row = r.rows[0]
  const seconds = lockoutSeconds(row?.n ?? 0)
  if (seconds === 0 || row?.last == null) return false
  /* 鎖定自**最後一次失敗**起算 → 等滿即自動解除,不需要任何人介入 */
  return Date.now() - row.last.getTime() < seconds * 1000
}
