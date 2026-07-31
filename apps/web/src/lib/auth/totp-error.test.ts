import { describe, expect, it } from "vitest"
import { totpErrorMessage } from "./totp-error"

/* 這一層守「訊息要說得出使用者該做什麼」。
   e2e 只跑一條 golden path,把錯誤分支全塞進去會讓那條測試變成什麼都測、
   壞了指不出是哪裡(Fowler, PracticalTestPyramid)。 */

describe("totpErrorMessage", () => {
  it("🔴 重放被擋 → 告訴使用者「等下一組」,而不是「你打錯了」", () => {
    const msg = totpErrorMessage({ code: "TOTP_CODE_ALREADY_USED" })
    expect(msg).toContain("已使用過")
    expect(msg).toContain("下一組")
  })

  it("其餘錯誤一律通用訊息 —— 不逐一映射後端錯誤,免得洩漏帳號狀態", () => {
    expect(totpErrorMessage({ code: "INVALID_TWO_FACTOR_COOKIE" })).toBe("驗證碼錯誤")
    expect(totpErrorMessage({ code: "SOMETHING_ELSE" })).toBe("驗證碼錯誤")
    expect(totpErrorMessage(null)).toBe("驗證碼錯誤")
    expect(totpErrorMessage(undefined)).toBe("驗證碼錯誤")
    expect(totpErrorMessage("boom")).toBe("驗證碼錯誤")
  })

  it("備用碼模式的通用訊息不同(但重放訊息共用)", () => {
    expect(totpErrorMessage({ code: "X" }, true)).toBe("備用碼錯誤或已使用")
    expect(totpErrorMessage({ code: "TOTP_CODE_ALREADY_USED" }, true)).toContain("已使用過")
  })
})
