"use client"

import { Play } from "lucide-react"
import { type ReactNode, useState } from "react"

import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"

import {
  type ConditionRow,
  ConditionRows,
} from "@/app/app/builder/_components/designer/condition-rows"
import { ScheduleFields } from "@/app/app/builder/_components/designer/schedule-fields"
import { TriggerList } from "@/app/app/builder/_components/designer/trigger-list"
import { TriggerRuns } from "@/app/app/builder/_components/designer/trigger-runs"
import { describeEngineError } from "@/lib/engine/client"
import {
  useCreateTrigger,
  useDeleteTrigger,
  useForms,
  usePublishTrigger,
  useTriggerDryRun,
  useTriggerRuns,
  useTriggers,
  useUpdateTrigger,
} from "@/lib/engine/hooks"
import type { FormDto } from "@/lib/engine/schemas"

/* 🔴 R1·C-4 M4|事件觸發器的設計器入口。

   沒有這一頁的話,觸發器就是「只能打 API 設」—— 而第一約束逐字說
   「有 API 可以做」不算解決。同一個錯誤在文字遮罩上剛犯過一次(#51)。

   ## 條件用共用元件

   `ConditionRows` 與條件式格式共用。同一個「金額 > 10000」不該有兩種設法,
   而伺服器端本來就已經共用同一支求值器。

   ## 🔴 試跑不是便利功能

   同步觸發器算不出來時**會擋住存檔**,所以設計者必須能在不弄壞一張表的
   前提下驗證自己設的規則。沒有試跑,試錯的成本是「整張表存不了,而且不知道為什麼」。 */

export function TriggersPanel({
  formId,
  form,
}: {
  readonly formId: number
  readonly form: FormDto
}): ReactNode {
  const { data: triggers = [] } = useTriggers(formId)
  const { data: runs = [] } = useTriggerRuns(formId)
  const create = useCreateTrigger(formId)
  const update = useUpdateTrigger(formId)
  const remove = useDeleteTrigger(formId)
  const publish = usePublishTrigger(formId)
  const dryRun = useTriggerDryRun(formId)

  const [name, setName] = useState("")
  const [onCreate, setOnCreate] = useState(true)
  const [onUpdate, setOnUpdate] = useState(false)
  const [onSchedule, setOnSchedule] = useState(false)
  const [freq, setFreq] = useState<"daily" | "weekly" | "monthly">("daily")
  const [hour, setHour] = useState(8)
  const [schedDay, setSchedDay] = useState(1)
  const [watchField, setWatchField] = useState("")
  const [conditions, setConditions] = useState<ConditionRow[]>([])
  const [actionType, setActionType] = useState<"updateSelf" | "pushTo">("updateSelf")
  const [targetField, setTargetField] = useState("")
  const [literal, setLiteral] = useState("")
  const [targetFormId, setTargetFormId] = useState("")
  const [sourceField, setSourceField] = useState("")
  const [mapTo, setMapTo] = useState("")
  const { data: forms } = useForms()
  const [msg, setMsg] = useState<string | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)

  /* 系統欄與唯讀計算欄不能當目標 —— 讓它出現在下拉裡只會產生存檔時才報的錯 */
  const writable = form.fields.filter(
    (f) =>
      !["formula", "rollup", "lookup", "autoNumber", "createdAt", "updatedAt"].includes(f.type),
  )
  const fieldNames = form.fields.map((f) => f.name)

  const submit = (): void => {
    setMsg(null)
    if (name.trim() === "") {
      setMsg("要填名稱")
      return
    }
    if (onSchedule && actionType !== "updateSelf") {
      setMsg("定時觸發目前只支援「更新本筆欄位」")
      return
    }
    if (actionType === "updateSelf" && targetField === "") {
      setMsg("要選一個要設定的欄位")
      return
    }
    if (actionType === "pushTo" && targetFormId === "") {
      setMsg("要選一張目標表單")
      return
    }
    create.mutate(
      {
        name: name.trim(),
        onCreate,
        onUpdate,
        watchFields: watchField === "" ? [] : [watchField],
        conditions: conditions.map((c) => ({ field: c.field, op: c.op, value: c.value })),
        ...(onSchedule
          ? {
              schedule: {
                freq,
                hour,
                ...(freq === "daily" ? {} : { day: schedDay }),
              },
            }
          : {}),
        config:
          actionType === "updateSelf"
            ? {
                actionType: "updateSelf",
                setFields: { [targetField]: { from: "literal", value: literal } },
              }
            : {
                actionType: "pushTo",
                targetFormId: Number(targetFormId),
                fieldMap:
                  mapTo === "" || sourceField === ""
                    ? {}
                    : { [mapTo]: { from: "field", field: sourceField } },
              },
      },
      {
        onSuccess: () => {
          setName("")
          setLiteral("")
          setConditions([])
          setMsg(null)
        },
        onError: (e: unknown) => setMsg(describeEngineError(e)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3 text-[12px]">
      <p className="text-ink-3">
        資料建立或更新時<span className="font-semibold text-ink-2">自動</span>執行,
        不必有人記得按按鈕。設定會在存檔當下生效。
      </p>

      <TriggerList
        triggers={triggers}
        busy={publish.isPending}
        onPublish={(triggerId, discard) =>
          publish.mutate({ triggerId, ...(discard === true ? { discard } : {}) })
        }
        onToggle={(triggerId, enabled) => update.mutate({ triggerId, enabled })}
        onRemove={(triggerId) => remove.mutate(triggerId)}
      />

      <div className="flex flex-col gap-2 border-t border-line-2 pt-2.5">
        <span className="text-ink-3">新增觸發器</span>
        <Input
          className="h-7"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例:大額轉待審"
          aria-label="觸發器名稱"
        />

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-ink-2">
            <input
              type="checkbox"
              checked={onCreate}
              className="accent-(--color-primary)"
              onChange={(e) => setOnCreate(e.target.checked)}
            />
            建立時
          </label>
          <label className="flex items-center gap-1.5 text-ink-2">
            <input
              type="checkbox"
              checked={onUpdate}
              className="accent-(--color-primary)"
              onChange={(e) => setOnUpdate(e.target.checked)}
            />
            更新時
          </label>
          {/* 🔴 R1·C-5|第三種時機。**與前兩者可並存** —— 「建立時標記 + 每天重掃一次」
              是合理的組合(補上建立當下條件還不成立、後來才成立的那些)。 */}
          <label className="flex items-center gap-1.5 text-ink-2">
            <input
              type="checkbox"
              checked={onSchedule}
              className="accent-(--color-primary)"
              aria-label="定時"
              onChange={(e) => {
                setOnSchedule(e.target.checked)
                /* 定時只支援更新本筆。**切過去的當下就把動作換掉**,
                   而不是讓人設完才被伺服器擋 —— 那時他已經填了一半的目標表單。 */
                if (e.target.checked) setActionType("updateSelf")
              }}
            />
            定時
          </label>
        </div>

        {onSchedule ? (
          <ScheduleFields
            freq={freq}
            hour={hour}
            day={schedDay}
            onFreq={setFreq}
            onHour={setHour}
            onDay={setSchedDay}
          />
        ) : null}

        {/* 🔴 只在「更新時」出現。建立時沒有前值可比,給了只會讓人以為它有作用。 */}
        {onUpdate ? (
          <>
            <div className="text-ink-3">只在這一欄變更時觸發(不選 = 任何更新)</div>
            <Select
              className="h-7"
              value={watchField}
              onChange={(e) => setWatchField(e.target.value)}
              aria-label="監看欄位"
            >
              <option value="">任何更新</option>
              {fieldNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        <div className="text-ink-3">條件(全部符合才執行;不設 = 一律執行)</div>
        <ConditionRows
          conditions={conditions}
          fieldNames={fieldNames}
          fieldTypeOf={(n) => form.fields.find((f) => f.name === n)?.type}
          onChange={setConditions}
          min={0}
        />

        <div className="text-ink-3">要做什麼</div>
        <Select
          className="h-7"
          value={actionType}
          onChange={(e) => setActionType(e.target.value as "updateSelf" | "pushTo")}
          aria-label="動作型別"
        >
          <option value="updateSelf">更新本筆欄位</option>
          {/* 🔴 定時 + `pushTo` 會被伺服器擋(掃一次全表可能建出上千筆,
              且跨到別張表 —— 量級與授權兩個問題疊在一起)。
              **選項直接不出現,並說明為什麼** —— 讓它出現然後報錯,
              使用者只會覺得系統壞了。 */}
          {onSchedule ? null : <option value="pushTo">在其他表單建一筆資料</option>}
        </Select>
        {onSchedule ? (
          <p className="text-ink-3">定時觸發只能更新本筆欄位,不能在其他表單建資料。</p>
        ) : null}

        {actionType === "updateSelf" ? (
          <div className="flex items-center gap-1.5">
            <Select
              className="h-7 flex-1"
              value={targetField}
              onChange={(e) => setTargetField(e.target.value)}
              aria-label="要設定的欄位"
            >
              <option value="">選欄位</option>
              {writable.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
            <span className="text-ink-3">設為</span>
            <Input
              className="h-7 flex-1"
              value={literal}
              onChange={(e) => setLiteral(e.target.value)}
              placeholder="值"
              aria-label="設定值"
            />
          </div>
        ) : (
          <>
            <Select
              className="h-7"
              value={targetFormId}
              onChange={(e) => setTargetFormId(e.target.value)}
              aria-label="目標表單"
            >
              <option value="">選表單</option>
              {(forms ?? [])
                .filter((f) => f.id !== formId)
                .map((f) => (
                  <option key={f.id} value={String(f.id)}>
                    {f.name}
                  </option>
                ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <Select
                className="h-7 flex-1"
                value={sourceField}
                onChange={(e) => setSourceField(e.target.value)}
                aria-label="來源欄位"
              >
                <option value="">本表欄位</option>
                {fieldNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
              <span className="text-ink-3">帶到</span>
              <Input
                className="h-7 flex-1"
                value={mapTo}
                onChange={(e) => setMapTo(e.target.value)}
                placeholder="目標欄位名"
                aria-label="目標欄位"
              />
            </div>
            {/* 🔴 兩件跟 `updateSelf` 完全不同、而設計者不會自己猜到的事。 */}
            <p className="text-ink-3">
              這個動作是<span className="font-semibold text-ink-2">存檔後才跑</span>(最多約一分鐘),
              而且是<span className="font-semibold text-ink-2">以觸發的人的權限</span>執行 ——
              他沒有目標表單的新增權時不會建,並會記在下方的執行紀錄裡。
            </p>
          </>
        )}

        {/* 🔴 講清楚後果。設計者多半不知道自己剛剛繞過了欄位權限。
            ⚠️ 只有 `updateSelf` 繞得過 —— `pushTo` 跨到別張表,仍以觸發者身分執行。 */}
        <p className={actionType === "updateSelf" ? "text-ink-3" : "hidden"}>
          觸發器設定的欄位會<span className="font-semibold text-ink-2">略過欄位權限</span> ——
          使用者不能改的欄位,它改得動。
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={create.isPending}
            className="h-7 flex-1 border border-primary bg-primary text-white disabled:opacity-50"
          >
            新增
          </button>
          <button
            type="button"
            aria-label="試跑"
            title="拿目前的設定空跑一次,不會寫入任何資料"
            disabled={dryRun.isPending}
            onClick={() => {
              setMsg(null)
              const sample: Record<string, unknown> = {}
              for (const f of form.fields) sample[f.name] = null
              dryRun.mutate(sample, {
                onSuccess: (r) => setPreview(r.values),
                onError: (e: unknown) => setMsg(describeEngineError(e)),
              })
            }}
            className="flex h-7 items-center gap-1 border border-line px-2 text-ink-2 hover:bg-head disabled:opacity-50"
          >
            <Play size={11} />
            試跑
          </button>
        </div>
        {msg === null ? null : <div className="text-er">{msg}</div>}
        {preview === null ? null : (
          <div className="border border-line bg-head p-2">
            <div className="mb-1 text-ink-3">試跑結果(空白記錄)</div>
            {Object.entries(preview).map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <span className="text-ink-3">{k}</span>
                <span className="text-ink">{v === null ? "—" : String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <TriggerRuns runs={runs} />
    </div>
  )
}
