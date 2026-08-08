"use client"

import { X } from "lucide-react"
import type { ReactNode } from "react"

import type { TriggerDto, TriggerSchedule } from "@/lib/engine/schemas"

/* 🔴 R1·C-5|觸發器清單。

   從 `triggers-panel.tsx` 拆出來(加完排程後 548 行,紅線 400)。
   邊界選在這裡:清單是**唯讀顯示 + 三個列上動作**,與下方的「新增」表單
   沒有共用狀態 —— 那是天然的縫,不是為了湊行數硬切的。 */

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const

export function describeSchedule(s: TriggerSchedule): string {
  const at = `${String(s.hour).padStart(2, "0")}:00`
  if (s.freq === "daily") return `每天 ${at}`
  if (s.freq === "weekly") return `每週${WEEKDAY[s.day ?? 0] ?? ""} ${at}`
  return s.day === 0 ? `每月月底 ${at}` : `每月 ${String(s.day ?? 1)} 號 ${at}`
}

export function TriggerList({
  triggers,
  busy,
  onPublish,
  onToggle,
  onRemove,
}: {
  readonly triggers: readonly TriggerDto[]
  readonly busy: boolean
  readonly onPublish: (triggerId: number, discard?: boolean) => void
  readonly onToggle: (triggerId: number, enabled: boolean) => void
  readonly onRemove: (triggerId: number) => void
}): ReactNode {
  return (
    <>
      {triggers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {triggers.map((t) => (
            <div key={t.id} className="flex items-start gap-2 border border-line p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-ink">{t.name}</div>
                <div className="text-ink-3">
                  {[
                    t.onCreate ? "建立時" : null,
                    t.onUpdate ? "更新時" : null,
                    t.schedule === null ? null : describeSchedule(t.schedule),
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                  {t.watchFields.length > 0 ? `(${t.watchFields.join("、")}變更)` : ""}
                  {t.conditions.length > 0 ? ` · ${String(t.conditions.length)} 個條件` : ""}
                  {/* 定時觸發看不到「有沒有在跑」的話,使用者只能等明天再猜一次 */}
                  {t.schedule === null || t.lastRunAt === null
                    ? ""
                    : ` · 上次 ${t.lastRunAt.slice(5, 16).replace("T", " ")}`}
                </div>
                {/* 🔴 講清楚「畫面上這一版」與「正在跑的那一版」不是同一份。
                    不講的話設計者改完就走,以為已經生效了。 */}
                {t.hasUnpublishedChanges ? (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-wa">有未發布的變更 —— 目前跑的是上一版</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onPublish(t.id)}
                      className="border border-primary px-1.5 text-primary hover:bg-primary hover:text-white disabled:opacity-disabled"
                    >
                      發布
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onPublish(t.id, true)}
                      className="text-ink-3 hover:text-ink"
                    >
                      丟棄
                    </button>
                  </div>
                ) : null}
              </div>
              <label className="flex shrink-0 items-center gap-1 text-ink-3">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  className="accent-(--color-primary)"
                  aria-label={`${t.name} 啟用`}
                  onChange={() => onToggle(t.id, !t.enabled)}
                />
                啟用
              </label>
              <button
                type="button"
                aria-label={`刪除 ${t.name}`}
                onClick={() => onRemove(t.id)}
                className="shrink-0 text-ink-disabled hover:text-er"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-ink-3">還沒有觸發器。</p>
      )}
    </>
  )
}
