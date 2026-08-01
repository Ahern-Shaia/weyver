import { describe, expect, it } from "vitest"
import { isMfaExemptPath } from "./mfa-gate.js"

/* 🔴 強制 2FA 的閘門,錯一邊就是災難:
   · 漏擋 → 政策形同虛設
   · 誤擋帳號安全頁 → **全公司一起鎖死**,而且沒有救援路徑(管理員自己也進不去)

   GitHub 逐字:未啟用者「will not be able to access your organization's resources
   **until they enable 2FA on their account**」—— 「until they enable」這半句
   的意思就是登記那條路得留著。 */

describe("🔴 豁免路徑", () => {
  it("帳號安全頁的端點必須放行 —— 否則沒有人能去啟用", () => {
    expect(isMfaExemptPath("/api/security/sessions")).toBe(true)
    expect(isMfaExemptPath("/api/security/audit?limit=20")).toBe(true)
    /* app shell 要讀個人設定才渲染得出來 */
    expect(isMfaExemptPath("/api/settings/me")).toBe(true)
  })

  it("租戶資料一律擋", () => {
    expect(isMfaExemptPath("/api/forms")).toBe(false)
    expect(isMfaExemptPath("/api/forms/1/records")).toBe(false)
    /* 公司設定**不豁免**:未啟用 2FA 的管理員不該還能改公司設定 */
    expect(isMfaExemptPath("/api/settings/tenant")).toBe(false)
  })

  /* 🔴 前綴比對必須以 `/` 為界。`startsWith` 寫鬆一點,
     未來任何叫 `/api/security-xxx` 的新端點就會靜默變成免驗區。 */
  it("🔴 相似前綴不得誤放行", () => {
    expect(isMfaExemptPath("/api/securityfoo")).toBe(false)
    expect(isMfaExemptPath("/api/settings/members")).toBe(false)
    expect(isMfaExemptPath("/api/settings/mexico")).toBe(false)
  })
})
