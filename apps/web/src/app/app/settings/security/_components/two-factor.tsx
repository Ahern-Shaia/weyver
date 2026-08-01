"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { QRCodeSVG } from "qrcode.react"
import { type FormEvent, useState } from "react"
import { twoFactor, useSession } from "@/lib/auth/client"
import { totpErrorMessage } from "@/lib/auth/totp-error"
import { BackupCodes } from "./backup-codes"

type Enroll = { readonly totpURI: string; readonly backupCodes: readonly string[] }

function manualSecret(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? ""
  } catch {
    return ""
  }
}

export function TwoFactor(): React.ReactNode {
  const { data: session, refetch } = useSession()
  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  )

  const [password, setPassword] = useState("")
  const [enroll, setEnroll] = useState<Enroll | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  /* 已啟用者重新產生的結果 —— 與 enroll 共用同一個顯示元件 */
  const [fresh, setFresh] = useState<readonly string[] | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  /* 🔴 沒有重生就只剩「停用再啟用」一條路,而那中間有一段**完全沒有第二因子**
     的空窗 —— 為了換一組碼而暫時降低安全等級,本末倒置。 */
  const regenerate = async (): Promise<void> => {
    const pw = window.prompt("為了重新產生備用碼,請再次輸入密碼")
    if (pw === null || pw === "") return
    setRegenerating(true)
    setError(null)
    const res = await twoFactor.generateBackupCodes({ password: pw })
    setRegenerating(false)
    if (res.error || !res.data) {
      setError("密碼錯誤或產生失敗")
      return
    }
    setFresh(res.data.backupCodes)
  }

  const startEnable = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const res = await twoFactor.enable({ password })
    setBusy(false)
    if (res.error || !res.data) {
      setError("密碼錯誤或啟用失敗")
      return
    }
    setEnroll({ totpURI: res.data.totpURI, backupCodes: res.data.backupCodes })
    setPassword("")
  }

  const confirmEnable = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const res = await twoFactor.verifyTotp({ code })
    setBusy(false)
    if (res.error) {
      setError(totpErrorMessage(res.error))
      return
    }
    setEnroll(null)
    setCode("")
    refetch()
  }

  const disable = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const res = await twoFactor.disable({ password })
    setBusy(false)
    if (res.error) {
      setError("密碼錯誤或停用失敗")
      return
    }
    setPassword("")
    refetch()
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">二步驟驗證</h2>
        <p className="mt-1 text-[12px] text-ink-3">
          登入時除密碼外,再輸入 authenticator app(Google Authenticator / 1Password /
          Authy)產生的一次性碼,大幅降低帳號被盜風險。
        </p>
      </div>

      <div className="rounded-sm border border-line bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-[12px]">
          <span className="text-ink-2">目前狀態</span>
          <span
            className={
              enabled
                ? "rounded-xs border border-ok-line bg-ok-t px-1.5 py-0.5 text-ok"
                : "rounded-xs border border-line bg-head px-1.5 py-0.5 text-ink-2"
            }
          >
            {enabled ? "已啟用" : "未啟用"}
          </span>
        </div>

        {/* 未啟用 + 尚未開始:輸入密碼開始 */}
        {!enabled && !enroll ? (
          <form onSubmit={startEnable} className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-ink-2">輸入目前密碼以啟用</span>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="max-w-xs"
            />
            {error ? <p className="text-[13px] text-er">{error}</p> : null}
            <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-fit">
              {busy ? "處理中…" : "啟用二步驟驗證"}
            </Button>
          </form>
        ) : null}

        {/* enroll 中:掃 QR + 輸入碼確認 + 顯示備用碼 */}
        {enroll ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-2 text-[12px] text-ink-2">1. 用 authenticator app 掃描 QR:</p>
              <div className="inline-block rounded-sm border border-line bg-white p-2">
                <QRCodeSVG value={enroll.totpURI} size={140} />
              </div>
              <p className="mt-1 text-[12px] text-ink-3">
                無法掃描?手動輸入代碼:
                <span data-testid="totp-secret" className="font-mono text-ink-2">
                  {manualSecret(enroll.totpURI)}
                </span>
              </p>
            </div>
            <div>
              <p className="mb-1 text-[12px] text-ink-2">
                2. 妥善保存備用碼(遺失手機時救援,每組只能用一次):
              </p>
              <BackupCodes codes={enroll.backupCodes} />
              {/* 🔴 **確認已保存才讓流程往下走**(GitHub / Google 同做法)。
                  備用碼是雜湊儲存且只顯示這一次 —— 直接放行等於讓人一路點過去,
                  然後在手機掉了那天才發現自己沒存。 */}
              <label className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(e) => setSaved(e.target.checked)}
                  className="accent-primary"
                />
                我已妥善保存這組備用碼(之後無法再次查看)
              </label>
            </div>
            <form onSubmit={confirmEnable} className="flex flex-col gap-2">
              <span className="text-[12px] text-ink-2">3. 輸入 app 顯示的 6 碼完成啟用:</span>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="w-40"
              />
              {error ? <p className="text-[13px] text-er">{error}</p> : null}
              <Button type="submit" variant="primary" disabled={busy || !saved} className="w-fit">
                {busy ? "驗證中…" : "完成啟用"}
              </Button>
            </form>
          </div>
        ) : null}

        {/* 已啟用:備用碼管理 + 輸入密碼停用 */}
        {enabled ? (
          <div className="mb-4 flex flex-col gap-2 border-b border-line pb-4">
            <span className="text-[12px] font-medium text-ink-2">備用碼</span>
            {fresh === null ? (
              <>
                <p className="text-[12px] text-ink-3">
                  備用碼以單向雜湊儲存,啟用當下顯示後即無法再查看。
                  用剩不多或懷疑外洩時,可重新產生一組。
                </p>
                <Button onClick={() => void regenerate()} disabled={regenerating} className="w-fit">
                  {regenerating ? "產生中…" : "重新產生備用碼"}
                </Button>
              </>
            ) : (
              <>
                <p className="text-[12px] text-ink-2">
                  新的備用碼已產生,<b>舊的已全部失效</b>。這組同樣只顯示這一次。
                </p>
                <BackupCodes codes={fresh} />
              </>
            )}
          </div>
        ) : null}

        {enabled ? (
          <form onSubmit={disable} className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-ink-2">輸入目前密碼以停用</span>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="max-w-xs"
            />
            {error ? <p className="text-[13px] text-er">{error}</p> : null}
            <Button type="submit" variant="danger" disabled={busy} className="mt-1 w-fit">
              {busy ? "處理中…" : "停用二步驟驗證"}
            </Button>
          </form>
        ) : null}
      </div>
    </section>
  )
}
