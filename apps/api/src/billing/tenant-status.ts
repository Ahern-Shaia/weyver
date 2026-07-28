/* F-8 M1|租戶生命週期狀態(OQ-SB-5=A 停權唯讀)。

   ⚠️ **白名單式判斷,不是黑名單**(FMEA B1)。若寫成「不是 active 就擋」,
   一個未知 / 拼錯 / 未來新增的狀態值就會擋掉全部客戶 —— 這是能讓整個平台停擺的那種錯誤。
   因此:**只有明確列在 BLOCKED 裡的狀態才受限,其餘一律放行**。 */

/* 停權 / 取消 → 唯讀。刻意**不封鎖登入與讀取**:
   完全封鎖會讓客戶連自己的資料都拿不出來,對 ERP 級系統是不可接受的商業風險,
   且資料屬於客戶,可能衍生法律爭議(design doc OQ-SB-5)。 */
const READ_ONLY_STATUSES: ReadonlySet<string> = new Set(["suspended", "cancelled"])

export function isReadOnlyStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && READ_ONLY_STATUSES.has(status)
}

/* 寫入類 HTTP 方法。GET / HEAD / OPTIONS 於唯讀狀態仍放行(取回資料的路徑要留著)。 */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase())
}
