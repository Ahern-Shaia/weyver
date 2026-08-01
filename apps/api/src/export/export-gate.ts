/* 🔴 R1·I-1 M2|唯讀租戶的匯出豁免。

   ## 為什麼必須有這一條

   `TenantGuard` 對停權(唯讀)租戶擋掉所有寫入方法,而**請求匯出是 POST**。
   不豁免的話,本模組上線後停權客戶依然拿不到資料 —— 而那正是它存在的第一個理由,
   也是 F-8 停權訊息裡逐字承諾的「可檢視與**匯出**資料」。

   設計文件 §7 把這件事列為「已知的自我打臉」第一條:救命出口被自己的閘門擋住。

   ## 為什麼是白名單而不是「唯讀時放行所有 POST」

   停權的語意是「不得**變更**資料」。匯出不變更任何業務資料,它只是把既有的讀出來;
   但同一個 POST 動詞底下還有建表、填單、過帳。逐條列出可放行的路徑,
   新增端點時預設被擋 —— 反過來寫的話,日後任何新的 POST 都會意外獲得停權豁免。 */

const READ_ONLY_EXEMPT = ["/api/exports"] as const

/* 🔴 `path` 可能是 undefined —— guard 拿到的 request 形狀不由本函式決定
   (既有的計費守衛單元測試就用最小假物件,沒有 `url`)。
   缺值時回 **false = 不豁免**:fail-closed,寧可多擋也不要意外放行。 */
export function isReadOnlyExemptPath(path: string | undefined): boolean {
  if (path === undefined) return false
  const clean = path.split("?")[0] ?? path
  /* 界線要求同 mfa-gate:`/api/exportsfoo` 不得因為前綴相同而被放行 */
  return READ_ONLY_EXEMPT.some((p) => clean === p || clean.startsWith(`${p}/`))
}
