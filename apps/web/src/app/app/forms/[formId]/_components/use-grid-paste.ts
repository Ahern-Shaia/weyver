"use client"

import { describeEngineError } from "@/lib/engine/client"
import { useBulkCreate, useBulkUpdateRecords } from "@/lib/engine/hooks"
import { describePasteRejection, normalizePasteMatrix } from "@/lib/engine/paste-matrix"
import {
  type PastePlan,
  buildPastePlan,
  describePasteEffects,
  planPasteCell,
} from "@/lib/engine/paste-plan"
import type { FieldDto, RecordRow } from "@/lib/engine/schemas"
import type { Item } from "@glideapps/glide-data-grid"
import { useCallback, useMemo, useState } from "react"

/* 🔴 R1·GP M3 UI + M4|貼上的編排層。

   放在 hook 而不是 `collection-view.tsx` 裡:那個檔已 338 行,
   而貼上要處理先驗 / 確認 / 送出 / undo 四段狀態。

   **一律回 `false` 給 Glide**(見 `grid-sheet.tsx` 註解)——
   由我們接管才能做先驗與加列;讓 Glide 自己寫格會**靜默丟掉超出的列**。 */

export interface PasteState {
  /* 有不合法的格 → 整批不送,標紅並列出原因(OQ-GP-5) */
  readonly invalid: readonly {
    readonly row: number
    readonly col: number
    readonly message: string
  }[]
  /* 需要使用者確認才新增的列數(OQ-GP-3);0 = 不需確認 */
  readonly pendingNewRows: number
  readonly notes: readonly string[]
  readonly error: string | null
  readonly canUndo: boolean
}

const EMPTY: PasteState = {
  invalid: [],
  pendingNewRows: 0,
  notes: [],
  error: null,
  canUndo: false,
}

export function useGridPaste(input: {
  readonly formId: number
  readonly fields: readonly FieldDto[]
  readonly records: readonly RecordRow[]
  /* 目前是否套著篩選 / 搜尋 —— 決定能不能加列(見 `commit`) */
  readonly filtered: boolean
  /* 網格第一欄是「檢視」marker,不對應欄位 */
  readonly colOffset: number
}): {
  readonly state: PasteState
  readonly onPaste: (target: Item, values: readonly (readonly string[])[]) => boolean
  readonly confirmAddRows: () => void
  readonly pasteExistingOnly: () => void
  readonly cancel: () => void
  readonly undo: () => void
  readonly isCellInvalid: (row: number, col: number) => boolean
} {
  const bulk = useBulkUpdateRecords(input.formId)
  const bulkCreate = useBulkCreate(input.formId)
  const [state, setState] = useState<PasteState>(EMPTY)
  const [plan, setPlan] = useState<PastePlan | null>(null)
  /* M4 一步 undo:貼上前把受影響的 (recordId, 欄名) → 舊值快照下來。
     使用者按的是**一個**動作,還原也該是一個。 */
  const [snapshot, setSnapshot] = useState<
    readonly { readonly recordId: number; readonly values: Record<string, unknown> }[]
  >([])

  const invalidKeys = useMemo(
    () => new Set(state.invalid.map((c) => `${String(c.row)}:${String(c.col)}`)),
    [state.invalid],
  )

  const send = useCallback(
    (
      updates: readonly { readonly recordId: number; readonly values: Record<string, unknown> }[],
      notes: readonly string[],
      before: readonly { readonly recordId: number; readonly values: Record<string, unknown> }[],
    ) => {
      if (updates.length === 0) {
        setState({ ...EMPTY, notes })
        return
      }
      bulk.mutate(
        { rows: updates.map((u) => ({ recordId: u.recordId, values: u.values })) },
        {
          onSuccess: () => {
            setSnapshot(before)
            setState({ ...EMPTY, notes, canUndo: before.length > 0 })
          },
          onError: (e) => setState({ ...EMPTY, error: describeEngineError(e) }),
        },
      )
    },
    [bulk],
  )

  const commit = useCallback(
    (p: PastePlan) => {
      /* 貼上前的舊值 —— 只快照**這次會被改到的欄**,不是整筆記錄:
         整筆快照會把別人同時改的其他欄一起還原回去。 */
      const byId = new Map(input.records.map((r) => [r.id, r]))
      const fieldByName = new Map(input.fields.map((f) => [f.name, f]))
      const before = p.updates.map((u) => ({
        recordId: u.recordId,
        values: Object.fromEntries(
          Object.keys(u.values).map((k) => [
            k,
            oldValueForWrite(fieldByName.get(k), byId.get(u.recordId)?.values[k]),
          ]),
        ),
      }))
      send(p.updates, describePasteEffects(p), before)
    },
    [input.records, send],
  )

  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      const matrix = normalizePasteMatrix(values)
      if (!matrix.ok) {
        setState({ ...EMPTY, error: describePasteRejection(matrix) })
        return false
      }
      const [targetCol, targetRow] = target
      const p = buildPastePlan({
        rows: matrix.matrix.rows,
        targetCol: Math.max(0, targetCol - input.colOffset),
        targetRow,
        fields: input.fields,
        records: input.records,
      })

      if (p.invalid.length > 0) {
        /* OQ-GP-5:整批不送,標紅那幾格。查無任何一家競品這樣做(§0.3e),
           而「文字貼進數值欄靜默變空」正是 Baserow 官方承認的行為。 */
        setState({ ...EMPTY, invalid: p.invalid, notes: describePasteEffects(p) })
        return false
      }

      if (p.newRows.length > 0) {
        /* 🔴 OQ-GP-3 硬約束(ii):**篩選檢視下不加列**。
           Teable 踩過「in a filtered view could append new rows instead of
           updating visible ones」—— 使用者看到的列不是全部,加列會加在他看不到的地方。 */
        if (input.filtered) {
          setState({
            ...EMPTY,
            error: `貼上的資料超出目前顯示的 ${String(input.records.length)} 列。目前套著篩選或搜尋,無法在此新增列 —— 請先清除篩選再貼上。`,
          })
          return false
        }
        /* 加列是**改變資料形狀**不是改值(Airtable 的 Expand the table → Continue),
           值得一次明確同意;確認框也天然是顯示「將新增 N 列」的位置。 */
        setPlan(p)
        setState({
          ...EMPTY,
          pendingNewRows: p.newRows.length,
          notes: describePasteEffects(p),
        })
        return false
      }

      commit(p)
      return false
    },
    [input.colOffset, input.fields, input.records, input.filtered, commit],
  )

  /* 🔴 先建列、再寫既有列。

     ⚠️ **兩次呼叫不是同一個 tx**,這偏離 OQ-GP-1 的「單一 tx 全成或全敗」,
     必須誠實記著:建列成功而更新失敗時,新列會留下(值是空的),既有列不變。
     選這個順序是因為它的失敗態**看得見** —— 反過來(先更新再建列)失敗時
     使用者只會看到「有些列沒出現」,而那正是 §0.3(c) 的靜默少做。
     真正的解是後端一支端點同時收 create + update,列為後續。 */
  const confirmAddRows = useCallback(() => {
    if (plan === null) return
    const p = plan
    setPlan(null)
    bulkCreate.mutate([...p.newRows], {
      onSuccess: () => commit(p),
      onError: (e) =>
        setState({
          ...EMPTY,
          error: `新增列失敗,既有列也未更動:${describeEngineError(e)}`,
        }),
    })
  }, [plan, commit, bulkCreate])

  /* 只貼既有列 —— 使用者明確拒絕加列時走這條,超出的部分要講出來 */
  const pasteExistingOnly = useCallback(() => {
    if (plan === null) return
    const p = plan
    setPlan(null)
    commit(p)
    setState((s) => ({
      ...s,
      notes: [...s.notes, `${String(p.newRows.length)} 列超出現有資料,未新增`],
    }))
  }, [plan, commit])

  const cancel = useCallback(() => {
    setPlan(null)
    setState(EMPTY)
  }, [])

  const undo = useCallback(() => {
    if (snapshot.length === 0) return
    const before = snapshot
    setSnapshot([])
    bulk.mutate(
      { rows: before.map((u) => ({ recordId: u.recordId, values: u.values })) },
      {
        onSuccess: () => setState(EMPTY),
        onError: (e) => setState({ ...EMPTY, error: describeEngineError(e) }),
      },
    )
  }, [snapshot, bulk])

  const isCellInvalid = useCallback(
    (row: number, col: number) => invalidKeys.has(`${String(row)}:${String(col)}`),
    [invalidKeys],
  )

  return { state, onPaste, confirmAddRows, pasteExistingOnly, cancel, undo, isCellInvalid }
}

/* 🔴 快照的舊值**不能原封送回去**。

   PG 把 `numeric` 欄回成**字串**(保精度),而寫入端的 zod 要 `number` ——
   undo 直接回送就是 422 `expected number, received string`。
   e2e 抓到,而型別檢查與單元測試都不會抱怨:`values` 是 `unknown`。

   ⚠️ 這是同一個形狀的**第三次**:member 欄 bigint 回字串(`approverRule: fieldRef`)、
   搜尋索引、以及這裡。**凡是「讀出來的值要再寫回去」的路徑,都要重走一次轉換。**

   走 `planPasteCell` 而不是自己寫轉換 —— 它就是貼上用的那一條,
   兩邊用同一個函式才不會日後分岔。 */
function oldValueForWrite(field: FieldDto | undefined, raw: unknown): unknown {
  if (field === undefined) return null
  if (raw === null || raw === undefined) return null
  const plan = planPasteCell(field, String(raw))
  return plan.kind === "set" ? plan.value : null
}
