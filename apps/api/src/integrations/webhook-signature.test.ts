import { describe, expect, it } from "vitest"
import {
  SIGNATURE_TOLERANCE_SECONDS,
  generateSecret,
  signPayload,
  verifySignature,
} from "./webhook-signature.js"

const BODY = '{"type":"record.created","data":{"id":1}}'
const ID = "msg_01HQ"
const TS = 1_785_400_000

describe("Standard Webhooks 簽章", () => {
  it("簽出來的可被同一把秘鑰驗過", () => {
    const secret = generateSecret()
    const header = signPayload({ messageId: ID, timestamp: TS, body: BODY, secret })
    expect(
      verifySignature({ messageId: ID, timestamp: TS, body: BODY, secret, header, nowSeconds: TS }),
    ).toBe(true)
  })

  it.each([
    ["body 被改", { body: `${BODY} ` }],
    ["messageId 被改", { messageId: "msg_other" }],
    ["timestamp 被改", { timestamp: TS + 1 }],
  ])("%s → 驗不過(三者都在簽章輸入內)", (_label, patch) => {
    const secret = generateSecret()
    const header = signPayload({ messageId: ID, timestamp: TS, body: BODY, secret })
    const verified = verifySignature({
      messageId: ID,
      timestamp: TS,
      body: BODY,
      secret,
      header,
      nowSeconds: TS,
      ...patch,
    })
    expect(verified).toBe(false)
  })

  it("換一把秘鑰驗不過", () => {
    const header = signPayload({
      messageId: ID,
      timestamp: TS,
      body: BODY,
      secret: generateSecret(),
    })
    const verified = verifySignature({
      messageId: ID,
      timestamp: TS,
      body: BODY,
      secret: generateSecret(),
      header,
      nowSeconds: TS,
    })
    expect(verified).toBe(false)
  })

  /* 🔴 這條是不採 GitHub/Shopify 做法的理由:它們沒有時戳,
     攔到的請求可以無限期重放。對 ERP 過帳而言等同可以重複過帳。 */
  it("超過容忍窗即拒(防重放)", () => {
    const secret = generateSecret()
    const header = signPayload({ messageId: ID, timestamp: TS, body: BODY, secret })
    const justInside = TS + SIGNATURE_TOLERANCE_SECONDS - 1
    const justOutside = TS + SIGNATURE_TOLERANCE_SECONDS + 1
    expect(
      verifySignature({
        messageId: ID,
        timestamp: TS,
        body: BODY,
        secret,
        header,
        nowSeconds: justInside,
      }),
    ).toBe(true)
    expect(
      verifySignature({
        messageId: ID,
        timestamp: TS,
        body: BODY,
        secret,
        header,
        nowSeconds: justOutside,
      }),
    ).toBe(false)
  })

  /* 🔴 零停機輪替:輪替後同一 header 帶兩個簽章,
     還在用舊秘鑰的消費端**不會中斷**。這是採 Standard Webhooks 的主要理由之一。 */
  it("輪替期間新舊秘鑰都驗得過", () => {
    const oldSecret = generateSecret()
    const newSecret = generateSecret()
    const header = signPayload({
      messageId: ID,
      timestamp: TS,
      body: BODY,
      secret: newSecret,
      secretPrev: oldSecret,
    })
    expect(header.split(" ")).toHaveLength(2)
    for (const secret of [newSecret, oldSecret]) {
      expect(
        verifySignature({
          messageId: ID,
          timestamp: TS,
          body: BODY,
          secret,
          header,
          nowSeconds: TS,
        }),
      ).toBe(true)
    }
  })

  it("秘鑰有 whsec_ 前綴且足夠長", () => {
    const secret = generateSecret()
    expect(secret.startsWith("whsec_")).toBe(true)
    expect(secret.length).toBeGreaterThan(40)
    expect(generateSecret()).not.toBe(secret)
  })
})
