import crypto from "node:crypto"

/* G-1 M3|Standard Webhooks 簽章(OQ-WH-2=A)。

   採此規格而非自訂,理由是**客戶接得快**:各語言有現成 verify 套件,
   不必為了驗簽讀我們的文件。規格同時給到三樣東西:
   - `webhook-id` —— 消費端去重的鍵(重送時**沿用同一個**)
   - `webhook-timestamp` —— 防重放。GitHub / Shopify 沒有這個,
     它們把防重放責任推給消費端;對 ERP 過帳場景太弱,不採。
   - `webhook-signature` —— **同一 header 內空白分隔多個簽章** → 秘鑰輪替零停機

   簽的是 `{id}.{timestamp}.{body}`,HMAC-SHA256,base64,前綴 `v1,`。 */

export const SIGNATURE_TOLERANCE_SECONDS = 300

export function generateSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`
}

function rawKey(secret: string): Buffer {
  const body = secret.startsWith("whsec_") ? secret.slice(6) : secret
  return Buffer.from(body, "base64url")
}

function signOne(secret: string, signedPayload: string): string {
  return crypto.createHmac("sha256", rawKey(secret)).update(signedPayload).digest("base64")
}

/* 輪替期間新舊兩把並存 → 出兩個簽章,消費端只要其中一個對得上即可。
   舊秘鑰在重疊窗結束後清掉。 */
export function signPayload(input: {
  readonly messageId: string
  readonly timestamp: number
  readonly body: string
  readonly secret: string
  readonly secretPrev?: string | null
}): string {
  const signed = `${input.messageId}.${String(input.timestamp)}.${input.body}`
  const parts = [`v1,${signOne(input.secret, signed)}`]
  if (input.secretPrev !== undefined && input.secretPrev !== null && input.secretPrev !== "") {
    parts.push(`v1,${signOne(input.secretPrev, signed)}`)
  }
  return parts.join(" ")
}

/* 供測試與消費端範例用。常數時間比對 —— 一般比對會洩漏前綴匹配長度。 */
export function verifySignature(input: {
  readonly messageId: string
  readonly timestamp: number
  readonly body: string
  readonly secret: string
  readonly header: string
  readonly nowSeconds?: number
}): boolean {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - input.timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false

  const expected = signOne(
    input.secret,
    `${input.messageId}.${String(input.timestamp)}.${input.body}`,
  )
  const expectedBuf = Buffer.from(expected)
  for (const candidate of input.header.split(" ")) {
    const value = candidate.startsWith("v1,") ? candidate.slice(3) : ""
    if (value === "") continue
    const buf = Buffer.from(value)
    if (buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf)) return true
  }
  return false
}
