"use client"

import { Button } from "@weyver/ui/button"
import { Select } from "@weyver/ui/select"
import type { ReactNode } from "react"
import { useState } from "react"
import { BusyBar, FirstLoad } from "@/components/busy-indicator"
import { describeEngineError } from "@/lib/engine/client"
import {
  LOCALE_LABELS,
  TIMEZONES,
  type UserSettings,
  useUpdateUserSettings,
  useUserSettings,
} from "@/lib/engine/use-settings"

/* R1·A-1 M1|個人設定(S22 之個人軸)。

   🔴 **每一項都要說得出「現在是跟隨公司、還是你自己設的」。**
   後端同時回有效值與 `overrides` 旗標,正是為了這件事:只顯示有效值的話,
   使用者看到 `Asia/Taipei` 無從得知那是自己選的還是跟著公司 ——
   也就不知道公司改設定時他會不會跟著變。

   而「退回跟隨公司」必須有一條明確的路(送 `null`)。少了它,使用者一旦動過
   就**永遠回不去繼承**,只能一直卡在某個自訂值上。 */

export default function ProfileSettingsPage(): ReactNode {
  const { data } = useUserSettings()
  const update = useUpdateUserSettings()
  const [error, setError] = useState<string | null>(null)

  if (data === undefined) return <FirstLoad />

  const apply = (patch: { locale?: string | null; displayTimezone?: string | null }): void => {
    setError(null)
    update.mutate(patch, { onError: (e) => setError(describeEngineError(e)) })
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-[16px] font-semibold text-ink">個人設定</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          只影響你自己,不會改到同事看到的內容。未自訂的項目會跟隨公司設定。
        </p>
      </div>

      <div className="relative flex flex-col gap-3 rounded-sm border border-line bg-card p-4">
        <BusyBar busy={update.isPending} />

        <Row
          label="介面語言"
          overridden={data.overrides.locale}
          inheritedLabel={LOCALE_LABELS[data.tenantDefaults.locale] ?? data.tenantDefaults.locale}
          onReset={() => apply({ locale: null })}
        >
          <Select value={data.locale} onChange={(e) => apply({ locale: e.target.value })}>
            {Object.entries(LOCALE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Row>

        <Row
          label="顯示時區"
          hint="只改變畫面上時間顯示的方式。單號日期段等業務期間一律以公司的業務時區為準。"
          overridden={data.overrides.displayTimezone}
          inheritedLabel={data.tenantDefaults.timezone}
          onReset={() => apply({ displayTimezone: null })}
        >
          <Select
            value={data.displayTimezone}
            onChange={(e) => apply({ displayTimezone: e.target.value })}
          >
            {timezoneOptions(data).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Row>

        {error !== null ? <p className="text-[12px] text-er">{error}</p> : null}
      </div>
    </main>
  )
}

/* 公司的業務時區未必在常用清單裡(後端接受任何合法 IANA 值)——
   不併進來的話,下拉會顯示成清單第一項,看起來像使用者選了別的時區。 */
function timezoneOptions(data: UserSettings): readonly string[] {
  const set = new Set<string>([...TIMEZONES, data.tenantDefaults.timezone, data.displayTimezone])
  return [...set]
}

function Row({
  label,
  hint,
  overridden,
  inheritedLabel,
  onReset,
  children,
}: {
  readonly label: string
  readonly hint?: string
  readonly overridden: boolean
  readonly inheritedLabel: string
  readonly onReset: () => void
  readonly children: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col gap-1 border-line-2 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        {overridden ? (
          <span className="rounded-xs border border-line bg-label px-1.5 text-[12px] text-ink-3">
            已自訂
          </span>
        ) : (
          <span className="text-[12px] text-ink-3">跟隨公司設定({inheritedLabel})</span>
        )}
      </div>
      {children}
      {hint === undefined ? null : <span className="text-[12px] text-ink-3">{hint}</span>}
      {overridden ? (
        <Button variant="subtle" onClick={onReset} className="w-fit text-[12px]">
          改回跟隨公司設定
        </Button>
      ) : null}
    </div>
  )
}
