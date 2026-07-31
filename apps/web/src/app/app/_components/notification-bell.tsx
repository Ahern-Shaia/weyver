"use client"

import {
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  useNotifications,
} from "@/lib/engine/hooks"
import type { NotificationItem } from "@/lib/engine/schemas"
import { StatusChip, type StatusTone } from "@weyver/ui/status-chip"
import { Bell } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useEffect, useRef, useState } from "react"

/* H-1 M2 通知中心(鈴鐺 + 面板)。

   每則只有**表單名 + 事件 + 記錄編號** —— 刻意不帶欄位值(OQ-NT-9):
   收件人是「訂閱者」,但欄位級權限可能讓他看不到某些欄;業界主流的
   「過濾收件人」在有欄位級權限的模型下不足。權限檢查回到「點進去」那一刻。 */

const EVENT_LABEL: Readonly<Record<string, { text: string; tone: StatusTone }>> = {
  "approval.pending": { text: "待簽核", tone: "warn" },
  "approval.approved": { text: "已核准", tone: "ok" },
  "approval.rejected": { text: "已駁回", tone: "error" },
  "approval.overdue": { text: "簽核逾期", tone: "error" },
  "record.created": { text: "新增", tone: "neutral" },
  "record.updated": { text: "已更新", tone: "neutral" },
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "剛剛"
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小時前`
  return new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })
}

export function NotificationBell({ collapsed = true }: { readonly collapsed?: boolean }): ReactNode {
  const [open, setOpen] = useState(false)
  const { data } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const markAll = useMarkAllNotificationsRead()
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  const unread = data?.unread ?? 0
  const items = data?.items ?? []

  const onOpen = (n: NotificationItem): void => {
    if (!n.read) markRead.mutate([n.id])
    setOpen(false)
    if (n.formId !== null) {
      router.push(n.recordId === null ? `/app/forms/${n.formId}` : `/app/forms/${n.formId}?mode=record`)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        /* 🔴 筆數放 aria-label 而非 title —— aria-label 在無障礙名稱計算上優先於 title,
           原本 `aria-label="通知"` 代表螢幕閱讀器使用者從來聽不到未讀數(title 只服務滑鼠)。
           title 僅收合態需要:展開態筆數已以徽章呈現於標籤旁。 */
        {...(collapsed ? { title: unread > 0 ? `通知(${unread} 則未讀)` : "通知" } : {})}
        aria-label={unread > 0 ? `通知(${unread} 則未讀)` : "通知"}
        className={`relative flex items-center rounded-sm text-ink-2 transition-colors duration-fast-01 ease-productive-exit hover:bg-primary-t hover:text-primary ${
          collapsed ? "size-9 justify-center" : "h-[30px] w-full gap-2.5 px-2 text-[13px]"
        }`}
      >
        <Bell size={17} strokeWidth={1.9} className="shrink-0" />
        {collapsed ? null : <span>通知</span>}
        {unread > 0 ? (
          /* 方框非 pill(docs/14);等寬字避免位數變動時抖動 */
          <span className={`flex h-[16px] min-w-[16px] items-center justify-center rounded-xs border border-er-line bg-er px-[3px] font-mono text-[12px] font-semibold leading-none text-white ${collapsed ? "absolute right-0.5 top-0.5" : "ml-auto"}`}>
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute bottom-0 left-11 z-50 w-[340px] overflow-hidden rounded-md border border-line bg-card shadow-overlay">
          <div className="flex min-h-[30px] items-center border-b border-line bg-head px-2.5 text-[12px] font-semibold">
            通知
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="ml-auto text-[11px] font-normal text-link underline underline-offset-2"
              >
                全部標為已讀
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11.5px] leading-relaxed text-ink-4">
              目前沒有通知。
              <br />
              <span className="text-[10.5px]">
                可在通知設定調整要接收哪些事件。
              </span>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {items.map((n) => {
                const label = EVENT_LABEL[n.event] ?? { text: n.event, tone: "neutral" as const }
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onOpen(n)}
                    className={`flex w-full gap-2 border-b border-line-2 px-2.5 py-2.5 text-left transition-colors duration-fast-01 ease-productive-exit hover:bg-field ${
                      n.read ? "" : "bg-primary-t"
                    }`}
                  >
                    <span
                      className={`mt-1.5 size-[5px] shrink-0 rounded-full ${
                        n.read ? "bg-transparent" : "bg-primary"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11.5px] leading-snug text-ink">{n.title}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-4">
                        <StatusChip tone={label.tone}>{label.text}</StatusChip>
                        <span>{relTime(n.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
