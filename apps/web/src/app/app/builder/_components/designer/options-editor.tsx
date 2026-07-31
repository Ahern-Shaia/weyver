"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { CHIP_TONES, type ChipTone, StatusChip } from "@weyver/ui/status-chip"
import { AlertTriangle, Plus, RotateCcw, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { z } from "zod"
import { describeEngineError, engineFetch } from "@/lib/engine/client"

/* 🔴 選項編輯(#105)。**這是唯一該用來改選項的入口** ——
   `/fields/:id/type` 只換 metadata 不動資料,拿它改選項會製造孤兒值,後端已擋。

   兩個業界教訓直接體現在此:
   - 刪除**顯示「N 筆記錄使用中」**並強制三選一。查證過的系統(Airtable /
     Baserow / NocoDB / Teable / Notion)沒有一家顯示筆數;Airtable 更是靜默清空。
   - 停用的選項**仍列在清單裡**(灰底 + 可還原)。Salesforce 的停用值會靜默從
     report bucket 掉出且重新啟用後不會回來 —— 那是要避開的。 */

const TONE_LABEL: Partial<Record<ChipTone, string>> = {
  ok: "完成",
  warn: "待辦",
  error: "異常",
  neutral: "中性",
}
const AUTO_TONES: readonly ChipTone[] = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]

const choiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
  retired: z.boolean().optional(),
})
type Choice = z.infer<typeof choiceSchema>

type DeleteMode = "retire" | "replace" | "clear"

function mintId(): string {
  return `o${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`
}

export function OptionsEditorPanel({
  formId,
  fieldId,
  fieldName,
  initial,
  onSaved,
}: {
  readonly formId: number
  readonly fieldId: number
  readonly fieldName: string
  readonly initial: readonly Choice[]
  readonly onSaved: () => void
}): ReactNode {
  const [rows, setRows] = useState<Choice[]>([...initial])

  /* 🔴 存檔後要用後端回來的清單重新同步(瀏覽器實走時發現)。
     不同步的話,停用的選項在面板上會**消失** —— 使用者看不到也無法重新啟用,
     正是 Salesforce 停用值「掉出去就回不來」那個要避開的失效模式。 */
  const signature = JSON.stringify(initial)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 以序列化簽章為依據,initial 每次 render 都是新陣列
  useEffect(() => {
    setRows([...initial])
  }, [signature])
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [removing, setRemoving] = useState<Choice | null>(null)
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("retire")
  const [replaceWith, setReplaceWith] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* 🔴 使用量以 **option id** 為 key。以名稱為 key 時,使用者一改名就查不到筆數,
     「N 筆使用中」的保護會靜默消失(瀏覽器實走時發現)。
     存檔後要重抓 —— 取代 / 清空都會改變筆數。 */
  const [usageTick, setUsageTick] = useState(0)
  useEffect(() => {
    void engineFetch(
      `/forms/${formId}/fields/${fieldId}/options/usage`,
      z.record(z.string(), z.number()),
    )
      .then(setUsage)
      .catch(() => setUsage({}))
  }, [formId, fieldId, usageTick])

  const patch = (id: string, next: Partial<Choice>): void =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)))

  /* 兩條送出路徑(直接儲存 / 刪除確認)共用同一段 payload —— 各組一份必然漂移 */
  const submit = async (
    choices: readonly Choice[],
    mode: DeleteMode,
    target?: string,
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await engineFetch(`/forms/${formId}/fields/${fieldId}/options`, z.unknown(), {
        method: "PATCH",
        body: {
          choices: choices.map((r) => ({
            id: r.id,
            name: r.name.trim(),
            ...(r.color === undefined ? {} : { color: r.color }),
            ...(r.retired === true ? { retired: true } : {}),
          })),
          deleteMode: mode,
          ...(target === undefined ? {} : { replaceWith: target }),
        },
      })
      setRemoving(null)
      setUsageTick((n) => n + 1)
      onSaved()
    } catch (e) {
      setError(describeEngineError(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  /* 移除:有人在用就先問清楚要怎麼處理,不默默決定 */
  const requestRemove = (row: Choice): void => {
    if ((usage[row.id] ?? 0) === 0) {
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      return
    }
    setRemoving(row)
    setDeleteMode("retire")
    setReplaceWith("")
  }

  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return
    const next = rows.filter((r) => r.id !== removing.id)
    const before = rows
    setRows(next)
    try {
      await submit(next, deleteMode, deleteMode === "replace" ? replaceWith : undefined)
    } catch {
      setRows(before) // 失敗還原本地狀態,免得畫面與後端不一致
    }
  }

  const active = rows.filter((r) => r.retired !== true)

  return (
    <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-ink-3">選項</span>
        <span className="text-[12px] text-ink-3">({fieldName})</span>
      </div>

      {error !== null ? (
        <div className="border border-er/40 bg-er/5 px-2 py-1 text-[14px] text-er">{error}</div>
      ) : null}

      {rows.map((row) => {
        const used = usage[row.id] ?? 0
        const retired = row.retired === true
        return (
          <div key={row.id} className="flex items-center gap-1.5">
            <Input
              className={`h-7 flex-1 ${retired ? "text-ink-3" : ""}`}
              value={row.name}
              onChange={(e) => patch(row.id, { name: e.target.value })}
              aria-label={`選項 ${row.name} 名稱`}
              disabled={retired}
            />
            <Select
              value={row.color ?? "c1"}
              onChange={(e) => patch(row.id, { color: e.target.value })}
              className="h-7 w-20"
              aria-label={`選項 ${row.name} 顏色`}
            >
              {CHIP_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {TONE_LABEL[tone] ?? tone}
                </option>
              ))}
            </Select>
            <StatusChip tone={(row.color ?? "c1") as ChipTone}>
              {row.name.trim() === "" ? "預覽" : row.name}
            </StatusChip>
            <span className="w-14 shrink-0 text-right text-[12px] text-ink-3">
              {used > 0 ? `${used} 筆` : ""}
            </span>
            {retired ? (
              /* 停用值仍留在清單裡且可還原 —— Salesforce 的停用值會靜默從
                 report bucket 掉出且啟用後不回來,那是要避開的 */
              <button
                type="button"
                onClick={() => patch(row.id, { retired: false })}
                aria-label={`重新啟用 ${row.name}`}
                className="text-ink-3 hover:text-primary"
                title="重新啟用"
              >
                <RotateCcw size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => requestRemove(row)}
                aria-label={`移除選項 ${row.name}`}
                className="text-ink-3 hover:text-er"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={() =>
          setRows((prev) => [
            ...prev,
            {
              id: mintId(),
              name: "",
              color: AUTO_TONES[prev.length % AUTO_TONES.length] ?? "c1",
            },
          ])
        }
        className="flex w-fit items-center gap-1 text-[12px] text-primary hover:underline"
      >
        <Plus size={12} />
        加選項
      </button>

      <Button variant="primary" onClick={() => void submit(rows, "retire").catch(() => undefined)} disabled={busy} className="w-fit">
        {busy ? "儲存中…" : "儲存選項"}
      </Button>

      {/* 刪除仍被使用的選項 —— 強制三選一,不默默決定 */}
      {removing !== null ? (
        <div className="space-y-2 border border-warn/40 bg-warn/5 px-2.5 py-2">
          <div className="flex items-start gap-1.5 text-[12px] text-ink">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
            <span>
              「{removing.name}」有 <b>{usage[removing.id] ?? 0}</b> 筆記錄正在使用。
            </span>
          </div>
          <div className="flex flex-col gap-1 text-[12px] text-ink-2">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={deleteMode === "retire"}
                onChange={() => setDeleteMode("retire")}
                className="accent-(--color-primary)"
              />
              停用(建議)—— 既有記錄保留原值,新記錄不可選
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={deleteMode === "replace"}
                onChange={() => setDeleteMode("replace")}
                className="accent-(--color-primary)"
              />
              改成其他選項
            </label>
            {deleteMode === "replace" ? (
              <Select
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
                className="ml-5 h-7 w-40"
                aria-label="取代成"
              >
                <option value="">請選擇</option>
                {active
                  .filter((r) => r.id !== removing.id)
                  .map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            ) : null}
            <label className="flex items-center gap-1.5 text-er">
              <input
                type="radio"
                checked={deleteMode === "clear"}
                onChange={() => setDeleteMode("clear")}
                className="accent-(--color-primary)"
              />
              清空這些記錄的該欄位(不可還原)
            </label>
          </div>
          <div className="flex gap-1.5">
            <Button onClick={() => setRemoving(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => void confirmRemove()}
              disabled={busy || (deleteMode === "replace" && replaceWith === "")}
            >
              確認
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
