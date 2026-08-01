import { describe, expect, it } from "vitest"
import { checkPassword } from "../src/auth/password-blocklist.js"

/* 🔴 OQ-SC-11=A|NIST SP 800-63B-4 §3.1.1.2 的 SHALL:比對外洩 / 常見 / 情境字。 */

describe("常見・外洩語料(整串比對)", () => {
  it("擋掉語料裡的密碼", () => {
    expect(checkPassword("password")).toBe("common")
    expect(checkPassword("qwerty")).toBe("common")
    expect(checkPassword("iloveyou")).toBe("common")
  })

  it("大小寫不影響判定", () => {
    expect(checkPassword("PassWord")).toBe("common")
  })

  /* 🔴 原文要求比對**整串**,不是子字串 —— 否則含有 "password" 的長密碼
     會被誤擋,使用者只能靠猜。 */
  it("🔴 只是**包含**常見字不算命中", () => {
    expect(checkPassword("correct-horse-password-battery")).toBeNull()
  })
})

describe("🔴 情境字(本專案的主力守備)", () => {
  /* 15 字政策下,49,233 筆語料只有 41 筆長度 ≥15 —— 單因子使用者幾乎撞不到語料。
     真正會發生的是「公司名 + 年份」這種:長度夠、但正是 63B-4 點名要擋的。 */
  it("🔴 服務名 / 公司名 / 自己的名字加裝飾仍被擋", () => {
    expect(checkPassword("Weyver-2026-0801!")).toBe("context")
    expect(checkPassword("XianYong20260801!", { orgName: "XianYong" })).toBe("context")
    expect(checkPassword("wang.xiaoming.2026", { name: "WangXiaoMing" })).toBe("context")
  })

  it("🔴 email 的帳號部分也算情境字", () => {
    expect(checkPassword("ahern-2026-0801!", { email: "ahern@weyver.test" })).toBe("context")
  })

  /* 刻意**不**做「包含即擋」—— 那會誤殺合法的長密碼短語,
     而被誤擋的人無從得知自己踩到什麼。 */
  it("🔴 只是提到公司名的長密碼短語不被誤殺", () => {
    expect(checkPassword("weyver-is-not-my-password-2026")).toBeNull()
  })
})

describe("連續 / 重複字元", () => {
  it("整串遞增遞減或全同即擋", () => {
    expect(checkPassword("abcdefghijklmnop")).toBe("trivial")
    expect(checkPassword("aaaaaaaaaaaaaaaa")).toBe("trivial")
  })

  it("只是局部有連續片段不算", () => {
    expect(checkPassword("Rk7abc-Mp2xz-Qw9tv")).toBeNull()
  })
})

describe("合法密碼放行", () => {
  it("隨機長密碼不被擋", () => {
    expect(checkPassword("s3cret-passw0rd")).toBeNull()
    expect(checkPassword("Tp9-vRk2-Lm4x-Qz7w")).toBeNull()
  })
})
