import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CHANNEL_IDS } from "./channel-registry.js"

/* 🔴 前後端的通道清單必須一致。

   ## 為什麼要用機器擋

   2026-08-05 加 WhatsApp 時,後端 `ChannelId` 加了、前端 `use-channels.ts` 的
   `z.enum` 忘了 → 解析失敗 → **整個通道設定頁掛掉**,畫面上只剩一段 zod 錯誤。

   這與 audit-D §2.2 抓到的簽核 `fieldRef` 是**同一形狀**:前後端兩份鏡射,
   加了一邊沒加另一邊。而後果不是「少一個選項」,是**整頁不能用**。
   ⚠️ 前一次的結論是「補上就好」——**然後它又發生了**。
   `pitfall_rule_without_check_always_drifts` 的第九次:規則沒有檢查就會漏。

   ## 為什麼是讀檔而不是 import

   前端不在本套件的相依裡(api 不該 import web)。讀原始碼比對是刻意的取捨:
   醜,但它擋得住,而「兩邊都要記得改」擋不住。 */

const WEB_SCHEMA = join(process.cwd(), "..", "web", "src", "lib", "engine", "use-channels.ts")

describe("通道清單前後端一致", () => {
  it("🔴 `use-channels.ts` 的 z.enum 必須含後端全部通道", () => {
    const text = readFileSync(WEB_SCHEMA, "utf8")
    const m = /channel:\s*z\.enum\(\[([^\]]+)\]\)/.exec(text)
    expect(m, "找不到前端的 channel enum —— 若已改名,這條檢查要跟著改").not.toBeNull()
    const front = [...(m?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((x) => x[1])
    expect([...front].sort()).toEqual([...CHANNEL_IDS].sort())
  })
})
