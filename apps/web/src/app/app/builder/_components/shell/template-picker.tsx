"use client"

import { describeEngineError } from "@/lib/engine/client"
import { type TemplateSummary, useApplyTemplate, useTemplates } from "@/lib/engine/hooks"
import { Button } from "@weyver/ui/button"
import { LayoutTemplate } from "lucide-react"
import { type ReactNode, useState } from "react"
import { TemplateDetailPane } from "./template-detail"

/* 🔴 R1·TPL M3|建表的第三條路(與空白、Excel 匯入並列)。

   **範本的單位是「包」不是「表」**(OQ-TPL-1=B),所以每一項都要講清楚
   「這會建幾張表」—— 使用者按下去冒出三張表而他以為只有一張,那是驚嚇不是驚喜。

   **M8 改為兩欄:清單 + 詳情。** 2026-08-07 查驗的結論是缺口不在數量,
   在**看不懂就不敢裝** —— 舊版只有一行被 `truncate` 切掉的說明,
   而「取得」按鈕就在旁邊。要人對自己的工作區按下一個看不懂的動作,是設計問題。 */
export function TemplatePicker({
  onApplied,
  onCancel,
}: {
  readonly onApplied: (formId: number) => void
  readonly onCancel: () => void
}): ReactNode {
  const templates = useTemplates()
  const apply = useApplyTemplate()
  const [withRecords, setWithRecords] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const run = (key: string): void => {
    setError(null)
    apply.mutate(
      { key, withRecords },
      {
        /* 導到包內第一張表 —— 套完停在原地等於要使用者自己去清單裡找 */
        onSuccess: (res) => {
          /* 🔴 同名自動加了序號就要講出來 —— 靜默改名跟靜默不改一樣糟。
             使用者可能以為套用失敗了(找不到他預期的那個名字)。 */
          if (res.renamed.length > 0) {
            window.alert(`已建立。因為名稱已存在,以下表單加了序號:\n${res.renamed.join("\n")}`)
          }
          const first = res.formIds[0]
          if (first !== undefined) onApplied(first)
        },
        onError: (e) => setError(describeEngineError(e)),
      },
    )
  }

  /* 職能在前、產業 pack 在後(OQ-TPL-8=C:主軸是職能,產業是可選的一包)。
     主軸放產業等於用範本庫把「多產業通用」的定位講反。 */
  const all = templates.data ?? []
  const generic = all.filter((t) => t.industry === undefined)
  const industry = all.filter((t) => t.industry !== undefined)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-line border-b px-4 py-2.5">
        <LayoutTemplate size={15} strokeWidth={1.9} className="text-ink-3" />
        <h2 className="text-[14px] font-semibold text-ink">從範本開始</h2>
        <span className="text-[12px] text-ink-3">
          每個範本是一組已經接好關聯的表單,套用後即為你自己的表,可任意修改。
        </span>
        <div className="ml-auto">
          <Button onClick={onCancel}>取消</Button>
        </div>
      </div>

      {error !== null ? (
        <div className="border-er-line border-b bg-er-t px-4 py-1.5 text-[13px] text-er">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="w-[286px] shrink-0 overflow-y-auto border-line border-r px-2 py-2">
          {templates.isPending ? (
            <div className="px-2 py-1 text-[12px] text-ink-3">載入範本…</div>
          ) : (
            <>
              <Group title="通用職能" items={generic} picked={picked} onPick={setPicked} />
              {industry.length > 0 ? (
                <Group title="產業 pack" items={industry} picked={picked} onPick={setPicked} />
              ) : null}
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <TemplateDetailPane
            templateKey={picked}
            withRecords={withRecords}
            onWithRecordsChange={setWithRecords}
            onApply={run}
            applying={apply.isPending}
          />
        </div>
      </div>
    </div>
  )
}

function Group({
  title,
  items,
  picked,
  onPick,
}: {
  readonly title: string
  readonly items: readonly TemplateSummary[]
  readonly picked: string | null
  readonly onPick: (key: string) => void
}): ReactNode {
  return (
    <>
      <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
        {title}
      </div>
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick(t.key)}
          className={
            picked === t.key
              ? "mb-0.5 block w-full rounded-sm border border-primary/40 bg-primary-t px-2.5 py-2 text-left"
              : "mb-0.5 block w-full rounded-sm border border-transparent px-2.5 py-2 text-left hover:bg-sunken"
          }
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-ink">{t.name}</span>
            {/* 產業 pack 標出來(OQ-TPL-8=C) */}
            {t.industry === undefined ? null : (
              <span className="rounded-xs border border-line-2 px-1 text-[11px] text-ink-3">
                {t.industry}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] text-ink-3">{t.formCount} 張表</span>
          </div>
          <div className="truncate text-[12px] text-ink-3">{t.description}</div>
          {/* 🔴「沒裝過」與「有新版」是不同的字,不合成一個布林 */}
          {t.updateAvailable ? (
            <div className="mt-1 inline-flex rounded-xs border border-wn-line bg-wn-t px-1 text-[11px] font-medium text-wn">
              有新版 v{t.version}
            </div>
          ) : t.installedVersion !== null ? (
            <div className="mt-1 inline-flex rounded-xs border border-nt-line bg-nt-t px-1 text-[11px] text-nt">
              已安裝 v{t.installedVersion}
            </div>
          ) : null}
        </button>
      ))}
    </>
  )
}
