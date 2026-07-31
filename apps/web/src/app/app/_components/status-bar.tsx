"use client"
import { useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"

/* R1·UP-1 全域狀態列(信任訊號,docs/14)。更新時戳=最近一次成功 query(TanStack cache 訂閱);
   有成功=已連線(綠)、尚無=連線中(灰)。不放 phase/版本字樣。 */
export function StatusBar({ org }: { readonly org: string | null }): ReactNode {
  const qc = useQueryClient()
  const [lastOk, setLastOk] = useState<number>(0)

  useEffect(() => {
    const cache = qc.getQueryCache()
    // 輪詢(非訂閱)—— 避免 query 於他元件 render 期更新時同步 setState 觸發 React 警告
    const tick = (): void => {
      let last = 0
      for (const query of cache.getAll()) {
        if (query.state.dataUpdatedAt > last) last = query.state.dataUpdatedAt
      }
      setLastOk((prev) => (prev === last ? prev : last))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [qc])

  const connected = lastOk > 0
  const time = connected
    ? new Date(lastOk).toLocaleTimeString("zh-TW", { hour12: false })
    : "連線中…"

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-card px-4 text-[10.5px] text-ink-3">
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-block size-1.5 rounded-full ${connected ? "bg-ok" : "bg-ink-3"}`}
        />
        {connected ? "已連線" : "連線中"}
      </span>
      <span>
        更新 <span className="font-mono text-ink-2">{time}</span>
      </span>
      {org ? (
        <span className="ml-auto">
          租戶 <span className="font-mono text-ink-2">{org}</span>
        </span>
      ) : null}
      <span className={org ? "" : "ml-auto"}>Weyver</span>
    </footer>
  )
}
