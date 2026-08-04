"use client"

import { NOTIFICATION_LEVELS } from "@/lib/engine/notification-levels"
import type { ReactNode } from "react"

/* 通知層級選擇器。設定中心與表單層面板共用 —— 見 `notification-levels.ts` 的註解。

   軸 1 為**單一有序 enum** 而非獨立布林開關:GitHub / GitLab / Discourse / Zulip /
   Notion / Slack / Teams / Linear 無一例外皆如此。有序才可繼承(表單 → 分類 → 租戶,
   最具體者勝),獨立開關無法表達「跟著上層」。 */
export function NotificationLevelPicker({
  value,
  label = "通知層級",
  disabled = false,
  onPick,
}: {
  readonly value: number
  /* 🔴 同一頁上會有多組(全租戶 / 每個分類 / 每張表單)。全部叫「通知層級」的話,
     螢幕閱讀器唸出來一模一樣,而測試也只能靠位置去猜是哪一組。 */
  readonly label?: string
  readonly disabled?: boolean
  readonly onPick: (level: number) => void
}): ReactNode {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col">
      {NOTIFICATION_LEVELS.map((lv) => (
        <button
          key={lv.value}
          type="button"
          role="radio"
          aria-checked={value === lv.value}
          disabled={disabled}
          onClick={() => onPick(lv.value)}
          className={`flex items-start gap-2 border border-b-0 border-line-2 px-2.5 py-2 text-left last:border-b ${
            value === lv.value ? "border-primary bg-primary-t" : ""
          }`}
        >
          <span
            className={`mt-0.5 size-3 shrink-0 rounded-full border ${
              value === lv.value ? "border-[1.5px] border-primary" : "border-line"
            }`}
          >
            {value === lv.value ? (
              <span className="m-[2.5px] block size-[5px] rounded-full bg-primary" />
            ) : null}
          </span>
          <span>
            <span className="block text-[12px] font-medium">
              {lv.name}
              {"isDefault" in lv ? (
                <span className="ml-1 font-normal text-ink-3">(預設)</span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-[12px] text-ink-3">{lv.desc}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
