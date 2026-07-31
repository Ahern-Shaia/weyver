import { randomInt } from "node:crypto"

/* 🔴 R1·A-1 M2|初始密碼產生(OQ-SC-14=A / 15=A / 16=A)。

   ## 為什麼是 15 個字元

   NIST SP 800-63B-**4** §3.1.1.2 逐字:
     「Verifiers and CSPs SHALL require passwords that are used as a **single-factor**
       authentication mechanism to be a minimum of **15 characters** in length.」

   ⚠️ **rev 3 的臨時密碼豁免已被刪除** —— rev 3 §5.1.1.1 曾寫
   「Memorized secrets chosen randomly by the CSP or verifier SHALL be at least
   **6 characters**」,63B-4 全文查無此句。故臨時密碼**沒有比較寬鬆的門檻**。
   要縮到 8 的唯一合法路徑是強制綁 MFA(同節第 1 條後半),本專案不採
   —— 那會讓 MFA 成為入職必經,對產線人員摩擦過大。

   對照:Ragic 官方的「隨機產生 10 碼」在 63B-4 下**不足**。此處刻意不照 parity。

   ## 為什麼管理員不能自選

   OWASP ASVS 5.0.0 §V6.4.6 逐字:
     「Verify that administrative users can initiate the password reset process for
       the user, but that this **does not allow them to change or choose the user's
       password**. **This prevents a situation where they know the user's password.**」

   → 本模組**只提供產生**,沒有任何「管理員輸入密碼」的入口。
   (⚠️ 誠實標注:V6.4.6 屬 L3 非 L1 強制;此處採嚴。Ragic 的「設定預設密碼」違反此條。)

   ## 字元集刻意避開易混淆字

   15 個隨機字元**唸不出來**,實務上一定是複製貼上或截圖傳送。
   即便如此仍去掉 `0/O/1/l/I`:一旦有人真的用唸的或手抄,那幾個字元就是客服電話的來源。
   去掉之後 57 個字元 × 15 位 ≈ **87.5 bits**,遠高於任何合理門檻。 */

/* 去掉 0 O 1 l I;保留其餘英數 + 少量符號(符號不含引號/反斜線,避免貼進終端或試算表出事) */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const INITIAL_PASSWORD_LENGTH = 15

/* ASVS §V6.4.1:「expire after a short period of time **or** after they are
   initially used」—— 兩個條件都做。72 小時為**本專案取值**:
   ⚠️ Entra / Google Workspace / Okta / Salesforce 四家官方文件**皆未載明**
   暫時密碼的絕對時效上限,查無可引之數字,故此處不宣稱有出處。 */
export const INITIAL_PASSWORD_TTL_HOURS = 72

export function generateInitialPassword(): string {
  /* `randomInt` 為 CSPRNG 且**無模數偏差**(Node 內部做 rejection sampling)——
      不可改用 `Math.random()`(AGENTS 🔒 禁令)或 `% ALPHABET.length`。 */
  let out = ""
  for (let i = 0; i < INITIAL_PASSWORD_LENGTH; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)]
  }
  return out
}

export function initialPasswordExpiry(now: Date): Date {
  return new Date(now.getTime() + INITIAL_PASSWORD_TTL_HOURS * 3_600_000)
}
