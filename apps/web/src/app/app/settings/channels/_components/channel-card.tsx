"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { type FormEvent, useState } from "react"
import { type ChannelStatus, useSaveChannel, useTestChannel } from "@/lib/engine/use-channels"

/* R1·A-1 M4|單一通道的連接卡片。

   🔴 **憑證欄位永遠是空的**(Grafana `secureJsonFields` 模式)——
   後端不回值,前端也就沒有值可填回去。留白時送出 = 保留原憑證,
   所以畫面必須把這件事講出來,否則使用者會以為自己剛把它清空了。 */

/* 各通道要填什麼。與後端 `channel-registry.ts` 對應 ——
   ⚠️ 兩邊都改才算改完;不一致時後端為準(它才是執法的一方)。 */
const SPEC: Readonly<
  Record<
    ChannelStatus["channel"],
    {
      readonly secretLabel: string
      readonly hint: string
      readonly fields: readonly { readonly key: string; readonly label: string }[]
    }
  >
> = {
  slack: {
    secretLabel: "Incoming Webhook URL",
    hint: "Slack App → Incoming Webhooks 產生。此網址本身即為機密。",
    fields: [],
  },
  teams: {
    secretLabel: "Incoming Webhook URL",
    hint: "Teams 頻道 → 連接器 → Incoming Webhook 產生。",
    fields: [],
  },
  discord: {
    secretLabel: "Webhook URL",
    hint: "頻道設定 → 整合 → Webhook 產生。",
    fields: [],
  },
  telegram: {
    secretLabel: "Bot Token",
    hint: "與 @BotFather 對話建立 bot 後取得。",
    fields: [{ key: "chatId", label: "Chat ID" }],
  },
  line: {
    secretLabel: "Channel Access Token",
    hint: "LINE Developers → Messaging API channel 取得(LINE Notify 已於 2025 年停止服務)。",
    fields: [{ key: "to", label: "推送對象 ID" }],
  },
  smtp: {
    secretLabel: "SMTP 密碼",
    hint: "寄件信箱的密碼或應用程式專用密碼。",
    fields: [
      { key: "host", label: "SMTP 主機" },
      { key: "port", label: "連接埠" },
      { key: "user", label: "帳號" },
      { key: "from", label: "寄件人" },
    ],
  },
}

/* 可廣播的事件。**與後端 `notification-specs` 同源的六個事件碼**;
   標籤沿用通知設定頁的說法,免得同一件事在兩頁有兩個名字。 */
const EVENTS: readonly { readonly code: string; readonly label: string }[] = [
  { code: "approval.pending", label: "待簽核" },
  { code: "approval.approved", label: "簽核核准" },
  { code: "approval.rejected", label: "簽核駁回" },
  { code: "approval.overdue", label: "簽核逾期" },
  { code: "record.created", label: "新資料建立" },
  { code: "record.updated", label: "資料變更" },
]

export function ChannelCard({ status }: { readonly status: ChannelStatus }): React.ReactNode {
  const spec = SPEC[status.channel]
  const save = useSaveChannel()
  const test = useTestChannel()
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState("")
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(spec.fields.map((f) => [f.key, String(status.config[f.key] ?? "")])),
  )
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null)
  const [events, setEvents] = useState<string[]>([...status.broadcastEvents])

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    setResult(null)
    save.mutate(
      {
        channel: status.channel,
        config,
        broadcastEvents: events,
        /* 勾了事件就代表要用 —— 不讓「勾了卻沒開」這種看起來已生效實際沒有的狀態存在 */
        enabled: events.length > 0,
        ...(secret === "" ? {} : { secret }),
      },
      {
        onSuccess: () => {
          setSecret("")
          setOpen(false)
        },
      },
    )
  }

  return (
    <li className="border-line border-b last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <span className="text-[13px] font-medium text-ink">{status.label}</span>
        {status.secretSet ? (
          status.verifiedAt === null ? (
            /* 已填但沒測過 —— 不能顯示成「可用」,那會讓使用者以為通知會送到 */
            <span className="rounded-xs border border-wn-line bg-wn-t px-1.5 py-0.5 text-[12px] text-wn">
              已設定,尚未測試
            </span>
          ) : (
            <span className="rounded-xs border border-ok-line bg-ok-t px-1.5 py-0.5 text-[12px] text-ok">
              已連接
            </span>
          )
        ) : (
          <span className="rounded-xs border border-line bg-head px-1.5 py-0.5 text-[12px] text-ink-3">
            未連接
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {status.secretSet && status.channel !== "smtp" ? (
            <Button
              disabled={test.isPending}
              onClick={() => {
                setResult(null)
                test.mutate(status.channel, { onSuccess: (r) => setResult(r) })
              }}
            >
              {test.isPending ? "發送中…" : "測試發送"}
            </Button>
          ) : null}
          <Button
            onClick={() => {
              setOpen(!open)
            }}
          >
            {open ? "取消" : status.secretSet ? "更新" : "連接"}
          </Button>
        </div>
      </div>

      {result ? (
        <p
          className={`px-4 pb-3 text-[12px] ${result.ok ? "text-ok" : "text-er"}`}
          data-testid={`test-result-${status.channel}`}
        >
          {result.detail}
        </p>
      ) : null}

      {open ? (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 border-line border-t bg-head px-4 py-3"
        >
          {spec.fields.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-2">{f.label}</span>
              <Input
                value={config[f.key] ?? ""}
                onChange={(e) => {
                  setConfig({ ...config, [f.key]: e.target.value })
                }}
                className="max-w-sm"
              />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-ink-2">{spec.secretLabel}</span>
            <Input
              type="password"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value)
              }}
              autoComplete="off"
              className="max-w-sm"
              placeholder={status.secretSet ? "留白則保留目前的憑證" : ""}
            />
            <span className="text-[12px] text-ink-3">{spec.hint}</span>
            {status.secretSet ? (
              /* 🔴 一定要講:輸入框是空的,但憑證還在。少了這句,
                 使用者會以為自己剛把它清掉,或反覆重貼一次憑證。 */
              <span className="text-[12px] text-ink-3">
                目前已設定憑證(基於安全考量不再顯示)。留白送出即保留原值。
              </span>
            ) : null}
          </label>
          {/* 🔴 廣播是**公司頻道**不是個人收件匣:群組成員可能對該表單毫無存取權,
              所以訊息只有「哪張表單的第幾筆發生了什麼」,不含任何欄位值。
              這句要寫在勾選旁邊 —— 管理者是在決定把什麼推給一群人。 */}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[12px] text-ink-2">要廣播哪些事件</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {EVENTS.map((e) => (
                <label key={e.code} className="flex items-center gap-1.5 text-[12px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={events.includes(e.code)}
                    onChange={() => {
                      setEvents(
                        events.includes(e.code)
                          ? events.filter((c) => c !== e.code)
                          : [...events, e.code],
                      )
                    }}
                    className="accent-primary"
                  />
                  {e.label}
                </label>
              ))}
            </div>
            <span className="text-[12px] text-ink-3">
              訊息只含表單名稱、記錄編號與事件類型,<b>不含任何欄位值</b> ——
              頻道成員可能對該表單沒有存取權。
            </span>
          </fieldset>
          {save.isError ? <p className="text-[12px] text-er">{save.error.message}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending ? "儲存中…" : "儲存"}
            </Button>
            {status.secretSet ? (
              <Button
                variant="danger"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate({ channel: status.channel, config, clearSecret: true })
                }}
              >
                移除憑證
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </li>
  )
}
