import { dictionary } from "@zxcvbn-ts/language-common"

/* 🔴 R1·A-1 M3 / OQ-SC-11=A|外洩・常見密碼比對。

   NIST SP 800-63B-4 §3.1.1.2 對此為 **SHALL**,且點名四類:
   previous breach corpuses / dictionary words / repetitive or sequential characters /
   **context-specific words, such as the name of the service, the username,
   and derivatives thereof**。原文另要求比對**整串密碼,不是子字串**。

   ## 語料

   `@zxcvbn-ts/language-common` 的 `passwords-common`(**MIT**,Dropbox zxcvbn 語料,
   49,233 筆)。純本地檔案 —— 認證路徑上不打外部服務,不必為 HIBP 之類的
   range API 準備 timeout / circuit breaker / 離線降級。

   ## ⚠️ 一個誠實的觀察:在 15 字政策下,語料比對的作用被長度吃掉了

   49,233 筆中**只有 41 筆長度 ≥ 15**。也就是說單因子使用者幾乎不可能撞上語料;
   它真正的守備範圍是**已啟用 MFA 的 8 字路徑**。

   → 因此**情境字檢查才是這裡的主力**:`weyver` / 公司名 / 自己的 email
   這類字串很容易組成 16 字而通過長度檢查,而 63B-4 明確點名要擋。
   若只實作語料比對就宣稱「符合 SHALL」,那是形式上的合規、實質上的空轉。 */

let corpus: Set<string> | null = null

/* 49k 筆延後到第一次用到才建 Set —— 開機路徑不必為此多花時間 */
function commonPasswords(): Set<string> {
  corpus ??= new Set(dictionary["passwords-common"].map((p) => String(p).toLowerCase()))
  return corpus
}

export type BlockReason = "common" | "context" | "trivial"

/* 只做大小寫正規化。**不做 l33t 還原** —— 那會把比對變成模糊匹配,
   與原文「比對整串」的語意背離,也容易誤擋合法密碼。 */
const norm = (s: string): string => s.trim().toLowerCase()

/* 情境字:去掉常見的裝飾(數字 / 標點 / 空白)後,剩下的是不是就是那個字。
   例:`Weyver2026!` → `weyver`。這是原文「and derivatives thereof」的最小實作,
   刻意不擴大到「包含即擋」,否則 `weyverisnotmypassword` 這種也會被誤殺。 */
const stripDecoration = (s: string): string => s.replace(/[^a-z一-鿿]/gi, "").toLowerCase()

/* 全同字元 / 完全單調遞增遞減 —— 原文的「repetitive or sequential characters」。
   只認整串都是,不抓局部,同樣是為了不誤殺。 */
function isTrivialSequence(password: string): boolean {
  if (password.length < 4) return false
  const codes = [...password].map((c) => c.codePointAt(0) ?? 0)
  const allSame = codes.every((c) => c === codes[0])
  if (allSame) return true
  const step = (codes[1] ?? 0) - (codes[0] ?? 0)
  if (step !== 1 && step !== -1) return false
  return codes.every((c, i) => i === 0 || c - (codes[i - 1] ?? 0) === step)
}

export interface PasswordContext {
  readonly email?: string | undefined
  readonly name?: string | undefined
  readonly orgName?: string | undefined
}

/* 服務名本身 —— 63B-4 逐字點名「the name of the service」 */
const SERVICE_WORDS = ["weyver", "織雲", "weyver織雲"]

export function checkPassword(password: string, context: PasswordContext = {}): BlockReason | null {
  const lower = norm(password)
  if (lower === "") return null

  if (commonPasswords().has(lower)) return "common"
  if (isTrivialSequence(password)) return "trivial"

  const bare = stripDecoration(password)
  if (bare !== "") {
    const words = [
      ...SERVICE_WORDS,
      context.email?.split("@")[0] ?? "",
      context.name ?? "",
      context.orgName ?? "",
    ]
      .map(stripDecoration)
      .filter((w) => w.length >= 3)
    if (words.includes(bare)) return "context"
  }
  return null
}

/* 訊息說得出「該怎麼辦」——只講「密碼不安全」的話,使用者只會再試一個同樣類型的。
   ⚠️ 不回報命中的是哪一筆語料,那等於替攻擊者確認字典內容。 */
export function blockedPasswordMessage(reason: BlockReason): string {
  switch (reason) {
    case "common":
      return "這組密碼出現在公開的外洩密碼清單中,請換一組沒用過的"
    case "context":
      return "密碼不能只是公司名、你的名字或系統名稱,請換一組無關聯的"
    case "trivial":
      return "密碼不能是連續或重複的字元,請換一組"
  }
}
