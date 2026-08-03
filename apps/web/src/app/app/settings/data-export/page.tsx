"use client"

import { Button } from "@weyver/ui/button"
import { type ReactNode, useState } from "react"
import { BusyBar, FirstLoad } from "@/components/busy-indicator"
import { describeEngineError } from "@/lib/engine/client"
import { isExportActive, useCreateExport, useExports } from "@/lib/engine/use-exports"
import { ExportJobRow } from "./_components/export-job-row"

/* R1·I-1 M4|資料匯出(帶得走的完整副本)。

   **這頁不是「匯出 Excel」的放大版**|列表頁那顆匯出鈕只含畫面上已載入的列,
   是看的便利;少一列沒人會死。這裡是整個工作區的完整副本,少一列就是資料遺失。
   兩者的失效方式不同,所以刻意分開,說明文字也要讓使用者分得出來。

   **為什麼要顯示到期與剩餘次數**|封存檔是一整包公司資料,會過期、限下載 5 次。
   不把這兩個數字放在檯面上,使用者只會在第 6 次按下去時才發現 —— 那時候
   他可能已經把唯一一份刪掉了。 */

export default function DataExportPage(): ReactNode {
  const { data, isLoading } = useExports()
  const create = useCreateExport()
  const [includeAttachments, setIncludeAttachments] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onCreate = async (): Promise<void> => {
    setError(null)
    try {
      await create.mutateAsync({ includeAttachments })
    } catch (err) {
      setError(describeEngineError(err))
    }
  }

  if (data === undefined) return <FirstLoad />

  const running = data.jobs.some(isExportActive)

  return (
    <div className="relative mx-auto max-w-[720px] p-6">
      <BusyBar busy={isLoading} />
      <h2 className="text-[16px] font-semibold">資料匯出</h2>
      <p className="mt-1 text-[12px] text-ink-3">
        產生整個工作區的完整副本:每張表單一份 CSV,另附一份 manifest 記錄欄位型別、選項與關聯 ——
        沒有它,拿到檔案的人無從得知某一欄原本是日期還是文字。 封存檔保留 {data.ttlDays}{" "}
        天,每份限下載 5 次,到期後自動刪除。
      </p>
      <p className="mt-1 text-[12px] text-ink-3">
        列表頁的「匯出」只含畫面上已載入的資料,用途不同。
      </p>

      <div className="mt-4 rounded-md border border-line bg-card px-3 py-3">
        <label className="flex items-center gap-1.5 text-[12px] text-ink">
          <input
            type="checkbox"
            className="size-3.5"
            checked={includeAttachments}
            onChange={(e) => setIncludeAttachments(e.target.checked)}
          />
          一併包含附件與圖片
        </label>
        {/* 預設不含是刻意的:附件是體積的數量級來源,含進去會讓產生時間從幾秒變成幾十分鐘 */}
        <p className="mt-1 text-[12px] text-ink-3">
          不勾選時封存檔只有資料本身,產得快很多。檢驗報告、現場照片這類要留存的檔案才需要勾。
        </p>
        <Button
          variant="primary"
          size="sm"
          className="mt-2.5 w-fit"
          disabled={create.isPending || running}
          onClick={() => void onCreate()}
        >
          {create.isPending ? "建立中…" : "建立匯出"}
        </Button>
        {/* 同時只能有一個在跑。按鈕停用而不隱藏 —— 隱藏會讓人以為功能不見了 */}
        {running ? (
          <p className="mt-1.5 text-[12px] text-ink-3">
            已有一個匯出正在進行,完成後才能建立下一個。
          </p>
        ) : null}
        {error !== null ? <p className="mt-1.5 text-[12px] text-er">{error}</p> : null}
      </div>

      {data.jobs.length === 0 ? (
        <div className="mt-4 rounded-md border border-line bg-card px-4 py-8 text-center text-[12px] text-ink-3">
          還沒有匯出過。
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-1.5">
          {data.jobs.map((job) => (
            <ExportJobRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </div>
  )
}
