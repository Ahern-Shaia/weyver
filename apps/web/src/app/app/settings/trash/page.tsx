"use client"

import { Button } from "@weyver/ui/button"
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react"
import { type ReactNode, useState } from "react"
import { usePurgeTrash, useRestoreTrash, useTrash } from "@/lib/engine/hooks"
import type { RestoreBlocker, TrashItem } from "@/lib/engine/schemas"
import { BusyBar, FirstLoad } from "@/components/busy-indicator"

/* H-2 M4|資源回收桶。

   **這頁存在的理由不只是「找回誤刪」**|在此之前刪除全是 soft delete,
   而程式註解說的清理 job 不存在 —— 東西既拿不回來、也沒真的刪。
   所以本頁同時顯示 **purgeAfter**:使用者要看得到「這東西什麼時候會真的消失」,
   保留期才是一個承諾而不是一句話。

   **不做假的樂觀更新**|還原可能被三類衝突擋下(父已刪 / 同名 / 違反後加約束),
   先讓列消失再回滾會讓人以為救回來了。一律等伺服器回應。 */

const TYPE_LABEL: Record<string, string> = {
  record: "記錄",
  form: "表單",
  field: "欄位",
}

function daysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

function BlockerNotice({ blockers }: { readonly blockers: readonly RestoreBlocker[] }): ReactNode {
  return (
    <div className="mt-1.5 flex gap-1.5 rounded-sm border border-warn/40 bg-warn/5 px-2 py-1.5">
      <AlertTriangle size={13} className="mt-px shrink-0 text-warn" />
      <div className="flex flex-col gap-0.5 text-[11.5px] text-ink">
        {blockers.map((b) => (
          <span key={b.kind + b.message}>
            {b.message}
            {b.kind === "constraintViolation" && b.fields.length > 0 ? (
              <span className="text-ink-2">{`(${b.fields.join("、")})`}</span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function TrashPage(): ReactNode {
  const { data, isLoading } = useTrash()
  const restore = useRestoreTrash()
  const purge = usePurgeTrash()
  const [blocked, setBlocked] = useState<Record<number, readonly RestoreBlocker[]>>({})
  const [confirming, setConfirming] = useState<number | null>(null)

  const onRestore = async (item: TrashItem): Promise<void> => {
    const result = await restore.mutateAsync(item.id)
    setBlocked((prev) =>
      result.ok
        ? Object.fromEntries(Object.entries(prev).filter(([k]) => Number(k) !== item.id))
        : { ...prev, [item.id]: result.blockers },
    )
  }

  /* 只有「完全沒有資料可顯示」才佔位(同時讓 TS 收窄);
     後續重取由 BusyBar 表示,內容保留不塌陷 */
  if (data === undefined) return <FirstLoad />

  return (
    <div className="relative mx-auto max-w-[720px] p-6">
      <BusyBar busy={isLoading} />
      <h2 className="text-[15px] font-semibold">資源回收桶</h2>
      <p className="mt-1 text-[11.5px] text-ink-3">
        刪除的項目會保留 {data.retentionDays} 天,之後永久刪除且無法復原。
        回收桶內的項目仍計入儲存與欄位額度。
      </p>

      {data.items.length === 0 ? (
        <div className="mt-6 rounded-md border border-line bg-card px-4 py-8 text-center text-[12px] text-ink-3">
          回收桶是空的。
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-1.5">
          {data.items.map((item) => {
            const left = daysLeft(item.purgeAfter)
            return (
              <li key={item.id} className="rounded-md border border-line bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-sm border border-line px-1.5 py-px text-[10.5px] text-ink-3">
                    {TYPE_LABEL[item.resourceType] ?? item.resourceType}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {item.title}
                    {/* 🔴 表單名取**刪除當下的快照**而非即時查表:表單本身被刪後,
                        即時查只會得到「表單 #729」,使用者無從得知那批記錄原屬何處。 */}
                    {item.resourceType === "form" || item.formName === null ? null : (
                      <span className="ml-1.5 text-[11px] text-ink-3">· {item.formName}</span>
                    )}
                  </span>
                  <span
                    className="shrink-0 font-mono text-[11px] text-ink-3"
                    title={`永久刪除於 ${new Date(item.purgeAfter).toLocaleString("zh-TW")}`}
                  >
                    {left <= 0 ? "即將清除" : `${String(left)} 天後清除`}
                  </span>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={restore.isPending}
                    onClick={() => void onRestore(item)}
                  >
                    <RotateCcw size={13} className="mr-1" />
                    還原
                  </Button>
                  {confirming === item.id ? (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={purge.isPending}
                      onClick={() => {
                        purge.mutate(item.id)
                        setConfirming(null)
                      }}
                    >
                      確定永久刪除
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="subtle"
                      aria-label={`永久刪除 ${item.title}`}
                      onClick={() => setConfirming(item.id)}
                    >
                      <Trash2 size={13} className="text-ink-3" />
                    </Button>
                  )}
                </div>
                {blocked[item.id] === undefined ? null : (
                  <BlockerNotice blockers={blocked[item.id] ?? []} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
