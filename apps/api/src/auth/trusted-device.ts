import type { Pool } from "pg"

/* 🔴 信任裝置(「30 天內免驗」)的**撤銷**那一半。

   ## Better Auth 只做了一半

   逐行讀過 `plugins/two-factor/index.mjs` 後確認:`/two-factor/disable` 是從
   **當下這個請求的 cookie** 取出 identifier 才刪的 —— 也就是只撤掉「你現在用的
   這一台」。其他曾經勾過「記住這台裝置」的機器,記錄仍留在 `verification` 表裡。

   於是有一條真實的路徑:**停用 2FA → 再啟用 → 那些舊裝置仍然免驗**。
   使用者以為「停用再啟用」等於重來一次,實際上不是。

   ## 為什麼是直接刪表

   信任記錄沒有公開 API 可列舉 / 撤銷。資料形狀來自讀原始碼:`verification` 表,
   `identifier = trust-device-<32 隨機字元>`、`value = user id`、`"expiresAt" = 30 天後`(欄名為 camelCase,查詢要加引號),
   且**每次登入輪替**(舊 identifier 刪除、發新的)。故以 identifier 前綴 + value
   即可精準命中某使用者的全部信任裝置。

   ⚠️ 這是對 Better Auth 內部資料表的耦合。升級套件時要重看這裡 ——
   `trusted-device.integration.test` 會在形狀改變時轉紅。 */

export async function revokeTrustedDevicesFor(pool: Pool, authUserId: string): Promise<number> {
  const res = await pool.query(
    `DELETE FROM "verification" WHERE identifier LIKE 'trust-device-%' AND value = $1`,
    [authUserId],
  )
  return res.rowCount ?? 0
}

export async function countTrustedDevicesFor(pool: Pool, authUserId: string): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM "verification"
      WHERE identifier LIKE 'trust-device-%' AND value = $1 AND "expiresAt" > now()`,
    [authUserId],
  )
  return Number(res.rows[0]?.n ?? 0)
}
