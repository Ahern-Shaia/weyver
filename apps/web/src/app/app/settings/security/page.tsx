import { Suspense } from "react"
import { AuthLog } from "./_components/auth-log"
import { DeviceList } from "./_components/device-list"
import { MfaRequiredNotice } from "./_components/mfa-required-notice"
import { TwoFactor } from "./_components/two-factor"

/* R1·A-1 M3|帳號安全。三個區塊由上而下依「使用者最可能要做的事」排:
   先看有沒有可疑裝置 → 加強防護(2FA)→ 回溯發生過什麼。 */

export default function SecurityPage(): React.ReactNode {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-7 px-6 py-8">
      <div>
        <h1 className="text-[16px] font-semibold text-ink">帳號安全</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          管理登入中的裝置、二步驟驗證,並查看自己帳號的認證活動紀錄。
        </p>
      </div>
      {/* useSearchParams 需 Suspense 邊界(Next 靜態預先渲染的要求) */}
      <Suspense fallback={null}>
        <MfaRequiredNotice />
      </Suspense>
      <DeviceList />
      <TwoFactor />
      <AuthLog />
    </main>
  )
}
