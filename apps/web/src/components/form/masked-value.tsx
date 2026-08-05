"use client"

import { Eye } from "lucide-react"
import { type ReactNode, useState } from "react"
import { z } from "zod"

import { engineFetch } from "@/lib/engine/client"

/* 🔴 R1·FTP v1.7|遮罩欄的顯示 + 眼睛按鈕。

   Ragic 逐字:「設定**可瀏覽資料的群組**……該群組使用者就可以點擊
   **預覽按鈕(眼睛符號)**來檢視完整資料。」

   ## 這個元件**沒有**「有沒有權限」的判斷

   權限在伺服器。前端一律顯示按鈕,按下去由後端決定給不給 ——
   這是刻意的:若前端先判斷再決定顯不顯示,那份判斷就是第二份權限來源,
   而它必然與後端分岔。**按了才知道**在這裡是對的,因為拒絕本身也是答案。

   ## 揭露不是 toggle

   看過就是看過(而且留了稽核)。收合只是把畫面收回去,不會「取消」那次揭露 ——
   所以按鈕文案是「顯示完整」而不是「切換」。 */
export function MaskedValue({
  formId,
  recordId,
  field,
  masked,
}: {
  readonly formId: number
  readonly recordId: number
  readonly field: string
  readonly masked: string
}): ReactNode {
  const [full, setFull] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (masked === "" || masked === "—") return <span className="text-ink-3">—</span>

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono">{full ?? masked}</span>
      {full === null ? (
        <button
          type="button"
          disabled={busy}
          title="顯示完整內容(會留下稽核紀錄)"
          aria-label={`${field} 顯示完整內容`}
          className="text-ink-3 hover:text-ink disabled:opacity-50"
          onClick={() => {
            setBusy(true)
            setError(null)
            void engineFetch(
              `/forms/${String(formId)}/records/${String(recordId)}/reveal`,
              z.object({ value: z.string() }),
              { method: "POST", body: { field } },
            )
              .then((r) => setFull(r.value))
              /* 拒絕的理由由後端給 —— 前端不自己編一套說法 */
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false))
          }}
        >
          <Eye size={13} strokeWidth={1.9} />
        </button>
      ) : null}
      {error === null ? null : <span className="text-[12px] text-er">{error}</span>}
    </span>
  )
}
