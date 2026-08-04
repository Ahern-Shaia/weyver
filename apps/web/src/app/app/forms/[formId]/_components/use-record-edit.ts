"use client"

import { toSubmitValue } from "@/components/form/value"
import { describeEngineError } from "@/lib/engine/client"
import { useUpdateRecord } from "@/lib/engine/hooks"
import type { FieldDto, RecordRow } from "@/lib/engine/schemas"
import { useEffect, useState } from "react"

/* 記錄就地編輯的狀態 + **未儲存變更防護**。

   🔴 為什麼需要防護:編輯中切換記錄、或關掉分頁,原本會**靜默丟棄**整筆編輯。
   Fiori 對此有明確規定 ——「If the user has made changes in edit mode, show a
   data loss message whenever the user navigates away from the edit page or
   clicks Cancel.」三條路徑各自要擋:

   1. **按「取消」** → 這裡的 `cancelEdit()` 先問再丟
   2. **切換記錄** → 由父層攔(ObjectPage 以 `key` 重掛,狀態在此消失,擋不到)
      → 故本 hook 把 `dirty` 往上報,父層據以攔截
   3. **關分頁 / 重新整理** → `beforeunload`

   ⚠️ **App Router 的 client-side 換頁(如點側邊導覽)攔不到** —— Next 沒有
   受支援的導覽守衛,`beforeunload` 也不會觸發。這是已知缺口,不假裝有擋。

   從 object-page.tsx 抽出來的另一個理由:該檔已 535 行,再長就沒人讀得完。 */

export interface RecordEdit {
  readonly editing: boolean
  readonly draft: Record<string, unknown>
  readonly dirty: boolean
  readonly busy: boolean
  readonly msg: string | null
  readonly setMsg: (m: string | null) => void
  readonly setField: (name: string, value: unknown) => void
  /* R1·LNK M2:連結欄的 Load 帶入一次寫多欄(逐欄呼叫 setField 會連續觸發多次重繪) */
  readonly setFields: (patch: Record<string, unknown>) => void
  readonly startEdit: () => void
  readonly cancelEdit: () => void
  readonly saveEdit: () => void
}

const initialDraft = (fields: readonly FieldDto[], record: RecordRow): Record<string, unknown> => {
  const initial: Record<string, unknown> = {}
  for (const f of fields) {
    const v = record.values[f.name]
    initial[f.name] = v === null || v === undefined ? "" : v
  }
  return initial
}

export function useRecordEdit(
  formId: number,
  record: RecordRow,
  fields: readonly FieldDto[],
  onDirtyChange?: (dirty: boolean) => void,
): RecordEdit {
  const updateRecord = useUpdateRecord(formId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  /* 比對基準:進入編輯當下的值。用它判斷 dirty,而不是「有沒有打過字」——
     改了又改回來不該還跳警告。 */
  const [baseline, setBaseline] = useState<Record<string, unknown>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const dirty = editing && fields.some((f) => !sameValue(draft[f.name], baseline[f.name]))

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  /* 關分頁 / 重新整理。瀏覽器只准顯示自己的制式訊息,`preventDefault` 才是關鍵。 */
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => {
      window.removeEventListener("beforeunload", handler)
    }
  }, [dirty])

  const startEdit = (): void => {
    const initial = initialDraft(fields, record)
    setDraft(initial)
    setBaseline(initial)
    setMsg(null)
    setEditing(true)
  }

  const leaveEdit = (): void => {
    setEditing(false)
    onDirtyChange?.(false)
  }

  const cancelEdit = (): void => {
    if (dirty && !window.confirm("有未儲存的變更,確定要捨棄?")) return
    leaveEdit()
  }

  const saveEdit = (): void => {
    const values: Record<string, unknown> = {}
    for (const f of fields) {
      const submitted = toSubmitValue(f, draft[f.name])
      if (submitted !== undefined) values[f.name] = submitted
    }
    updateRecord.mutate(
      { recordId: record.id, expectedVersion: record.version, values },
      {
        onSuccess: () => {
          leaveEdit()
          setMsg("已儲存")
        },
        onError: (e) => setMsg(describeEngineError(e)),
      },
    )
  }

  return {
    editing,
    draft,
    dirty,
    busy: updateRecord.isPending,
    msg,
    setMsg,
    setField: (name, value) => setDraft((d) => ({ ...d, [name]: value })),
    setFields: (patch) => setDraft((d) => ({ ...d, ...patch })),
    startEdit,
    cancelEdit,
    saveEdit,
  }
}

/* 陣列(附件 / 多選)比參照會誤判 —— 每次 render 都是新陣列。用序列化比值。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  }
  return false
}
