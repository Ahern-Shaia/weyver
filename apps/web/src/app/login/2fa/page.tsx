"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { type FormEvent, useState } from "react"
import { AuthShell, Field } from "@/lib/auth/auth-shell"
import { organization, twoFactor } from "@/lib/auth/client"
import { totpErrorMessage } from "@/lib/auth/totp-error"

/* 登入第二步(F-4 MFA):密碼步回 twoFactorRedirect 後導向此頁。
   輸入 authenticator 6 碼(或改用備用碼)驗證 → 發完整 session → 設 active org → 進 /app。 */
export default function TwoFactorChallengePage(): React.ReactNode {
  const [code, setCode] = useState("")
  const [useBackup, setUseBackup] = useState(false)
  /* 「記住這台裝置」預設**不勾** —— 降低安全等級的選項不該由系統替使用者決定。
     Better Auth 的信任記錄是伺服器端可撤銷、且每次登入輪替 identifier;
     停用 2FA 或按「登出其他裝置」會全部作廢(見 api/src/auth/trusted-device.ts)。 */
  const [trustDevice, setTrustDevice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const finish = async (): Promise<void> => {
    const list = await organization.list()
    const first = list.data?.[0]
    if (first) await organization.setActive({ organizationId: first.id })
    // 全頁導向:讓 Better Auth reactive store 以新 session 重新 hydrate(active org 立即反映)
    window.location.href = "/app/builder"
  }

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = useBackup
      ? await twoFactor.verifyBackupCode({ code, trustDevice })
      : await twoFactor.verifyTotp({ code, trustDevice })
    if (result.error) {
      setBusy(false)
      setError(totpErrorMessage(result.error, useBackup))
      return
    }
    await finish()
  }

  return (
    <AuthShell title="二步驟驗證" subtitle="織雲工作區">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={useBackup ? "備用碼" : "驗證碼(authenticator app 上的 6 碼)"}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            placeholder={useBackup ? "備用碼" : "123456"}
          />
        </Field>
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            className="accent-primary"
          />
          記住這台裝置,30 天內不再詢問
        </label>
        {/* 講清楚代價:公用電腦上勾了,下一個人不必二步驟就能登入 */}
        <p className="text-[12px] text-ink-3">
          僅在你自己的裝置上使用。之後可於「帳號安全」按<b>登出其他裝置</b>一次全部取消。
        </p>
        {error ? <p className="text-[13px] text-er">{error}</p> : null}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
          {busy ? "驗證中…" : "驗證並登入"}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => {
          setUseBackup((v) => !v)
          setCode("")
          setError(null)
        }}
        className="mt-4 text-[12px] text-primary hover:underline"
      >
        {useBackup ? "改用 authenticator 驗證碼" : "無法使用 app?改用備用碼"}
      </button>
    </AuthShell>
  )
}
