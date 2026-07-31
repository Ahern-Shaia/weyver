/* 🔴 TOTP 驗證失敗訊息映射。

   ## 為什麼需要這個

   原本兩處(登入二步頁 / 安全設定頁)都把**所有**失敗壓成「驗證碼錯誤」。
   但後端的重放防護(RFC 6238 §5.2,`totp-replay.ts`)會對**已用過的碼**回
   `TOTP_CODE_ALREADY_USED` —— 使用者看到「驗證碼錯誤」時,螢幕上那組碼在
   authenticator app 裡看起來仍然有效,他會一直重打同一組,**永遠不會成功**,
   而且畫面上沒有任何線索告訴他要等下一組。

   這是 e2e 追查時發現的:測試在同一個 30 秒 time step 內驗證兩次,
   第二次被正確擋下,但畫面訊息把「安全機制生效」講成「你打錯了」。

   ## 只針對具名錯誤碼分流,其餘一律通用訊息

   不逐一映射後端錯誤 —— 那會把「這個帳號有沒有啟用 2FA」之類的狀態洩漏出去。
   只有這一個錯誤碼值得分流,因為**它是唯一一個「使用者不改變行為就永遠過不了」的情況**。 */

const ALREADY_USED = "TOTP_CODE_ALREADY_USED"

export function totpErrorMessage(error: unknown, useBackup = false): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === ALREADY_USED) return "此驗證碼已使用過,請等 app 換下一組再輸入"
  return useBackup ? "備用碼錯誤或已使用" : "驗證碼錯誤"
}
