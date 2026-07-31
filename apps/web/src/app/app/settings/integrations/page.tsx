"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { AlertTriangle, Copy, KeyRound, Plus, Send, Trash2, Webhook } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import {
  useApiKeys,
  useCreateWebhook,
  useDeleteWebhook,
  useIssueApiKey,
  useRedeliver,
  useRevokeApiKey,
  useRotateWebhookSecret,
  useWebhookAction,
  useWebhookDeliveries,
  useWebhooks,
} from "@/lib/engine/hooks"

/* G-1 M5|整合設定(Webhook + API 金鑰)。

   **秘鑰只顯示一次**|建立與輪替時回傳的明文不再重讀,離開畫面就消失。
   這不是體驗上的不便,是「DB 裡不留可外洩的明文」的必然結果 —— UI 要把
   這件事講清楚,否則使用者會以為之後找得回來。

   **驗證挑戰的狀態要看得見**|未驗證的端點不會收到任何投遞。若 UI 不顯示,
   使用者會以為設定好了卻一直收不到,然後來問為什麼。 */

function SecretOnce({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className="mt-2 rounded-sm border border-warn/40 bg-warn/5 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink">
        <AlertTriangle size={13} className="shrink-0 text-warn" />
        {label}
        <span className="text-ink-2">—— 只顯示這一次,關閉後無法再取得</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-sm bg-head px-2 py-1 font-mono text-[11.5px] text-ink">
          {value}
        </code>
        <Button
          size="sm"
          variant="default"
          onClick={() => void navigator.clipboard.writeText(value)}
        >
          <Copy size={12} className="mr-1" />
          複製
        </Button>
      </div>
    </div>
  )
}

function DeliveryList({ endpointId }: { readonly endpointId: number }): ReactNode {
  const { data } = useWebhookDeliveries(endpointId)
  const redeliver = useRedeliver(endpointId)
  const rows = data?.deliveries ?? []
  if (rows.length === 0) {
    return <div className="px-3 py-2 text-[11.5px] text-ink-4">尚無投遞紀錄。</div>
  }
  return (
    <table className="w-full border-collapse text-[11.5px]">
      <thead>
        <tr>
          {["事件", "狀態", "嘗試", "回應", "時間", ""].map((h) => (
            <th key={h} className="border-b border-line px-2 py-1 text-left font-normal text-ink-3">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id}>
            <td className="border-b border-line px-2 py-1 font-mono text-ink">{d.eventType}</td>
            <td className="border-b border-line px-2 py-1">
              <span className={d.status === "sent" ? "text-ok" : d.status === "failed" ? "text-er" : "text-ink-2"}>
                {d.status === "sent" ? "已送達" : d.status === "failed" ? "放棄" : "待送"}
              </span>
            </td>
            <td className="border-b border-line px-2 py-1 text-ink-2">{d.attempts}</td>
            <td className="border-b border-line px-2 py-1 text-ink-2" title={d.lastError ?? ""}>
              {d.responseCode ?? (d.lastError === null ? "—" : "錯誤")}
            </td>
            <td className="border-b border-line px-2 py-1 text-ink-3">
              {new Date(d.createdAt).toLocaleString("zh-TW")}
            </td>
            <td className="border-b border-line px-2 py-1 text-right">
              <Button size="sm" variant="subtle" onClick={() => redeliver.mutate(d.id)}>
                重送
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function IntegrationsPage(): ReactNode {
  const { data: hooks, isLoading } = useWebhooks()
  const { data: keys } = useApiKeys()
  const createHook = useCreateWebhook()
  const hookAction = useWebhookAction()
  const rotate = useRotateWebhookSecret()
  const removeHook = useDeleteWebhook()
  const issueKey = useIssueApiKey()
  const revokeKey = useRevokeApiKey()

  const [url, setUrl] = useState("")
  const [keyName, setKeyName] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onCreateHook = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const res = await createHook.mutateAsync({ url, eventTypes: [] })
      setShown({
        label: `簽章秘鑰 + 驗證權杖(端點 #${String(res.id)})`,
        value: `secret=${res.secret}\nverify_token=${res.verifyToken}`,
      })
      setUrl("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗")
    }
  }

  const onIssueKey = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const res = await issueKey.mutateAsync({ name: keyName, subjectActorId: 1, scopes: ["read"] })
      setShown({ label: `API 金鑰「${keyName}」`, value: res.key })
      setKeyName("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "簽發失敗")
    }
  }

  if (isLoading) return <div className="p-6 text-[12px] text-ink-3">載入中…</div>

  return (
    <div className="mx-auto max-w-[820px] p-6">
      <h2 className="text-[15px] font-semibold">整合</h2>
      <p className="mt-1 text-[11.5px] text-ink-3">
        把資料變更推送到外部系統,或讓外部系統以 API 存取。兩者都只有管理員能設定。
      </p>

      {error === null ? null : (
        <div className="mt-3 rounded-sm border border-er-line bg-er-t px-2.5 py-1.5 text-[14px] text-er">
          {error}
        </div>
      )}
      {shown === null ? null : <SecretOnce label={shown.label} value={shown.value} />}

      <section className="mt-6">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Webhook size={14} className="text-ink-2" />
          Webhook 端點
        </h3>
        <form onSubmit={(e) => void onCreateHook(e)} className="mt-2 flex gap-1.5">
          <Input
            className="flex-1"
            placeholder="https://your-system.example.com/weyver-hook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Webhook 網址"
          />
          <Button type="submit" variant="primary" disabled={url === "" || createHook.isPending}>
            <Plus size={13} className="mr-1" />
            新增
          </Button>
        </form>
        <p className="mt-1 text-[11px] text-ink-4">
          只接受 https,且不跟隨轉址。建立後端點須回報驗證權杖才會開始收到事件。
        </p>

        <ul className="mt-3 flex flex-col gap-1.5">
          {(hooks?.endpoints ?? []).map((e) => (
            <li key={e.id} className="rounded-md border border-line bg-card">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">{e.url}</span>
                {/* 未驗證的端點收不到任何投遞 —— 這件事必須看得見,否則使用者會以為壞掉 */}
                {e.verified ? null : (
                  <span className="shrink-0 rounded-sm border border-warn/50 px-1.5 py-px text-[10.5px] text-warn">
                    待驗證
                  </span>
                )}
                {e.disabledAt === null ? null : (
                  <span
                    className="shrink-0 rounded-sm border border-er-line px-1.5 py-px text-[14px] text-er"
                    title={e.disabledReason ?? ""}
                  >
                    已停用
                  </span>
                )}
                <Button size="sm" variant="subtle" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                  紀錄
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => hookAction.mutate({ id: e.id, action: "test" })}
                >
                  <Send size={12} className="mr-1" />
                  測試
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    void rotate.mutateAsync(e.id).then((r) => {
                      setShown({ label: `新簽章秘鑰(端點 #${String(e.id)})`, value: r.secret })
                    })
                  }}
                >
                  輪替秘鑰
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() =>
                    hookAction.mutate({ id: e.id, action: e.disabledAt === null ? "disable" : "enable" })
                  }
                >
                  {e.disabledAt === null ? "停用" : "啟用"}
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  aria-label={`刪除端點 ${e.url}`}
                  onClick={() => removeHook.mutate(e.id)}
                >
                  <Trash2 size={12} className="text-ink-3" />
                </Button>
              </div>
              {expanded === e.id ? (
                <div className="border-t border-line">
                  <DeliveryList endpointId={e.id} />
                </div>
              ) : null}
            </li>
          ))}
          {(hooks?.endpoints ?? []).length === 0 ? (
            <li className="rounded-md border border-line bg-card px-4 py-6 text-center text-[12px] text-ink-4">
              尚未設定任何端點。
            </li>
          ) : null}
        </ul>
      </section>

      <section className="mt-8">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <KeyRound size={14} className="text-ink-2" />
          API 金鑰
        </h3>
        <form onSubmit={(e) => void onIssueKey(e)} className="mt-2 flex gap-1.5">
          <Input
            className="flex-1"
            placeholder="用途名稱(例:ERP 每日同步)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            aria-label="金鑰名稱"
          />
          <Button type="submit" variant="primary" disabled={keyName === "" || issueKey.isPending}>
            <Plus size={13} className="mr-1" />
            簽發
          </Button>
        </form>
        <p className="mt-1 text-[11px] text-ink-4">
          金鑰以簽發者的權限執行,不會多給任何權限。明文只在簽發當下顯示一次。
        </p>

        <ul className="mt-3 flex flex-col gap-1.5">
          {(keys?.keys ?? []).map((k) => (
            <li key={k.id} className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{k.name}</span>
              <code className="shrink-0 font-mono text-[11px] text-ink-3">{k.keyPrefix}…</code>
              <span className="shrink-0 text-[11px] text-ink-3">
                {k.lastUsedAt === null
                  ? "未使用過"
                  : `最後使用 ${new Date(k.lastUsedAt).toLocaleDateString("zh-TW")}`}
              </span>
              <Button
                size="sm"
                variant="subtle"
                aria-label={`撤銷金鑰 ${k.name}`}
                onClick={() => revokeKey.mutate(k.id)}
              >
                撤銷
              </Button>
            </li>
          ))}
          {(keys?.keys ?? []).length === 0 ? (
            <li className="rounded-md border border-line bg-card px-4 py-6 text-center text-[12px] text-ink-4">
              尚未簽發任何金鑰。
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  )
}
