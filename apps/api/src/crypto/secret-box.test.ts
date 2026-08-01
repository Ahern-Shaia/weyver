import { describe, expect, it } from "vitest"
import { openSecret, rewrapSecret, sealSecret } from "./secret-box.js"

/* 🔴 OQ-SC-6=A|信封加密。這一組測的不是「加密會不會跑」,
   而是四條**出事時才會發現**的性質。 */

const KEK = "dev-kek-material-0123456789abcdef"
const TOKEN = "fake-channel-credential-for-tests"

describe("封裝 / 開啟", () => {
  it("原封不動地還原明文", () => {
    expect(openSecret(sealSecret(TOKEN, KEK).sealed, KEK)).toBe(TOKEN)
  })

  it("中文與長字串亦可", () => {
    const s = "密碼：鮮勇食品-2026-報表通知-🔔"
    expect(openSecret(sealSecret(s, KEK).sealed, KEK)).toBe(s)
  })

  /* 🔴 同一份明文每次封裝都要不同 —— 否則從密文即可看出「這兩個租戶用同一組 token」,
     那本身就是洩漏。GCM 每次用新的隨機 IV + 新的 DEK 才成立。 */
  it("🔴 同一份明文兩次封裝的密文必須不同", () => {
    expect(sealSecret(TOKEN, KEK).sealed).not.toBe(sealSecret(TOKEN, KEK).sealed)
  })

  it("🔴 換了 KEK 就打不開(而不是回傳垃圾)", () => {
    const sealed = sealSecret(TOKEN, KEK).sealed
    expect(() => openSecret(sealed, "another-kek-material-9876543210")).toThrow()
  })

  /* 🔴 GCM 的驗證標籤要真的生效:密文被動過手腳時**必須拋**,
     而不是還原出一段被竄改的「明文」再被我們拿去呼叫第三方。 */
  it("🔴 密文被竄改必須拋,不得回傳被動過手腳的明文", () => {
    const parts = sealSecret(TOKEN, KEK).sealed.split(".")
    const body = Buffer.from(parts[7] ?? "", "base64url")
    body[0] = (body[0] ?? 0) ^ 0xff
    parts[7] = body.toString("base64url")
    expect(() => openSecret(parts.join("."), KEK)).toThrow()
  })

  it("空字串不得封裝 —— 那代表呼叫端拿到了空值卻以為存進去了", () => {
    expect(() => sealSecret("", KEK)).toThrow()
  })
})

describe("指紋", () => {
  /* 指紋存在的唯一理由:讓稽核與 UI 說得出「這次換的值與上次不同」,
     而**不必存或回顯明文**。 */
  it("同明文同指紋、不同明文不同指紋", () => {
    expect(sealSecret(TOKEN, KEK).fingerprint).toBe(sealSecret(TOKEN, KEK).fingerprint)
    expect(sealSecret(TOKEN, KEK).fingerprint).not.toBe(sealSecret(`${TOKEN}x`, KEK).fingerprint)
  })

  it("🔴 指紋不得洩漏明文內容", () => {
    const fp = sealSecret(TOKEN, KEK).fingerprint
    expect(fp).not.toContain("xoxb")
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe("🔴 KEK 輪替", () => {
  /* 信封的全部意義在此:輪替時只重新包裝 DEK,**明文從頭到尾沒有出現過**
     (承 Vault transit rewrap 逐字「does not reveal the plaintext data」)。
     若直接用 KEK 加密資料,輪替就得把每一筆解密再加密 —— 等於讓全部明文
     在輪替當下一次出現在記憶體裡。 */
  it("🔴 輪替後用新 KEK 開得開、舊 KEK 開不開,明文不變", () => {
    const NEW = "rotated-kek-material-abcdef0123456789"
    const sealed = sealSecret(TOKEN, KEK).sealed
    const rewrapped = rewrapSecret(sealed, KEK, NEW, "2")

    expect(openSecret(rewrapped, NEW)).toBe(TOKEN)
    expect(() => openSecret(rewrapped, KEK)).toThrow()
  })

  it("輪替只換 wrapped DEK,資料密文原封不動", () => {
    const sealed = sealSecret(TOKEN, KEK).sealed
    const rewrapped = rewrapSecret(sealed, KEK, "another-kek-material-9876543210", "2")
    // 最後一段 = 資料密文
    expect(rewrapped.split(".")[7]).toBe(sealed.split(".")[7])
  })
})
