"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { type FormEvent, useState } from "react"
import { AuthShell, Field } from "@/lib/auth/auth-shell"
import { organization, twoFactor } from "@/lib/auth/client"

/* 登入第二步(F-4 MFA):密碼步回 twoFactorRedirect 後導向此頁。
   輸入 authenticator 6 碼(或改用備用碼)驗證 → 發完整 session → 設 active org → 進 /app。 */
export default function TwoFactorChallengePage(): React.ReactNode {
  const [code, setCode] = useState("")
  const [useBackup, setUseBackup] = useState(false)
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
      ? await twoFactor.verifyBackupCode({ code })
      : await twoFactor.verifyTotp({ code })
    if (result.error) {
      setBusy(false)
      setError(useBackup ? "備用碼錯誤或已使用" : "驗證碼錯誤")
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
        {error ? <p className="text-[12px] text-er">{error}</p> : null}
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
