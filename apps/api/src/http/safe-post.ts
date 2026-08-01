import { request as httpsRequest } from "node:https"
import { pinnedAgent, resolveSafeTarget } from "./ssrf-guard.js"

/* 對外 HTTPS POST 的**唯一**出口(G-1 webhook 投遞 / A-1 通知通道測試發送共用)。

   抽成一份的理由不是省行數,而是**這裡的安全性質來自「沒有做的事」**:

   · `https.request` 預設**不跟隨轉址** → 「先回公網 302 再跳內網」在此直接斷掉。
     這是預設值而非一行程式碼,所以複製一份時最容易在不知不覺中失去
     (例如改用 fetch/undici,它預設 `redirect: "follow"`)。
   · 連線用 `pinnedAgent` 釘死已驗證的 IP → 關掉 DNS rebinding 的時間差。

   兩份實作只要有一份改用別的 HTTP client,上面兩條就悄悄消失一半。 */

export const EGRESS_TIMEOUT_MS = 10_000
const RESPONSE_SNIPPET_BYTES = 512

export interface PostResult {
  readonly status: number
  /* 回應前段 —— 只是要讓使用者看得出哪裡不對,不做解析 */
  readonly body: string | null
}

/* 已解析並釘住 IP 之後的低階 POST。呼叫端若已自行 resolve(例如要重用 agent),
   可直接用這一支;否則用下面的 `postJsonSafely`。 */
export async function postJsonToTarget(
  url: URL,
  agent: ReturnType<typeof pinnedAgent>,
  body: string,
  headers: Readonly<Record<string, string>>,
  timeoutMs = EGRESS_TIMEOUT_MS,
): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port === "" ? 443 : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        agent,
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        let chunks = ""
        res.setEncoding("utf8")
        res.on("data", (c: string) => {
          if (chunks.length < RESPONSE_SNIPPET_BYTES) chunks += c
        })
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: chunks.slice(0, RESPONSE_SNIPPET_BYTES) })
        })
      },
    )
    req.on("timeout", () => {
      req.destroy(new Error("連線逾時"))
    })
    req.on("error", reject)
    req.end(body)
  })
}

/* 解析 → 驗證 → 釘 IP → POST → 收乾連線。 */
export async function postJsonSafely(
  rawUrl: string,
  body: string,
  headers: Readonly<Record<string, string>> = {},
  timeoutMs = EGRESS_TIMEOUT_MS,
): Promise<PostResult> {
  /* 🔴 每次都**重新解析並驗證** —— URL 的 DNS 可能在儲存之後才被改成內網 */
  const target = await resolveSafeTarget(rawUrl)
  const agent = pinnedAgent(target, timeoutMs)
  try {
    return await postJsonToTarget(target.url, agent, body, headers, timeoutMs)
  } finally {
    agent.destroy()
  }
}
