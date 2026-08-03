"use client"

import { describeEngineError } from "@/lib/engine/client"
import { useApplyTemplate, useTemplates } from "@/lib/engine/hooks"
import { Button } from "@weyver/ui/button"
import { LayoutTemplate } from "lucide-react"
import { type ReactNode, useState } from "react"

/* 🔴 R1·TPL M3|建表的第三條路(與空白、Excel 匯入並列)。

   **範本的單位是「包」不是「表」**(OQ-TPL-1=B),所以每一項都要講清楚
   「這會建幾張表」—— 使用者按下去冒出三張表而他以為只有一張,那是驚嚇不是驚喜。

   **範例資料是一個布林**(OQ-TPL-4=A,Teable 形態):
   一個參數同時解掉「要不要帶」與「事後怎麼清」—— 不帶就不用清。
   Airtable 一律帶再提供清除,而它自己踩了坑:清除入口藏在一次性側欄,
   官方文件還得補一段 workaround。 */
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

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <LayoutTemplate size={15} strokeWidth={1.9} className="text-ink-3" />
        <h2 className="text-[14px] font-semibold text-ink">從範本開始</h2>
      </div>
      <p className="mb-3 text-[12px] text-ink-3">
        每個範本是一組已經接好關聯的表單。套用後即為你自己的表,可任意修改。
      </p>

      <label className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={withRecords}
          onChange={(e) => setWithRecords(e.target.checked)}
          className="accent-(--color-primary)"
        />
        一併帶入示範資料(之後要自己刪)
      </label>

      {error !== null ? (
        <div className="mb-3 border border-er-line bg-er-t px-3 py-1.5 text-[13px] text-er">
          {error}
        </div>
      ) : null}

      {templates.isPending ? (
        <div className="text-[12px] text-ink-3">載入範本…</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {templates.data?.map((t) => (
            <li
              key={t.key}
              className="flex items-center gap-3 rounded-md border border-line bg-card px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium text-ink">{t.name}</span>
                  {/* 產業 pack 標出來 —— 主軸是職能,產業是可選的一包(OQ-TPL-8=C) */}
                  {t.industry === undefined ? null : (
                    <span className="rounded-xs border border-line-2 px-1 text-[12px] text-ink-3">
                      {t.industry}
                    </span>
                  )}
                  <span className="text-[12px] text-ink-3">· {t.formCount} 張表</span>
                </div>
                <div className="truncate text-[12px] text-ink-3">{t.description}</div>
              </div>
              <Button
                variant="primary"
                disabled={apply.isPending}
                onClick={() => run(t.key)}
                aria-label={`套用範本 ${t.name}`}
              >
                {apply.isPending ? "建立中…" : "使用"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Button onClick={onCancel}>取消</Button>
      </div>
    </div>
  )
}
