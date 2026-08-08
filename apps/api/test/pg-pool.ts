import pg from "pg"

/* 🔴 2026-08-08|測試用 `pg.Pool` 的統一建構器 —— **重點是那個 `'error'` 監聽**。

   `Pool` 是 EventEmitter,沒有 `'error'` 監聽者時 Node 會把事件**丟成 uncaught
   exception**,而不是 rejection —— 沒有任何 `await` 接得住它,vitest 會整批以 1 退出。

   測試裡一定會踩到:`container.stop()` 關掉 Postgres 時,對還開著的閒置連線
   送 `57P01`(admin_shutdown)。那是**預期的**,不是缺陷,不該讓整批測試變紅。

   ⚠️ 這不是把錯誤掃到地毯下 —— 真正的缺口在 prod(`db.module.ts` 的兩個 pool
   同樣沒掛,Cloud SQL 維護重啟就會讓 API 整個掛掉),已一併修掉。
   這裡只是讓測試環境的關機噪音不要偽裝成產品失敗。 */
export function testPool(connectionString: string, max?: number): pg.Pool {
  const pool = new pg.Pool(max === undefined ? { connectionString } : { connectionString, max })
  pool.on("error", () => {
    /* 關機期間的 FATAL 是預期的。不 rethrow,也不需記錄 —— 測試已有自己的斷言。 */
  })
  return pool
}
