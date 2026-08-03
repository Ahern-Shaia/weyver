import { BadRequestException, Inject, Injectable } from "@nestjs/common"
import { eq } from "drizzle-orm"
import { TenantDb } from "../db/db.module.js"
import { tenants } from "../db/schema.js"
import { postJsonSafely } from "../http/safe-post.js"
import { SsrfBlockedError } from "../http/ssrf-guard.js"
import { ChannelConfigService } from "./channel-config.service.js"
import { CHANNELS, type ChannelId, isAllowedUrl } from "./channel-registry.js"

/* 🔴 R1·A-1 M4|通道發送(測試發送與日後的實際投遞共用)。

   五個 webhook / token 型通道的差別只有「POST 到哪、body 長什麼樣」,
   故用一份 `payloadFor` 描述,不寫五個 driver ——
   五份幾乎相同的程式碼會各自演化,而安全性質(allow-list / 禁轉址)最容易在
   複製時掉一份。

   ## SMTP 不在這裡

   SMTP 不是 HTTPS,且 host 天生由客戶決定(沒有 allow-list 可用)。
   它走既有的 `EmailChannel` + deny-list;混進來只會讓這個檔案得同時處理兩種傳輸。 */

export interface SendResult {
  readonly ok: boolean
  readonly detail: string
}

@Injectable()
export class ChannelSenderService {
  constructor(
    @Inject(ChannelConfigService) private readonly configs: ChannelConfigService,
    /* 只為了取公司名放進測試訊息。**刻意不注入 SettingsService** ——
       本模組是 `@Global()`,而那成立的前提正是「只依賴 DbModule、不 import 業務模組」
       (見 notifications.module.ts 的註解)。為了一個字串破壞它並不划算。 */
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  async sendTest(tenantId: number, channel: ChannelId): Promise<SendResult> {
    const spec = CHANNELS[channel]
    const named = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    )
    const tenantName = named[0]?.name ?? "Weyver"
    const result = await this.send(
      tenantId,
      channel,
      `Weyver 織雲測試訊息|${tenantName}|若你看得到這則訊息,表示 ${spec.label} 已連接成功。`,
    )
    /* 測試成功才記 verifiedAt —— 實際投遞不動它(那是「當初驗過」的意思,
       不該被日常投遞覆寫成「最近一次送出時間」)。 */
    if (result.ok) await this.configs.markVerified(tenantId, channel)
    return result
  }

  /* 🔴 實際送出。測試發送與事件廣播共用這一條 ——
     兩份實作會讓 allow-list 與禁轉址這兩道防線在其中一份悄悄消失。 */
  async send(tenantId: number, channel: ChannelId, text: string): Promise<SendResult> {
    const spec = CHANNELS[channel]
    if (channel === "smtp") {
      throw new BadRequestException({
        code: "CHANNEL_TEST_UNSUPPORTED",
        message: "SMTP 不走此路徑(非 HTTPS,由 EmailChannel 負責)",
      })
    }

    const secret = await this.configs.revealSecret(tenantId, channel)
    if (secret === null) {
      throw new BadRequestException({
        code: "CHANNEL_NOT_CONFIGURED",
        message: `尚未設定 ${spec.label} 的${spec.secretLabel}`,
      })
    }

    const status = (await this.configs.list(tenantId)).find((s) => s.channel === channel)
    const config = status?.config ?? {}

    const target = this.targetFor(channel, secret, config, text)

    /* 🔴 再驗一次 allow-list。存的時候已經驗過,但 `targetFor` 會把 config 的值
       (例如 Telegram 的 chatId)拼進 URL —— 拼接之後的結果必須重新確認。 */
    if (!isAllowedUrl(channel, target.url)) {
      throw new BadRequestException({
        code: "CHANNEL_URL_NOT_ALLOWED",
        message: `目標網址不在 ${spec.label} 的官方網域內`,
      })
    }

    try {
      const res = await postJsonSafely(target.url, JSON.stringify(target.body), target.headers)
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, detail: `已送出(HTTP ${String(res.status)})` }
      }
      /* 3xx 視為失敗:`https.request` 不跟隨轉址,而「先回公網 302 再跳內網」
         正是 SSRF 的典型繞法(承 webhook 投遞的同一判斷)。 */
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, detail: `目標回應 ${String(res.status)} 轉址;基於安全考量不跟隨` }
      }
      /* 🔴 回應片段可能含目標系統的錯誤說明,但**絕不可回傳我方送出的憑證**。
         這裡回的是對方的 body,不含 `secret`。 */
      return { ok: false, detail: `HTTP ${String(res.status)}:${res.body ?? "(無回應內容)"}` }
    } catch (error) {
      if (error instanceof SsrfBlockedError) return { ok: false, detail: error.message }
      /* 逾時 / DNS / TLS 皆走這裡。**不回傳原始例外訊息**以免夾帶內部位址。 */
      return { ok: false, detail: "無法連線到目標服務,請確認網址與網路狀態" }
    }
  }

  private targetFor(
    channel: ChannelId,
    secret: string,
    config: Record<string, unknown>,
    text: string,
  ): { url: string; body: unknown; headers: Record<string, string> } {
    const json = { "content-type": "application/json" }
    switch (channel) {
      case "slack":
        // secret 本身就是 incoming webhook URL
        return { url: secret, body: { text }, headers: json }
      case "teams":
        return { url: secret, body: { text }, headers: json }
      case "discord":
        return { url: secret, body: { content: text }, headers: json }
      case "telegram": {
        const chatId = String(config.chatId ?? "")
        if (chatId === "")
          throw new BadRequestException({
            code: "CHANNEL_CONFIG_INCOMPLETE",
            message: "請填寫 Chat ID",
          })
        /* token 在路徑裡是 Telegram 的 API 形狀;因此這個 URL 本身也是機密,
           不得寫進 log 或錯誤訊息。 */
        return {
          url: `https://api.telegram.org/bot${secret}/sendMessage`,
          body: { chat_id: chatId, text },
          headers: json,
        }
      }
      case "line": {
        const to = String(config.to ?? "")
        if (to === "")
          throw new BadRequestException({
            code: "CHANNEL_CONFIG_INCOMPLETE",
            message: "請填寫推送對象 ID",
          })
        /* LINE Notify 已於 2025-03-31 終止 → Messaging API 的 push endpoint */
        return {
          url: "https://api.line.me/v2/bot/message/push",
          body: { to, messages: [{ type: "text", text }] },
          headers: { ...json, authorization: `Bearer ${secret}` },
        }
      }
      case "smtp":
        throw new BadRequestException({
          code: "CHANNEL_TEST_UNSUPPORTED",
          message: "SMTP 不走此路徑",
        })
    }
  }
}
