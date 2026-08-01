"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { type FormEvent, useState } from "react"
import { AuthShell, Field } from "@/lib/auth/auth-shell"
import { authClient } from "@/lib/auth/client"

/* 🔴 首次登入強制設定自己的密碼(ASVS 5.0.0 §V6.4.1:管理員發的初始密碼
   「must not be permitted to become the long term password」)。

   閘門在後端 AuthGuard(所有 API 回 403 `PASSWORD_CHANGE_REQUIRED`),
   本頁只是那個狀態的**出口**。前端導向擋得住人,擋不住直接打 API ——
   兩者都要有,但真正執法的是後端。

   `/api/auth/*` 不經 AuthGuard,所以在被擋住的狀態下改密碼這條路仍然通,
   使用者不會被鎖死在門外。 */

export default function SetPasswordPage(): React.ReactNode {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
    })
    if (result.error) {
      setBusy(false)
      /* 後端訊息已寫成可行動的句子(長度 / 外洩清單 / 情境字),直接顯示;
         取不到時才退回通用句 —— 不要用通用句蓋掉更有用的說明。 */
      setError(result.error.message ?? "設定失敗,請確認目前密碼是否正確")
      return
    }
    // 全頁導向:讓 Better Auth 的 store 以新狀態重新 hydrate
    window.location.href = "/app"
  }

  return (
    <AuthShell
      title="請設定你自己的密碼"
      subtitle="管理員給的初始密碼只能用這一次。設定完成後就會用你自己的密碼登入。"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="管理員給的初始密碼">
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        <Field label="你的新密碼(至少 15 碼)">
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            autoComplete="new-password"
          />
        </Field>
        {error ? <p className="text-[13px] text-er">{error}</p> : null}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "設定中…" : "設定並進入"}
        </Button>
      </form>
    </AuthShell>
  )
}
