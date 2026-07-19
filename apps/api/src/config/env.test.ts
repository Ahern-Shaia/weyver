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
    expect(() => validateEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: "tooshort" })).toThrow()
  })

  it("production 提供合法 secret → 採用(不覆寫為佔位)", () => {
    const secret = "a".repeat(48)
    const env = validateEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: secret })
    expect(env.BETTER_AUTH_SECRET).toBe(secret)
  })
})
