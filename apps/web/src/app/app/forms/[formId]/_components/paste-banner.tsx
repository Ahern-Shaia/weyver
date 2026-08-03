"use client"

import { Button } from "@weyver/ui/button"
import type { ReactNode } from "react"
import type { useGridPaste } from "./use-grid-paste"

/* 🔴 R1·GP M3/M4|貼上的結果列。

   本模組 §0.3(c) 的反面教材共同點是「**使用者看到成功、系統其實少做了事**」——
   Ragic 超過 2000 筆整批不重算、Teable「success message while the cell content
   remained unchanged」、Airtable「unmatched values are dropped」、AG Grid 超量列
   「will not be pasted」。四家四種形態,全都不出聲。

   所以這一列的存在不是為了好看,是為了**把少做的事講出來**:
   跳過幾格、為什麼跳過、有幾列沒進去、哪幾格不合法。 */
export function PasteBanner({
  paste,
}: {
  readonly paste: ReturnType<typeof useGridPaste>
}): ReactNode {
  const { state } = paste

  if (state.error !== null) {
    return (
      <div className="flex items-center gap-2 border-b border-er-line bg-er-t px-4 py-1.5 text-[14px] text-er">
        <span className="min-w-0 flex-1">{state.error}</span>
        <Button onClick={paste.cancel}>知道了</Button>
      </div>
    )
  }

  if (state.invalid.length > 0) {
    /* 只列前三筆 —— 貼一整塊時可能有數十格不合法,全列會把畫面淹掉。
       但**總數要講**,否則使用者以為只有三格有問題。 */
    return (
      <div className="border-b border-er-line bg-er-t px-4 py-1.5 text-[14px] text-er">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            有 {state.invalid.length} 格無法貼上,已整批取消(標紅處)。修正來源資料後再試。
          </span>
          <Button onClick={paste.cancel}>知道了</Button>
        </div>
        <ul className="mt-0.5 pl-1 text-[12px]">
          {state.invalid.slice(0, 3).map((c) => (
            <li key={`${String(c.row)}:${String(c.col)}`}>
              第 {c.row + 1} 列:{c.message}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (state.pendingNewRows > 0) {
    /* 加列是**改變資料形狀**不是改值 —— Airtable 也要按 Continue(OQ-GP-3=C)。
       確認框天然是講「將新增 N 列」的位置。 */
    return (
      <div className="flex items-center gap-2 border-b border-wn-line bg-wn-t px-4 py-1.5 text-[14px] text-wn">
        <span className="min-w-0 flex-1">
          貼上的資料超出現有 {state.pendingNewRows} 列。要一併新增這些列嗎?
        </span>
        <Button onClick={paste.confirmAddRows}>新增並貼上</Button>
        <Button onClick={paste.pasteExistingOnly}>只貼既有列</Button>
      </div>
    )
  }

  if (state.notes.length > 0 || state.canUndo) {
    return (
      <div className="flex items-center gap-2 border-b border-line bg-head px-4 py-1.5 text-[12px] text-ink-2">
        <span className="min-w-0 flex-1">
          {state.notes.length > 0 ? `已貼上。${state.notes.join(";")}` : "已貼上。"}
        </span>
        {/* M4 一步 undo:使用者按的是**一個**動作,還原也該是一個 */}
        {state.canUndo ? <Button onClick={paste.undo}>復原這次貼上</Button> : null}
        <Button onClick={paste.cancel}>關閉</Button>
      </div>
    )
  }

  return null
}
