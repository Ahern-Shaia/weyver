/* 🔴 R1·A-1 M4|通知通道註冊表。這一份同時是三件事的**單一真相**:
   有哪些通道 / 每個通道要填什麼 / 允許連到哪些 host(OQ-SC-8=A 的 allow-list 來源)。

   ## 為什麼 allow-list

   OWASP SSRF Cheat Sheet 逐字:「**Deny-lists are bypass-prone. Prefer allow-lists.**」
   我方既有的 `ssrf-guard` 是 deny-list(擋私網段 + 雲 metadata),對「使用者可填任意
   URL」的 webhook 是唯一可行做法。但**通知通道不同** —— Slack / Teams / Discord /
   Telegram / LINE 的 host 都是固定的,沒有理由讓使用者填別的地方。
   → 這些通道走 allow-list;只有 SMTP 因為 host 天生由客戶決定,仍走 deny-list。

   ## ⚠️ LINE:Notify 已經沒了

   LINE Notify **已於 2025-03-31 終止服務**,2025-04-01 起 API、token 簽發全部停止
   (LINE 官方 closing announcement)。官方指定的替代是 **Messaging API**。
   故本專案的 LINE 通道走 `api.line.me` 的 push message + channel access token,
   **不是**坊間文件仍在教的 `notify-api.line.me`。寫成 Notify 的話,一上線就是死的。

   ## 憑證的形狀差很多,但「怎麼送」只有兩種

   Slack / Teams / Discord 是「POST 到一個本身就是機密的 URL」;
   Telegram / LINE 是「POST 到固定端點 + 帶 token」。
   兩者都只是 HTTPS POST,故用一份設定描述,不寫五個 driver。 */

export type ChannelId = "slack" | "teams" | "discord" | "telegram" | "line" | "whatsapp" | "smtp"

export interface ChannelSpec {
  readonly id: ChannelId
  readonly label: string
  /* 機密欄位在 UI 上的說明 —— 使用者要知道去哪裡拿這個值 */
  readonly secretLabel: string
  readonly secretHint: string
  /* 非機密設定欄位(key → 顯示名);空陣列 = 只需要機密欄位 */
  readonly configFields: readonly { readonly key: string; readonly label: string }[]
  /* 允許連到的 host(小寫、精確比對)。空 = 此通道不走 HTTP allow-list(SMTP) */
  readonly allowedHosts: readonly string[]
  /* 機密本身就是完整 URL(Slack / Teams / Discord 的 incoming webhook) */
  readonly secretIsUrl: boolean
}

export const CHANNELS: Readonly<Record<ChannelId, ChannelSpec>> = {
  slack: {
    id: "slack",
    label: "Slack",
    secretLabel: "Incoming Webhook URL",
    /* Slack 官方逐字:「Your webhook URL contains a secret. Don't share it online,
       including via public version control repositories.」→ 當機密處理有據。 */
    secretHint: "Slack App → Incoming Webhooks 產生。此網址本身即為機密,不會再次顯示。",
    configFields: [],
    allowedHosts: ["hooks.slack.com"],
    secretIsUrl: true,
  },
  teams: {
    id: "teams",
    label: "Microsoft Teams",
    secretLabel: "Incoming Webhook URL",
    /* ⚠️ Microsoft Learn 的 Incoming Webhook 文件**沒有任何保密敘述**。
       功能上與 Slack 等價故同等對待,但不得宣稱「Microsoft 說要保密」。 */
    secretHint: "Teams 頻道 → 連接器 → Incoming Webhook 產生。",
    configFields: [],
    allowedHosts: ["outlook.office.com", "outlook.office365.com"],
    secretIsUrl: true,
  },
  discord: {
    id: "discord",
    label: "Discord",
    secretLabel: "Webhook URL",
    secretHint: "頻道設定 → 整合 → Webhook 產生。",
    configFields: [],
    allowedHosts: ["discord.com", "discordapp.com"],
    secretIsUrl: true,
  },
  telegram: {
    id: "telegram",
    label: "Telegram",
    secretLabel: "Bot Token",
    secretHint: "與 @BotFather 對話建立 bot 後取得。",
    configFields: [{ key: "chatId", label: "Chat ID" }],
    allowedHosts: ["api.telegram.org"],
    secretIsUrl: false,
  },
  line: {
    id: "line",
    label: "LINE",
    secretLabel: "Channel Access Token",
    /* LINE Notify 已於 2025-03-31 終止 → 只能走 Messaging API */
    secretHint: "LINE Developers → Messaging API channel 取得(LINE Notify 已於 2025 停止服務)。",
    configFields: [{ key: "to", label: "推送對象 ID(user / group / room)" }],
    allowedHosts: ["api.line.me"],
    secretIsUrl: false,
  },
  /* 🔴 WhatsApp Business。走 **Meta Cloud API**(`graph.facebook.com`)——
     `/{phone-number-id}/messages` + Bearer token。

     ⚠️ **與其他通道有一個本質差異,必須讓設定者知道**:
     WhatsApp 只允許在使用者主動來訊後的 **24 小時服務窗**內自由發訊息;
     窗外只能送**事先核准的範本訊息**。我方送的是純文字通知,
     故實務上**只在對方近期回過訊息時送得出去** —— 這不是我方的限制,是平台規則。
     不在此假裝它與 Slack 一樣即插即用:設定頁的 hint 會照講。 */
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp Business",
    secretLabel: "存取權杖(Access Token)",
    secretHint:
      "Meta for Developers → WhatsApp → API Setup 取得。⚠️ 平台規則:僅能在對方來訊後的 24 小時服務窗內送自由文字,窗外需事先核准的範本訊息。",
    configFields: [
      { key: "phoneNumberId", label: "Phone Number ID" },
      { key: "to", label: "收訊號碼(含國碼,如 886912345678)" },
    ],
    allowedHosts: ["graph.facebook.com"],
    secretIsUrl: false,
  },
  smtp: {
    id: "smtp",
    label: "自訂 SMTP",
    secretLabel: "SMTP 密碼",
    secretHint: "寄件信箱的密碼或應用程式專用密碼。",
    configFields: [
      { key: "host", label: "SMTP 主機" },
      { key: "port", label: "連接埠" },
      { key: "user", label: "帳號" },
      { key: "from", label: "寄件人" },
    ],
    /* 🔴 SMTP 的 host 天生由客戶決定,沒有 allow-list 可用 →
       維持既有的 deny-list(擋私網段 + 雲 metadata),不假裝這裡也是 allow-list。 */
    allowedHosts: [],
    secretIsUrl: false,
  },
}

export const CHANNEL_IDS = Object.keys(CHANNELS) as ChannelId[]

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && value in CHANNELS
}

/* 🔴 allow-list 檢查。**比對整個 host,不是「包含」** ——
   `hooks.slack.com.evil.example` 之類的後綴伎倆必須擋下。 */
export function isAllowedUrl(channel: ChannelId, rawUrl: string): boolean {
  const spec = CHANNELS[channel]
  if (spec.allowedHosts.length === 0) return false
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  return spec.allowedHosts.includes(url.hostname.toLowerCase())
}
