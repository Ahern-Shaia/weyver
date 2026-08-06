"use client"

import type { ReactNode } from "react"

import { Select } from "@weyver/ui/select"

/* 🔴 R1·C-5|定時觸發的排程欄位。

   拆成獨立檔是因為 `triggers-panel.tsx` 加完排程後到了 548 行(紅線 400)。
   ⚠️ 拆的邊界選在這裡而不是隨便切:排程是**一組互相牽動的欄位**
   (頻率決定要不要問星期 / 幾號),那組耦合在自己的檔案裡才看得清楚。 */
export function ScheduleFields({
  freq,
  hour,
  day,
  onFreq,
  onHour,
  onDay,
}: {
  readonly freq: "daily" | "weekly" | "monthly"
  readonly hour: number
  readonly day: number
  readonly onFreq: (v: "daily" | "weekly" | "monthly") => void
  readonly onHour: (v: number) => void
  readonly onDay: (v: number) => void
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5 border border-line-2 p-2">
      <div className="flex items-center gap-1.5">
        <Select
          className="h-7 flex-1"
          value={freq}
          aria-label="頻率"
          onChange={(e) => onFreq(e.target.value as "daily" | "weekly" | "monthly")}
        >
          <option value="daily">每天</option>
          <option value="weekly">每週</option>
          <option value="monthly">每月</option>
        </Select>

        {freq === "weekly" ? (
          <Select
            className="h-7 flex-1"
            value={String(day)}
            aria-label="星期"
            onChange={(e) => onDay(Number(e.target.value))}
          >
            {["日", "一", "二", "三", "四", "五", "六"].map((d, i) => (
              <option key={d} value={String(i)}>
                星期{d}
              </option>
            ))}
          </Select>
        ) : null}

        {freq === "monthly" ? (
          <Select
            className="h-7 flex-1"
            value={String(day)}
            aria-label="日期"
            onChange={(e) => onDay(Number(e.target.value))}
          >
            {/* 🔴 只到 28 號,外加「月底」。**2 月沒有 29–31 號** ——
                      讓人選得到一個「有些月份不會發生」的日期,
                      等於賣一個會靜默漏跑的設定。月結選「月底」。 */}
            <option value="0">月底</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)}>
                {d} 號
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          className="h-7 w-24"
          value={String(hour)}
          aria-label="時刻"
          onChange={(e) => onHour(Number(e.target.value))}
        >
          {Array.from({ length: 24 }, (_, h) => h).map((h) => (
            <option key={h} value={String(h)}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </Select>
      </div>

      {/* 🔴 三件使用者不會自己猜到、猜錯又很難查的事。 */}
      <p className="text-ink-3">
        時刻是<span className="font-semibold text-ink-2">貴公司設定的時區</span>,
        最小單位為小時。到點時會<span className="font-semibold text-ink-2">掃過整張表</span>,
        對每一筆符合條件的記錄各執行一次(單次上限 1000 筆,其餘留待下次)。
      </p>
      <p className="text-ink-3">
        定時觸發<span className="font-semibold text-ink-2">以你的身分執行</span> ——
        你離開公司或被停權之後,它會停下來並記在執行紀錄裡。
      </p>
    </div>
  )
}
