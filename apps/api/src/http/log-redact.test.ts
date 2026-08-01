import { describe, expect, it } from "vitest"
import { MASK, redact } from "./log-redact.js"

/* 🔴 A-1 FMEA C1|日誌遮蔽。這一層防的不是現在的程式碼,是**以後某人順手 log 一個物件**。
   OWASP Logging 禁記清單逐字含 Access tokens / Authentication passwords /
   Database connection strings / Encryption keys。 */

const str = (v: unknown): string => JSON.stringify(redact(v))

describe("鍵名遮蔽", () => {
  it("password / token / secret / authorization 一律遮掉", () => {
    const out = str({
      password: "s3cret-passw0rd",
      accessToken: "abcdef123456",
      secretSealed: "v1.1.abc",
      authorization: "Bearer xyz",
      email: "a@b.test",
    })
    expect(out).not.toContain("s3cret-passw0rd")
    expect(out).not.toContain("abcdef123456")
    /* 非機密欄位必須保留 —— 全遮等於沒有 log */
    expect(out).toContain("a@b.test")
  })

  it("底線 / 連字號 / 大小寫的變體都認得", () => {
    expect(str({ API_KEY: "k", "private-key": "p", NewPassword: "n" })).not.toMatch(/[knp]"/)
  })

  it("巢狀物件與陣列都會被走到", () => {
    expect(str({ a: [{ b: { token: "deep-secret" } }] })).not.toContain("deep-secret")
  })
})

describe("🔴 值的形狀遮蔽(鍵名遮不到的情況)", () => {
  /* 🔴 本專案最具體的外洩形狀:Telegram 的 bot token **在 URL 路徑裡**,
     任何「把 URL 寫進 log」的新程式碼都會外洩它,而那個鍵可能叫 `url`。 */
  it("🔴 Telegram 的 bot token 在 URL 路徑裡也遮得掉", () => {
    const out = str({ url: "https://api.telegram.org/bot123456:AAH-real-token/sendMessage" })
    expect(out).not.toContain("AAH-real-token")
    expect(out).toContain(MASK)
  })

  it("🔴 我方的信封密文", () => {
    expect(str("憑證是 v1.1.kQGaeo0A1x0EFYrjZcabcdefghijklmn.xyz 請勿外流")).not.toContain(
      "kQGaeo0A1x0EFYrjZc",
    )
  })

  it("🔴 Slack / Discord webhook 網址", () => {
    const out = str("送到 https://hooks.slack.com/services/AAA/BBB/CCCDDD 失敗")
    expect(out).not.toContain("CCCDDD")
  })

  it("🔴 Authorization 標頭的值", () => {
    expect(str("headers: Bearer eyJhbGciOiJIUzI1NiJ9")).not.toContain("eyJhbGciOiJIUzI1NiJ9")
  })

  /* 連線字串**只遮密碼**:全遮的話「連哪一台」也查不出來,而那正是查問題要的資訊 */
  it("🔴 連線字串只遮密碼,保留 host 以便查問題", () => {
    const out = redact("postgres://weyver:hunter2@db.internal:5432/weyver") as string
    expect(out).not.toContain("hunter2")
    expect(out).toContain("db.internal")
    expect(out).toContain("weyver")
  })
})

describe("Error 與邊界", () => {
  it("Error 的訊息也會過一遍(例外最常夾帶 URL)", () => {
    const e = new Error("連線失敗 https://hooks.slack.com/services/X/Y/ZZZZ")
    expect(String(redact(e))).not.toContain("ZZZZ")
  })

  /* log 一個帶循環的物件不該讓程序爆掉 —— 遮蔽層自己絕不能是當機來源 */
  it("🔴 循環參照不會無限遞迴", () => {
    const a: Record<string, unknown> = { name: "x" }
    a["self"] = a
    expect(() => redact(a)).not.toThrow()
    expect(str(a)).toContain("循環參照")
  })

  it("一般訊息原封不動 —— 過度遮蔽等於沒有 log", () => {
    expect(redact("表單 #12 已建立,欄位 3 個")).toBe("表單 #12 已建立,欄位 3 個")
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
  })
})
