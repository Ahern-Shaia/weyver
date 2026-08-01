import { describe, expect, it } from "vitest"
import { validateEnv } from "./env.js"

describe("env schema — BETTER_AUTH_SECRET(F-2 M1)", () => {
  it("dev 未設 secret → 回退明確 dev-only 佔位(≥32 字)", () => {
    const env = validateEnv({ NODE_ENV: "development" })
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32)
    expect(env.BETTER_AUTH_SECRET).toContain("dev-only")
  })

  it("production 缺 secret → fail-fast(拒開機)", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/)
  })

  it("production secret 過短(<32)→ 拒", () => {
    expect(() =>
      validateEnv({
        NODE_ENV: "production",
        // F-11:prod 停用掃毒須顯式承認;本測試聚焦其他驗證,故明示關閉
        MALWARE_SCAN_ACK_DISABLED: "1",
        BETTER_AUTH_SECRET: "tooshort",
      }),
    ).toThrow()
  })

  it("production 提供合法 secret → 採用(不覆寫為佔位)", () => {
    const secret = "a".repeat(48)
    const env = validateEnv({
      NODE_ENV: "production",
      // F-11:prod 停用掃毒須顯式承認;本測試聚焦其他驗證,故明示關閉
      MALWARE_SCAN_ACK_DISABLED: "1",
      BETTER_AUTH_SECRET: secret,
      // A-1 M4:prod 亦必填第三方憑證加密的 KEK
      WEYVER_SECRET_KEK: "k".repeat(48),
      APP_DATABASE_URL: "postgres://weyver_app_login:pw@db:5432/weyver",
    })
    expect(env.BETTER_AUTH_SECRET).toBe(secret)
  })
})

/* 🔴 #96 實走發現:app 車道未設 → 靜默回落到 migration 特權角色 → RLS 完全不執法。
   與 #98(NODE_ENV 未設即 dev 旁路)同一類:安全機制在設定缺漏時無聲失效。 */
describe("env schema — APP_DATABASE_URL(app 車道不得為特權連線)", () => {
  const secret = "a".repeat(48)

  it("dev 未設 → 回落 DATABASE_URL(開發便利,由開機自檢警告)", () => {
    const env = validateEnv({ NODE_ENV: "development" })
    expect(env.APP_DATABASE_URL).toBe(env.DATABASE_URL)
  })

  it("production 未設 → fail-fast", () => {
    expect(() =>
      validateEnv({
        NODE_ENV: "production",
        // F-11:prod 停用掃毒須顯式承認;本測試聚焦其他驗證,故明示關閉
        MALWARE_SCAN_ACK_DISABLED: "1",
        BETTER_AUTH_SECRET: secret,
        WEYVER_SECRET_KEK: "k".repeat(48),
      }),
    ).toThrow(/APP_DATABASE_URL/)
  })

  it("production 設成與 DATABASE_URL 相同 → 拒(等同沒設)", () => {
    const url = "postgres://weyver:pw@db:5432/weyver"
    expect(() =>
      validateEnv({
        NODE_ENV: "production",
        // F-11:prod 停用掃毒須顯式承認;本測試聚焦其他驗證,故明示關閉
        MALWARE_SCAN_ACK_DISABLED: "1",
        BETTER_AUTH_SECRET: secret,
        WEYVER_SECRET_KEK: "k".repeat(48),
        DATABASE_URL: url,
        APP_DATABASE_URL: url,
      }),
    ).toThrow(/APP_DATABASE_URL/)
  })

  it("production 設成不同角色 → 通過", () => {
    const env = validateEnv({
      NODE_ENV: "production",
      // F-11:prod 停用掃毒須顯式承認;本測試聚焦其他驗證,故明示關閉
      MALWARE_SCAN_ACK_DISABLED: "1",
      BETTER_AUTH_SECRET: secret,
      WEYVER_SECRET_KEK: "k".repeat(48),
      DATABASE_URL: "postgres://weyver:pw@db:5432/weyver",
      APP_DATABASE_URL: "postgres://weyver_app_login:pw@db:5432/weyver",
    })
    expect(env.APP_DATABASE_URL).toContain("weyver_app_login")
  })
})

/* 🔴 A-1 M4|第三方憑證加密的 KEK。prod 回退到佔位值 = 全租戶的 LINE token /
   Slack webhook 共用一把**寫在原始碼裡**的金鑰,而且不會有任何錯誤訊息。 */
describe("env schema — WEYVER_SECRET_KEK(A-1 M4)", () => {
  it("dev 回退佔位值(本機不必設定即可啟動)", () => {
    const env = validateEnv({})
    expect(env.WEYVER_SECRET_KEK.length).toBeGreaterThanOrEqual(32)
    expect(env.WEYVER_SECRET_KEK).toContain("dev-only")
  })

  it("🔴 production 未設 → fail-fast", () => {
    expect(() =>
      validateEnv({
        NODE_ENV: "production",
        MALWARE_SCAN_ACK_DISABLED: "1",
        BETTER_AUTH_SECRET: "a".repeat(48),
        APP_DATABASE_URL: "postgres://weyver_app_login:pw@db:5432/weyver",
      }),
    ).toThrow(/WEYVER_SECRET_KEK/)
  })

  /* 🔴 與 BETTER_AUTH_SECRET **分開**(NIST SP 800-57 §5.2 金鑰用途分離)——
     共用一把的話,其中一個用途外洩就同時毀掉另一個。 */
  it("🔴 不得回落成 BETTER_AUTH_SECRET", () => {
    const env = validateEnv({ BETTER_AUTH_SECRET: "a".repeat(48) })
    expect(env.WEYVER_SECRET_KEK).not.toBe(env.BETTER_AUTH_SECRET)
  })
})
