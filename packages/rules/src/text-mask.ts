export interface TextMaskOptions {
  readonly mode?: "last" | "first" | "cjkName"
  readonly keep?: number
}

/* 遮罩字元。固定長度而**不隨原值長度變化** —— 讓 `****1234` 洩漏不出原值有幾位。
   Ragic 顯示的是逐字遮(長度可見),我方刻意不同:長度本身也是資訊
   (身分證固定 10 碼看不出什麼,但手機 / 帳號 / 病歷號的長度會縮小猜測空間)。 */
const DOTS = "••••"

/* 🔴 R1·FTP v1.7|文字遮罩(Ragic「文字欄位 → 文字遮罩」)。

   ## 為什麼住在共用 package

   遮罩後的字串**伺服器與前端都要產**:伺服器產的是真正送出去的值,
   前端在填單當下要即時預覽「存下去會長什麼樣」。兩份實作漂移的後果是
   使用者以為遮住了而其實沒有 —— 那比樣式不一致嚴重得多。
   先例:`@weyver/formula`(公式)與本 package 的條件式格式求值器。

   ## 🔴 這支只負責「長什麼樣」,不負責「誰能看」

   權限判斷在伺服器(`revealRoleIds`),而且**不能**由呼叫端傳一個布林進來決定 ——
   那等於把授權交給呼叫端。此處恆定回傳遮罩後的字串。 */
export function maskText(value: string, options: TextMaskOptions = {}): string {
  const raw = value.trim()
  if (raw === "") return ""
  const mode = options.mode ?? "last"
  const keep = Math.max(0, Math.min(options.keep ?? 4, 8))

  if (mode === "cjkName") {
    /* 中文姓名:遮中間。兩個字時遮第二個(「王小」→「王•」)——
       只有兩個字卻要「留頭留尾」的話等於沒遮。 */
    const chars = [...raw]
    if (chars.length <= 1) return "•"
    if (chars.length === 2) return `${chars[0] ?? ""}•`
    return `${chars[0] ?? ""}${"•".repeat(chars.length - 2)}${chars[chars.length - 1] ?? ""}`
  }

  const chars = [...raw]
  if (keep === 0 || chars.length <= keep) return DOTS
  const shown = mode === "first" ? chars.slice(0, keep) : chars.slice(chars.length - keep)
  return mode === "first" ? `${shown.join("")}${DOTS}` : `${DOTS}${shown.join("")}`
}

/* 值是不是「已經被遮罩過的」。

   🔴 這支是**寫入端的保護**,不是顯示用的。

   讀出來的是遮罩值,若使用者按了編輯又直接存檔,遮罩值就會蓋掉真值 ——
   **一次無心的儲存就永久毀掉一個身分證字號**,而且沒有任何錯誤訊息。
   Ragic 的解法是「編輯時清空、必須重新輸入」(官方逐字),
   我方在**伺服器端**再加一道:看起來像遮罩值的寫入一律拒絕。
   前端的清空是體驗,這一道才是保證。 */
export function looksMasked(value: unknown): boolean {
  return typeof value === "string" && value.includes(DOTS.charAt(0))
}
