import { Inject, Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import nodemailer, { type Transporter } from "nodemailer"

/* H-1 M3|Email 通道。

   **走 relay 的共用 IP pool,不自架 SMTP**(OQ-NT-7 v0.4 改寫)——
   雲主機 IP 段預設落在 Spamhaus PBL 或被主要收件方封鎖,多數雲商封鎖對外 port 25,
   新 IP 需 2–4 週 warm-up,而幾百封/日的低量**根本養不熱一個專用 IP**。
   **與 OSS-only 不衝突**:程式資產仍全 OSS,relay 買的是 **IP 信譽**屬基礎設施
   (同 docs/11 §16 managed-OSS 判準)。

   **未設定 SMTP 時不是錯誤** —— dev / 尚未接 relay 的環境,delivery 標 `skipped`
   而非 `failed`,避免把「還沒設定」誤記成「寄送失敗」而汙染重試與告警。 */

export interface SendResult {
  readonly outcome: "sent" | "skipped" | "soft_fail" | "hard_fail"
  readonly detail?: string
  readonly messageId?: string
}

/* SMTP 增強狀態碼:5.x.x = 永久;4.x.x = 暫時。
   **依狀態碼分類,不解析人類可讀文字** —— 各家措辭不同,只有碼是標準化的。 */
function classify(error: unknown): { permanent: boolean; detail: string } {
  const e = error as { responseCode?: number; code?: string; message?: string }
  const detail = e.message ?? String(error)
  if (typeof e.responseCode === "number") {
    return { permanent: e.responseCode >= 500 && e.responseCode < 600, detail }
  }
  /* 連線層問題(ECONNREFUSED / ETIMEDOUT)為暫時性 */
  return { permanent: false, detail }
}

@Injectable()
export class EmailChannel {
  private readonly logger = new Logger(EmailChannel.name)
  private transporter: Transporter | null = null

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  get configured(): boolean {
    return this.config.get<string>("SMTP_HOST") !== undefined
  }

  private get from(): string {
    return this.config.get<string>("SMTP_FROM") ?? "Weyver <no-reply@weyver.app>"
  }

  private transport(): Transporter {
    if (this.transporter !== null) return this.transporter
    this.transporter = nodemailer.createTransport({
      host: this.config.getOrThrow<string>("SMTP_HOST"),
      port: Number(this.config.get<string>("SMTP_PORT") ?? "587"),
      secure: this.config.get<string>("SMTP_SECURE") === "1",
      auth:
        this.config.get<string>("SMTP_USER") === undefined
          ? undefined
          : {
              user: this.config.getOrThrow<string>("SMTP_USER"),
              pass: this.config.getOrThrow<string>("SMTP_PASS"),
            },
    })
    return this.transporter
  }

  async send(input: {
    to: string
    subject: string
    body: string
    /* 同一筆記錄的通知帶同一組 threading 標頭 → 郵件客戶端自行收攏成一條
       (GitHub 作法;幾乎零成本就得到 Ragic「同收件人同日串成一封」的視覺效果)*/
    threadKey: string
    unsubscribeUrl: string | null
  }): Promise<SendResult> {
    if (!this.configured) return { outcome: "skipped", detail: "SMTP 未設定" }

    const domain = this.config.get<string>("SMTP_THREAD_DOMAIN") ?? "weyver.app"
    const references = `<${input.threadKey}@${domain}>`
    try {
      const info = await this.transport().sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.body,
        references,
        inReplyTo: references,
        headers:
          input.unsubscribeUrl === null
            ? {}
            : {
                /* RFC 8058 一鍵退訂。**兩個標頭都必須被 DKIM 簽章覆蓋**(由 relay 處理),
                   端點不得 redirect、不得要求登入,且須在 POST 當下即生效。
                   交易信雖豁免「必須提供退訂」,但 Yahoo 明言:非行銷信若投訴率偏高,
                   加上一鍵退訂符合寄件者自身利益。安全類(密碼重設/MFA)不帶。 */
                "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
      })
      return { outcome: "sent", messageId: String(info.messageId ?? "") }
    } catch (error) {
      const { permanent, detail } = classify(error)
      this.logger.warn(`email send ${permanent ? "hard" : "soft"} fail: ${detail}`)
      return { outcome: permanent ? "hard_fail" : "soft_fail", detail }
    }
  }
}
