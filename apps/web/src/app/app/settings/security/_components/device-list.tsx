"use client"

import { Button } from "@weyver/ui/button"
import { useState } from "react"
import { useDeviceSessions, useRevokeOtherSessions } from "@/lib/engine/use-security"

/* R1·A-1 M3|登入中的裝置。

   欄位取自 Microsoft 帳戶 Recent activity(唯一把欄位寫具體的一手來源):
   IP · 裝置/OS · 瀏覽器 · 最後活動時間。**地點刻意不顯示** —— Microsoft 自己
   附了免責:行動網路會讓活動看起來來自別的地方。會誤導的欄位不如不放。

   🔴 兩件事一定要講在畫面上,不能只做在後端:
   1. **標出「目前這台」** —— 否則沒人敢按登出,怕把自己踢掉。
   2. **強制登出會連帶撤銷 API 金鑰** —— Google 官方自陳登出「except…」不完全,
      我們選擇做完整;但做得更多就更要講,否則使用者的自動化會無預警斷掉。 */

function relTime(d: Date): string {
  const min = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (min < 1) return "剛剛"
  if (min < 60) return `${String(min)} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${String(hr)} 小時前`
  return d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })
}

export function DeviceList(): React.ReactNode {
  const { data: sessions, isPending } = useDeviceSessions()
  const revoke = useRevokeOtherSessions()
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<{ sessions: number; apiKeys: number } | null>(null)

  const others = (sessions ?? []).filter((s) => !s.current).length

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">登入中的裝置</h2>
        <p className="mt-1 text-[12px] text-ink-3">
          目前持有有效登入的裝置。看到不認得的,請登出其他裝置並更改密碼。
        </p>
      </div>

      <div className="rounded-sm border border-line bg-card">
        {isPending ? (
          <p className="px-3 py-6 text-center text-[12px] text-ink-3">載入中…</p>
        ) : (sessions ?? []).length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-ink-3">目前沒有其他有效登入。</p>
        ) : (
          <ul>
            {(sessions ?? []).map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-line border-b px-3 py-2.5 last:border-b-0"
              >
                <span className="text-[12px] text-ink">{s.device}</span>
                {s.current ? (
                  <span className="rounded-xs border border-ok-line bg-ok-t px-1.5 py-0.5 text-[12px] text-ok">
                    目前這台
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-[12px] text-ink-3">
                  {s.ipAddress ?? "IP 未知"}
                </span>
                <span
                  className="text-[12px] text-ink-3"
                  title={s.lastActiveAt.toLocaleString("zh-TW")}
                >
                  最後活動 {relTime(s.lastActiveAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {done ? (
        <p className="text-[12px] text-ink-2">
          已登出 {done.sessions} 個裝置
          {done.apiKeys > 0 ? `,並撤銷 ${String(done.apiKeys)} 把 API 金鑰` : ""}。
        </p>
      ) : confirming ? (
        <div className="flex flex-col gap-2 rounded-sm border border-wn-line bg-wn-t p-3">
          {/* 🔴 副作用要在按下去之前講,不是之後 */}
          <p className="text-[12px] text-ink-2">
            將登出其他 {others} 個裝置,並<b>一併撤銷你名下所有 API 金鑰</b>
            ——用該金鑰串接的自動化會立即停止運作,需重新簽發。
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate(undefined, {
                  onSuccess: (r) => {
                    setDone(r)
                    setConfirming(false)
                  },
                })
              }}
            >
              {revoke.isPending ? "處理中…" : "確定登出並撤銷金鑰"}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false)
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="w-fit"
          disabled={others === 0}
          onClick={() => {
            setConfirming(true)
          }}
        >
          登出其他所有裝置
        </Button>
      )}
    </section>
  )
}
