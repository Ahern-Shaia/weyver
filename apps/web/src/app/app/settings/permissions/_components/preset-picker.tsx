"use client"
import { PERMISSION_PRESETS } from "@/lib/engine/permission-presets"
import { Select } from "@weyver/ui/select"
import type { ReactNode } from "react"

/* 🔴 authz 0-bis 項 7 的主控件。**「自訂」不是一個可選項,是一個狀態** ——
   使用者逐格勾出來的組合若不等於任何具名預設,這裡就顯示「自訂」,
   而他不能主動「選」自訂(選了要做什麼?)。

   刻意**不做**「最接近的預設」模糊比對:把「檢視者 + 匯出」講成「檢視者」
   是謊報權限,而權限畫面謊報一次,客戶就不會再信任它顯示的任何一格。

   ⚠️ 也**不放「無權限」選項**:後端的空集語意是「刪覆寫 → 還原繼承」,
   不是「拒絕」。標成「無權限」會靜默做另一件事,而「還原繼承」已有獨立按鈕。 */
export function PresetPicker({
  value,
  empty,
  disabled,
  onPick,
}: {
  readonly value: string | null
  /* 一格都沒開 —— 顯示「未設定」而非「自訂」。**沒設過不是自訂過**,
     而權限畫面的每一個字都會被當成事實陳述。 */
  readonly empty: boolean
  readonly disabled: boolean
  readonly onPick: (key: string) => void
}): ReactNode {
  return (
    <Select
      className="ml-2 h-6 w-24 align-middle text-[12px]"
      aria-label="權限預設"
      value={value ?? "__custom__"}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value !== "__custom__") onPick(e.target.value)
      }}
    >
      {value === null ? <option value="__custom__">{empty ? "未設定" : "自訂"}</option> : null}
      {PERMISSION_PRESETS.map((p) => (
        <option key={p.key} value={p.key}>
          {p.name}
        </option>
      ))}
    </Select>
  )
}
