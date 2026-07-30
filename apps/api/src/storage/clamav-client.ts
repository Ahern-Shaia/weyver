import net from "node:net"

/* 🔴 F-11 M3|clamd INSTREAM 客戶端。

   ## 為什麼自己寫而不用 `clamscan` npm

   研究盤了三個套件,只有 `clamscan`(MIT、462K 週下載)還活著,但:

   - **CVE-2020-7613**:它的 local-binary 模式有 command injection
     (`_is_clamav_binary`)。教訓不是「升級就好」,而是**那個模式本身就是注入面** ——
     我們只需要 TCP,不需要它去找、去執行本機的 clamscan binary。
   - 2.4.0 已 ~21 個月未發版。

   INSTREAM 協定極簡(下面四十行就是全部),自己寫少一個依賴、少一個注入面,
   而且行為完全可控。研究本身也把「~200 行自實作」列為退路。

   ## 協定

   ```
   → zINSTREAM\0
   → <4-byte BE length><chunk> …
   → <4-byte BE zero>            (結束)
   ← "stream: OK\0"  或  "stream: <SIG> FOUND\0"  或  "… ERROR\0"
   ```

   ## 🔴 三種結果,不是兩種

   AWS 的兩套實作(CDK construct 的 bucket tag、GuardDuty)都明確承認第三態。
   把 ERROR 當成 clean 是最糟的失敗模式 —— 尤其 `AlertExceedsMax yes` 之後,
   archive bomb 正是以 `Heuristics.Limits.Exceeded` 這個形式回來的。 */

export type ClamVerdict =
  | { readonly status: "clean" }
  | { readonly status: "infected"; readonly signature: string }
  | { readonly status: "error"; readonly detail: string }

export interface ClamOptions {
  readonly host: string
  readonly port: number
  readonly timeoutMs: number
}

const CHUNK_SIZE = 64 * 1024

export async function scanBuffer(buf: Buffer, opts: ClamOptions): Promise<ClamVerdict> {
  return new Promise<ClamVerdict>((resolve) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port })
    let response = ""
    let settled = false

    const finish = (verdict: ClamVerdict): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(verdict)
    }

    socket.setTimeout(opts.timeoutMs, () => {
      finish({ status: "error", detail: `clamd 逾時(${String(opts.timeoutMs)}ms)` })
    })
    socket.on("error", (err) => {
      finish({ status: "error", detail: `clamd 連線失敗:${err.message}` })
    })

    socket.on("connect", () => {
      socket.write("zINSTREAM\0")
      for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
        const chunk = buf.subarray(i, i + CHUNK_SIZE)
        const header = Buffer.alloc(4)
        header.writeUInt32BE(chunk.length, 0)
        socket.write(header)
        socket.write(chunk)
      }
      // 長度 0 表示串流結束
      socket.write(Buffer.alloc(4))
    })

    socket.on("data", (data: Buffer) => {
      response += data.toString("utf8")
    })

    socket.on("close", () => {
      finish(parseResponse(response))
    })
  })
}

export function parseResponse(raw: string): ClamVerdict {
  const line = raw.replace(/\0/g, "").trim()
  if (line === "") return { status: "error", detail: "clamd 未回應" }
  /* 🔴 ERROR 要先判 —— 「stream: <something> ERROR」也含不到 OK,
     但若先比對 FOUND 會漏掉它。順序本身就是語意。 */
  if (line.endsWith("ERROR")) return { status: "error", detail: line }
  if (line.endsWith("FOUND")) {
    const signature = line.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "")
    return { status: "infected", signature }
  }
  if (line.endsWith("OK")) return { status: "clean" }
  return { status: "error", detail: `無法解析的 clamd 回應:${line}` }
}

export async function ping(opts: ClamOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port })
    let response = ""
    const done = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(opts.timeoutMs, () => done(false))
    socket.on("error", () => done(false))
    socket.on("connect", () => socket.write("zPING\0"))
    socket.on("data", (d: Buffer) => {
      response += d.toString("utf8")
      if (response.includes("PONG")) done(true)
    })
    socket.on("close", () => done(response.includes("PONG")))
  })
}
