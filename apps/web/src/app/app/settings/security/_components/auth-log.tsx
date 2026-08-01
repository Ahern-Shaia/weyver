"use client"

import { useAuthAudit } from "@/lib/engine/use-security"

/* R1·A-1 M3|認證活動紀錄。

   保留 6 個月(台灣「資通安全責任等級分級辦法」附表十:保留日誌至少 6 個月),
   比 GitHub security log 90 天 / Entra Free 7 天長 —— 客戶多為台灣企業,取法定下限。

   🔴 這頁的用途是**讓使用者自己發現異常**,所以:
   · 登入失敗要看得見(那是「有人在試你的帳號」的唯一線索)
   · 保留期要寫在畫面上,否則使用者會以為查得到更早的紀錄而空等
   · 內容只有 metadata —— OWASP Logging 禁記清單逐字含 session id / token / 密碼 */

const EVENT_LABEL: Readonly<Record<string, { readonly text: string; readonly alert: boolean }>> = {
  "account.create": { text: "建立帳號", alert: false },
  "login.success": { text: "登入成功", alert: false },
  "login.failure": { text: "登入失敗", alert: true },
  logout: { text: "登出", alert: false },
  "session.revoke_others": { text: "登出其他裝置", alert: false },
  "password.change": { text: "變更密碼", alert: true },
  "mfa.enable": { text: "啟用二步驟驗證", alert: false },
  "mfa.disable": { text: "停用二步驟驗證", alert: true },
  "member.create": { text: "新增成員", alert: false },
  "member.suspend": { text: "停用成員", alert: false },
  "member.reactivate": { text: "復用成員", alert: false },
}

export function AuthLog(): React.ReactNode {
  const { data: rows, isPending } = useAuthAudit()

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">認證活動紀錄</h2>
        <p className="mt-1 text-[12px] text-ink-3">
          你帳號的登入與安全設定變更。保留 6 個月,逾期自動清除。
        </p>
      </div>

      <div className="rounded-sm border border-line bg-card">
        {isPending ? (
          <p className="px-3 py-6 text-center text-[12px] text-ink-3">載入中…</p>
        ) : (rows ?? []).length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-ink-3">目前沒有紀錄。</p>
        ) : (
          <ul>
            {(rows ?? []).map((r, i) => {
              const meta = EVENT_LABEL[r.event] ?? { text: r.event, alert: false }
              return (
                <li
                  key={`${r.event}-${r.createdAt.toISOString()}-${String(i)}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-line border-b px-3 py-2 last:border-b-0"
                >
                  <span className={meta.alert ? "text-[12px] text-er" : "text-[12px] text-ink"}>
                    {meta.text}
                  </span>
                  <span className="ml-auto font-mono text-[12px] text-ink-3">
                    {r.ipAddress ?? "—"}
                  </span>
                  <span className="text-[12px] text-ink-3">
                    {r.createdAt.toLocaleString("zh-TW")}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
