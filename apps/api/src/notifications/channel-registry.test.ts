import { describe, expect, it } from "vitest"
import { CHANNELS, isAllowedUrl, isChannelId } from "./channel-registry.js"

/* 🔴 OQ-SC-8=A|固定 host 的通道走 allow-list
   (OWASP SSRF 逐字「Deny-lists are bypass-prone. Prefer allow-lists.」)。 */

describe("allow-list", () => {
  it("放行官方 host", () => {
    expect(isAllowedUrl("slack", "https://hooks.slack.com/services/EXAMPLE-NOT-REAL")).toBe(true)
    expect(isAllowedUrl("discord", "https://discord.com/api/webhooks/1/abc")).toBe(true)
  })

  /* 🔴 後綴伎倆:攻擊者註冊 `hooks.slack.com.evil.example`,
     用 `includes()` 或 `endsWith()` 寫的檢查會直接放行。 */
  it("🔴 擋掉後綴偽裝的 host", () => {
    expect(isAllowedUrl("slack", "https://hooks.slack.com.evil.example/x")).toBe(false)
    expect(isAllowedUrl("slack", "https://evil.example/hooks.slack.com")).toBe(false)
  })

  it("🔴 擋掉內網與雲 metadata —— allow-list 天生就擋掉了", () => {
    expect(isAllowedUrl("slack", "http://169.254.169.254/latest/meta-data/")).toBe(false)
    expect(isAllowedUrl("slack", "https://127.0.0.1/x")).toBe(false)
    expect(isAllowedUrl("slack", "https://10.0.0.5/x")).toBe(false)
  })

  it("🔴 非 https 一律拒絕", () => {
    expect(isAllowedUrl("slack", "http://hooks.slack.com/services/x")).toBe(false)
  })

  it("不是 URL 的字串不得通過", () => {
    expect(isAllowedUrl("slack", "hooks.slack.com")).toBe(false)
    expect(isAllowedUrl("slack", "")).toBe(false)
  })

  /* SMTP 的 host 由客戶決定 → 沒有 allow-list 可用,必須走既有的 deny-list。
     這條測試把「SMTP 不在 allow-list 體系內」釘住,免得日後有人以為它被保護了。 */
  it("🔴 SMTP 不走 allow-list(host 天生由客戶決定)", () => {
    expect(CHANNELS.smtp.allowedHosts).toHaveLength(0)
    expect(isAllowedUrl("smtp", "https://mail.example.com")).toBe(false)
  })
})

describe("通道註冊表", () => {
  it("每個通道都要說明機密欄位去哪裡拿", () => {
    for (const spec of Object.values(CHANNELS)) {
      expect(spec.secretLabel.length).toBeGreaterThan(0)
      expect(spec.secretHint.length).toBeGreaterThan(0)
    }
  })

  /* 🔴 LINE Notify 已於 2025-03-31 終止服務(官方 closing announcement),
     2025-04-01 起 API 與 token 簽發全部停止。若接成 Notify,一上線就是死的。 */
  it("🔴 LINE 走 Messaging API 的 api.line.me,不是已停止服務的 Notify", () => {
    expect(CHANNELS.line.allowedHosts).toContain("api.line.me")
    expect(CHANNELS.line.allowedHosts).not.toContain("notify-api.line.me")
  })

  it("isChannelId 只認得註冊過的通道", () => {
    expect(isChannelId("slack")).toBe(true)
    expect(isChannelId("wechat")).toBe(false)
    expect(isChannelId(null)).toBe(false)
  })
})
