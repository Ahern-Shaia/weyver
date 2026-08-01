"use client"

import { useChannels } from "@/lib/engine/use-channels"
import { ChannelCard } from "./_components/channel-card"

/* R1·A-1 M4|通知通道連接(公司層級)。

   與「通知設定」刻意分成兩頁:
   · **這一頁**是公司連接了哪些外部服務 —— 管理員才看得到、才改得了。
   · **通知設定**是「我要收什麼、從哪收」—— 每個人自己的事。
   混在一起的話,一般同事會看到一堆自己既不該改也改不動的欄位。 */

export default function ChannelsPage(): React.ReactNode {
  const { data, isPending, error } = useChannels()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-[16px] font-semibold text-ink">通知通道</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          連接公司要用的外部通知服務。連接後,同事才能在「通知設定」裡選擇用它接收通知。
        </p>
      </div>

      {error ? (
        <p className="rounded-sm border border-er-line bg-er-t px-3 py-2 text-[12px] text-er">
          {error.message}
        </p>
      ) : null}

      <ul className="rounded-sm border border-line bg-card">
        {isPending ? (
          <li className="px-4 py-6 text-center text-[12px] text-ink-3">載入中…</li>
        ) : (
          (data ?? []).map((status) => <ChannelCard key={status.channel} status={status} />)
        )}
      </ul>

      {/* 🔴 憑證的處理方式要講在頁面上,不是只寫在程式碼註解裡 ——
          管理員貼上的是公司的 token,他有權知道它被怎麼對待。 */}
      <p className="text-[12px] text-ink-3">
        憑證以 AES-256-GCM 加密後儲存,設定後不再顯示,也不會出現在紀錄或匯出檔中。
      </p>
    </main>
  )
}
