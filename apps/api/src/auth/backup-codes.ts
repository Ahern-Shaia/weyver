import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/* 🔴 F-4 追溯稽核|MFA 備用碼:單向雜湊 + 高熵。

   **原本的問題**|better-auth 的 twoFactor plugin 預設 `storeBackupCodes: "encrypted"`,
   以 app secret 對稱加密**可逆**存放,且有 serverOnly 的 `viewBackupCodes` 可明文取出。
   而 mfa.md 五處寫「雜湊儲存」—— **文件描述了一個比實際更安全的行為**。

   **關鍵洞見:要改的是碼長,不是雜湊演算法。**
   NIST SP 800-63B 對 look-up secret 的規定分兩段:
   - 所有 look-up secret **SHALL** 以 approved hash 儲存
   - **只有**安全強度 <112 bits 者才 **SHALL** 加鹽 + password hashing scheme(如 Argon2id)

   原本 10 碼 × 62 字元集 ≈ **59.5 bits** → 落在後段,被迫用 Argon2id(每次登入最多比對
   10 組 × ~50ms = 500ms)。**把碼加長到 ≥112 bits,前提就消失** —— HMAC-SHA256 即合規,
   10 組比對 <1ms。

   本實作:**24 字元 base32 = 120 bits**。256 % 32 = 0,故 `byte % 32` 無 modulo bias。

   **為什麼是 HMAC(keyed hash)而非隨機加鹽**|better-auth 的驗證流程是
   「解出整批 → `includes(使用者輸入)`」,我們以 hook 把使用者輸入改寫成雜湊值再比對,
   因此**雜湊必須是確定性的**,無法 per-code random salt。
   NIST §5.1.1.2 允許 keyed-hash 並建議金鑰與資料分開存放 —— 故 pepper 走獨立 env,
   不與 `BETTER_AUTH_SECRET` 共用。
   高熵 + keyed hash + 速率限制(better-auth 內建 accountLockout 10 次/15 分)三者相扣,
   **不能只做一半**:若維持短碼又改快速雜湊,即違反 NIST。 */

/* 已雜湊值的前綴 —— 用於冪等判斷(見 storeBackupCodes 的 encrypt)。 */
export const HASH_TAG = "bc1$"

/* RFC 4648 base32 字母表(去除易混淆的 0/1/8/9 之外的完整 32 字元集)。 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const CODE_CHARS = 24

/* 10 組 —— 與 Google 一致(GitHub 為 16);數量本身非安全參數,是可用性參數 */
export const BACKUP_CODE_COUNT = 10

export function generateBackupCode(): string {
  const bytes = randomBytes(CODE_CHARS)
  const raw = Array.from(bytes, (b) => ALPHABET[b % 32] ?? "A").join("")
  /* 每 4 字元一組以利人工抄寫;正規化時會去掉 */
  return raw.replace(/(.{4})(?=.)/g, "$1-")
}

/* 正規化:去分隔線、去空白、大寫 —— 使用者手抄時的常見變異不應導致驗證失敗。 */
function normalize(code: string): string {
  return code.trim().toUpperCase().replaceAll("-", "").replaceAll(" ", "")
}

export function hashBackupCode(code: string, pepper: string): string {
  return HASH_TAG + createHmac("sha256", pepper).update(normalize(code)).digest("base64url")
}

export function isHashed(value: string): boolean {
  return value.startsWith(HASH_TAG)
}

/* 等長比較走 timingSafeEqual;長度不同直接回 false(長度本身非機密)。 */
export function backupCodeMatches(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/* 🔴 TOTP 重放防護(RFC 6238 §5.2)。

   原文:「The verifier **MUST NOT** accept the second attempt of the OTP after the
   successful validation has been issued for the first OTP.」

   better-auth 1.6.23 無 used 記錄 → 同一組六位碼在 90 秒窗內(window=1)可重複使用。
   儲存「上次成功驗證的 time step」而非碼本身 —— step 為單調遞增整數,不含機密,
   且天然涵蓋整個時間窗(同一 step 內的碼相同)。

   TOTP 標準週期 30 秒(RFC 6238 建議之預設)。 */
export const TOTP_PERIOD_SECONDS = 30

export function currentTotpStep(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS)
}

/* 只接受**嚴格大於**上次成功的 step。
   等於 → 同一窗內重放;小於 → 時鐘回撥或更舊的碼,兩者皆拒。 */
export function totpStepIsFresh(step: number, lastUsedStep: number | null): boolean {
  return lastUsedStep === null || step > lastUsedStep
}
