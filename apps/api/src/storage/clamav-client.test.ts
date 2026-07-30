import { describe, expect, it } from "vitest"
import { parseResponse } from "./clamav-client.js"

/* 🔴 回應解析。三種結果不是兩種 —— 把 ERROR 當成 clean 是最糟的失敗模式,
   尤其 `AlertExceedsMax yes` 之後,archive bomb 正是以
   `Heuristics.Limits.Exceeded ... ERROR` 這個形式回來的。 */
describe("clamd 回應解析", () => {
  it("乾淨", () => {
    expect(parseResponse("stream: OK\0")).toEqual({ status: "clean" })
  })

  it("感染 → 帶出簽章名(供鑑識與稽核)", () => {
    expect(parseResponse("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({
      status: "infected",
      signature: "Win.Test.EICAR_HDB-1",
    })
  })

  it("🔴 超限 → error 而非 clean(AlertExceedsMax 的回傳形式)", () => {
    const v = parseResponse("stream: Heuristics.Limits.Exceeded ERROR\0")
    expect(v.status).toBe("error")
  })

  it.each([
    ["空回應", ""],
    ["只有空白", "   \0  "],
    ["無法解析", "stream: something unexpected\0"],
  ])("%s → error(不預設為 clean)", (_l, raw) => {
    expect(parseResponse(raw).status).toBe("error")
  })

  it("🔴 判斷順序:含 ERROR 的回應不得被當成 FOUND 或 OK", () => {
    expect(parseResponse("stream: size limit exceeded ERROR\0").status).toBe("error")
  })
})
