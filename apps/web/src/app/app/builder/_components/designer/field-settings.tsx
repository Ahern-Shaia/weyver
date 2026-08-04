"use client"

import { ConvertTypePanel } from "@/app/app/builder/_components/designer/convert-type"
import { OptionsEditorPanel } from "@/app/app/builder/_components/designer/options-editor"
import { RelookupPanel } from "@/app/app/builder/_components/designer/relookup"
import { describeEngineError, engineFetch } from "@/lib/engine/client"
import { DATE_FORMAT_LABEL, DATE_FORMATS } from "@/lib/engine/display-value"
import { useForm, useSaveLoadMap } from "@/lib/engine/hooks"
import {
  DEFAULT_VARIABLES,
  type DefaultValue,
  type FieldDto,
  type FieldLayout,
  type StaticElement,
} from "@/lib/engine/schemas"
import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Trash2, X } from "lucide-react"
import { type ReactNode, useState } from "react"
import { z } from "zod"

/* R1·UP-3 M3 欄位設定面板(placeholder/help/readonly/hidden/colSpan/預設值)。編輯 layout 草稿;
   hidden 為排版層(≠權限 D4)。預設值變數對映 M1 後端 create-time 解析。 */
/* 🔴 WCAG 2.2 SC 2.5.7 拖曳替代(AA):所有用拖曳完成的功能,
   都必須能以**單一指標且不需拖曳**完成。鍵盤可操作(2.1.1)是另一條,不能互相取代 ——
   手部精細動作受限但使用滑鼠的人,兩者都需要。 */
function MoveButtons({
  layout,
  cols,
  onChange,
}: {
  readonly layout: FieldLayout
  readonly cols: number
  readonly onChange: (patch: Partial<FieldLayout>) => void
}): ReactNode {
  const span = layout.colSpan ?? 6
  const move = (dCol: number, dRow: number): void =>
    onChange({
      col: Math.max(0, Math.min(cols - span, layout.col + dCol)),
      row: Math.max(0, layout.row + dRow),
    })
  const atLeft = layout.col <= 0
  const atRight = layout.col >= cols - span
  const atTop = layout.row <= 0

  return (
    <div className="flex flex-col gap-1">
      <span className="text-ink-3">
        位置(第 {layout.row + 1} 列、第 {layout.col + 1} 欄)
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => move(-1, 0)}
          disabled={atLeft}
          aria-label="左移一欄"
          className="flex size-7 items-center justify-center rounded-xs text-ink-3 hover:text-primary disabled:opacity-40 hover:bg-hover"
        >
          <ChevronLeft size={13} />
        </button>
        <button
          type="button"
          onClick={() => move(0, -1)}
          disabled={atTop}
          aria-label="上移一列"
          className="flex size-7 items-center justify-center rounded-xs text-ink-3 hover:text-primary disabled:opacity-40 hover:bg-hover"
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          onClick={() => move(0, 1)}
          aria-label="下移一列"
          className="flex size-7 items-center justify-center rounded-xs text-ink-3 hover:text-primary hover:bg-hover"
        >
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          onClick={() => move(1, 0)}
          disabled={atRight}
          aria-label="右移一欄"
          className="flex size-7 items-center justify-center rounded-xs text-ink-3 hover:text-primary disabled:opacity-40 hover:bg-hover"
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}

export function FieldSettingsPanel({
  field,
  formId,
  cols,
  layout,
  onChange,
  onClose,
  onOptionsSaved,
}: {
  readonly field: FieldDto
  readonly formId: number
  readonly cols: number
  readonly layout: FieldLayout
  readonly onChange: (patch: Partial<FieldLayout>) => void
  readonly onClose: () => void
  readonly onOptionsSaved: () => void
}): ReactNode {
  /* 🔴 選項編輯只在此(#105)。layout 那些是**草稿**、隨畫布一起存;
     選項會改寫**既有記錄的資料**,所以是自己送出、自己確認,兩者不混。 */
  const choices = (field.options as { choices?: { id: string; name: string }[] } | undefined)
    ?.choices
  const dv = layout.defaultValue
  const dvKind = dv?.kind ?? "none"

  const setDvKind = (kind: string): void => {
    if (kind === "none") return onChange({ defaultValue: undefined })
    if (kind === "literal") return onChange({ defaultValue: { kind: "literal", value: "" } })
    if (kind === "formula") return onChange({ defaultValue: { kind: "formula", value: "" } })
    onChange({ defaultValue: { kind: "variable", value: "$DATE" } })
  }
  const setDvValue = (value: string): void => {
    if (dv === undefined) return
    onChange({ defaultValue: { ...dv, value } as DefaultValue })
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-l border-line bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="truncate text-[12px] font-semibold text-ink">{field.name}</span>
        <span className="font-mono text-[12px] text-ink-3">設定</span>
        <button type="button" onClick={onClose} className="ml-auto text-ink-3 hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3 text-[12px]">
          {/* 🔴 OQ-IS-8=A′:簽名欄的能力邊界要讓**設計這張表的人**先知道 ——
              他決定要不要拿它當驗收簽核用,而那個決定發生在這裡不是填單時。
              次要文字級、不加警示色(見 signature-input.tsx 同條註解)。 */}
          {field.type === "signature" ? (
            <p className="border-line-2 border-l-2 pl-2 text-ink-3">
              本欄儲存手寫簽名圖片,不含數位憑證。需具法律推定效力之簽署請改用合規電子簽章(尚未提供)。
            </p>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">提示文字(placeholder)</span>
            <Input
              className="h-7"
              value={layout.placeholder ?? ""}
              onChange={(e) => onChange({ placeholder: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">欄位說明（? 圖示)</span>
            <Input
              className="h-7"
              value={layout.help ?? ""}
              onChange={(e) => onChange({ help: e.target.value || undefined })}
            />
          </label>
          <MoveButtons layout={layout} cols={cols} onChange={onChange} />
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">跨欄數(colSpan)</span>
            <Input
              className="h-7 w-20"
              type="number"
              min={1}
              max={12}
              value={layout.colSpan ?? 6}
              onChange={(e) =>
                onChange({ colSpan: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })
              }
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={layout.readonly ?? false}
              onChange={(e) => onChange({ readonly: e.target.checked || undefined })}
              className="accent-(--color-primary)"
            />
            {/* 與「隱藏」同一條誠實標示:排版層的可用性約束,擋不住 API。
                真正的欄位級權限在 E-1(後端 assertWritable)。 */}
            <span className="text-ink-2">唯讀(排版層,非權限)</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={layout.hidden ?? false}
              onChange={(e) => onChange({ hidden: e.target.checked || undefined })}
              className="accent-(--color-primary)"
            />
            <span className="text-ink-2">隱藏（排版層,非權限)</span>
          </label>

          <div className="border-t border-line-2 pt-2.5">
            <div className="mb-1 text-ink-3">預設值</div>
            <Select
              className="h-7 w-full"
              value={dvKind}
              onChange={(e) => setDvKind(e.target.value)}
            >
              <option value="none">無</option>
              <option value="literal">固定文字</option>
              <option value="variable">變數</option>
              <option value="formula">公式（P1,暫不套)</option>
            </Select>
            {dv?.kind === "literal" ? (
              <Input
                className="mt-1.5 h-7"
                value={dv.value}
                onChange={(e) => setDvValue(e.target.value)}
                placeholder="固定預設值"
              />
            ) : null}
            {dv?.kind === "variable" ? (
              <Select
                className="mt-1.5 h-7 w-full"
                value={dv.value}
                onChange={(e) => setDvValue(e.target.value)}
              >
                {DEFAULT_VARIABLES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            ) : null}
            {dv?.kind === "formula" ? (
              <Input
                className="mt-1.5 h-7 font-mono"
                value={dv.value}
                onChange={(e) => setDvValue(e.target.value)}
                placeholder="公式(P1)"
              />
            ) : null}
          </div>
        </div>
      </div>
      <ConvertTypePanel
        formId={formId}
        fieldId={field.id}
        currentType={field.type}
        onConverted={onOptionsSaved}
      />

      {field.type === "lookup" &&
      (field.options as { syncMode?: string }).syncMode === "snapshot" ? (
        <RelookupPanel formId={formId} fieldId={field.id} onDone={onOptionsSaved} />
      ) : null}

      {field.type === "link" ? (
        <LoadMapPanel formId={formId} field={field} onSaved={onOptionsSaved} />
      ) : null}

      {field.type === "date" || field.type === "dateTime" ? (
        <DateFormatPanel formId={formId} field={field} onSaved={onOptionsSaved} />
      ) : null}

      {field.type === "text" ? (
        <BarcodePanel formId={formId} field={field} onSaved={onOptionsSaved} />
      ) : null}

      {choices !== undefined ? (
        <OptionsEditorPanel
          formId={formId}
          fieldId={field.id}
          fieldName={field.name}
          initial={choices}
          onSaved={onOptionsSaved}
        />
      ) : null}
    </div>
  )
}

/* 靜態元素設定(文字/圖片;text=Markdown+href、image=imageUrl;designOnly=僅設計模式可見) */
export function StaticSettingsPanel({
  element,
  onChange,
  onDelete,
  onClose,
}: {
  readonly element: StaticElement
  readonly onChange: (patch: Partial<StaticElement>) => void
  readonly onDelete: () => void
  readonly onClose: () => void
}): ReactNode {
  return (
    <div className="flex w-64 shrink-0 flex-col border-l border-line bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[12px] font-semibold text-ink">
          {element.kind === "text" ? "文字元素" : "圖片元素"}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto text-ink-3 hover:text-er"
          aria-label="刪除元素"
        >
          <Trash2 size={13} />
        </button>
        <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 text-[12px]">
        {element.kind === "text" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-ink-3">文字內容</span>
              <textarea
                value={element.text ?? ""}
                onChange={(e) => onChange({ text: e.target.value })}
                rows={4}
                className="rounded-xs border border-line bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-primary"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={element.markdown ?? false}
                onChange={(e) => onChange({ markdown: e.target.checked || undefined })}
                className="accent-(--color-primary)"
              />
              <span className="text-ink-2">Markdown</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-3">超連結（https/相對)</span>
              <Input
                className="h-7"
                value={element.href ?? ""}
                onChange={(e) => onChange({ href: e.target.value || undefined })}
                placeholder="https://…"
              />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">圖片網址(https/相對)</span>
            <Input
              className="h-7"
              value={element.imageUrl ?? ""}
              onChange={(e) => onChange({ imageUrl: e.target.value || undefined })}
              placeholder="https://…/logo.png"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-ink-3">跨欄數(colSpan)</span>
          <Input
            className="h-7 w-20"
            type="number"
            min={1}
            max={12}
            value={element.colSpan ?? 4}
            onChange={(e) =>
              onChange({ colSpan: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })
            }
          />
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={element.designOnly ?? false}
            onChange={(e) => onChange({ designOnly: e.target.checked || undefined })}
            className="accent-(--color-primary)"
          />
          <span className="text-ink-2">僅設計模式可見</span>
        </label>
      </div>
    </div>
  )
}

/* 🔴 R1·FMT M2|日期顯示格式。**這是設計者指定格式的唯一入口** ——
   在此之前格式由環境決定:瀏覽器語系(原生輸入控件)或租戶 `locale`(顯示層),
   兩者設計者都碰不到,而 `en` 是設定白名單裡的合法值。

   一手依據:Ragic 把格式放在「設計模式 › 欄位設定 › 基本」;
   Airtable 放在欄位的「Date format」(選項 Local / Friendly / US / European / ISO)。
   **兩家都把格式當成欄位的屬性**,不是環境的屬性。

   ⚠️ 自己送出、自己確認 —— 與 layout 草稿分開。理由與選項編輯同:
   layout 是草稿會隨畫布一起存,而這一項存下去**所有人**看到的都變。 */
/* 🔴 audit-D §2.3|`showAsQr` 在 registry 與渲染端都存在了,**卻沒有任何寫入處**
   —— 只能打 API 設,而第一約束逐字說「有 API 可以做」不算解決。
   這一格就是那個缺的寫入端。 */
function BarcodePanel({
  formId,
  field,
  onSaved,
}: {
  readonly formId: number
  readonly field: FieldDto
  readonly onSaved: () => void
}): ReactNode {
  const on = (field.options as { showAsQr?: unknown }).showAsQr === true
  const rawMask = (field.options as { displayMask?: unknown }).displayMask
  const mask = typeof rawMask === "string" ? rawMask : ""
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (body: { showAsQr?: boolean; displayMask?: string }): void => {
    setBusy(true)
    setError(null)
    void engineFetch(`/forms/${String(formId)}/fields/${String(field.id)}/display`, z.unknown(), {
      method: "PATCH",
      body,
    })
      .then(() => onSaved())
      .catch((e: unknown) => setError(describeEngineError(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="border-t border-line p-3 text-[12px]">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => save({ showAsQr: e.target.checked })}
        />
        以條碼 / QR 呈現
      </label>
      {/* 值本身不變 —— 這是顯示層,不是型別 */}
      <p className="mt-1 text-ink-3">值仍是文字;列印與記錄頁改以圖形呈現。</p>

      {/* 🔴 audit-D §2.4|格式遮罩同樣是「有 schema 沒入口」。`#` 代表值的下一個字元。 */}
      <div className="mt-2.5">
        <label className="mb-1 block text-ink-3" htmlFor={`mask-${String(field.id)}`}>
          格式遮罩
        </label>
        <Input
          id={`mask-${String(field.id)}`}
          className="h-7"
          defaultValue={mask}
          placeholder="例:###-##-####"
          maxLength={60}
          disabled={busy}
          onBlur={(e) => {
            if (e.target.value !== mask) save({ displayMask: e.target.value })
          }}
        />
        <p className="mt-1 text-ink-3">`#` 代表一個字元;**儲存的仍是原值**,只改呈現。</p>
      </div>
      {error !== null ? <p className="mt-1 text-er">{error}</p> : null}
    </div>
  )
}

function DateFormatPanel({
  formId,
  field,
  onSaved,
}: {
  readonly formId: number
  readonly field: FieldDto
  readonly onSaved: () => void
}): ReactNode {
  const current = (field.options as { dateFormat?: unknown }).dateFormat
  const value = typeof current === "string" ? current : "local"
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (next: string): void => {
    setBusy(true)
    setError(null)
    void engineFetch(`/forms/${String(formId)}/fields/${String(field.id)}/display`, z.unknown(), {
      method: "PATCH",
      body: { dateFormat: next },
    })
      .then(() => onSaved())
      .catch((e: unknown) => setError(describeEngineError(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="border-t border-line p-3 text-[12px]">
      <div className="mb-1 text-ink-3">日期顯示格式</div>
      <Select
        className="h-7 w-full"
        aria-label="日期顯示格式"
        value={value}
        disabled={busy}
        onChange={(e) => save(e.target.value)}
      >
        {DATE_FORMATS.map((k) => (
          <option key={k} value={k}>
            {DATE_FORMAT_LABEL[k]}
          </option>
        ))}
      </Select>
      {/* 「依語系」不是壞選項,但它的後果要講清楚 —— 否則設計者不知道自己交出了什麼 */}
      <p className="mt-1 text-ink-3">
        {value === "local"
          ? "依每位使用者的語系設定顯示,不同語系的人看到的寫法會不同。"
          : "所有人看到的寫法一致,不受各自的語系設定影響。"}
      </p>
      {error === null ? null : <p className="mt-1 text-er">{error}</p>}
    </div>
  )
}

/* 🔴 R1·LNK M2|Load 帶入的對映設定。**這是設計者指定帶入哪些欄的唯一入口** ——
   在此之前只能打 API,而第一約束逐字「有 API 可以做不算解決」。

   Ragic 的形態是「連連看」(`doc/14`:右邊選來源表單,左邊拉對應)。
   我方用**成對的下拉**:同樣是「來源欄 → 本地欄」,但不需要拖曳,
   鍵盤可達、窄螢幕也能用。⚠️ 這是**刻意的差異**不是簡化 ——
   連連看的價值在一次看到全貌,而我們的欄位清單本來就在同一畫面上。

   對映以 **field id** 存(穩定於改名,同 `formula_def.depends_on`)。 */
function LoadMapPanel({
  formId,
  field,
  onSaved,
}: {
  readonly formId: number
  readonly field: FieldDto
  readonly onSaved: () => void
}): ReactNode {
  const targetFormId = (field.options as { targetFormId?: number }).targetFormId ?? null
  const stored = (field.options as { loadMap?: { fromFieldId: number; toFieldId: number }[] })
    .loadMap
  const [rows, setRows] = useState<{ fromFieldId: number; toFieldId: number }[]>(stored ?? [])
  const [error, setError] = useState<string | null>(null)
  const target = useForm(targetFormId)
  const self = useForm(formId)
  const save = useSaveLoadMap(formId, field.id)

  if (targetFormId === null) return null
  const sourceFields = target.data?.fields ?? []
  /* 可當帶入目標的:排除連結欄自己(帶進來會蓋掉剛選的那筆)與計算欄(值由引擎產生) */
  const localFields = (self.data?.fields ?? []).filter(
    (f) => f.id !== field.id && f.type !== "formula" && f.type !== "autoNumber",
  )

  return (
    <div className="border-t border-line p-3 text-[12px]">
      <div className="mb-1 text-ink-3">選這筆記錄時要帶入哪些欄</div>
      {rows.map((row, i) => (
        <div
          key={`${String(row.fromFieldId)}-${String(i)}`}
          className="mb-1 flex items-center gap-1"
        >
          <Select
            className="h-7 min-w-0 flex-1"
            aria-label={`帶入來源欄 ${String(i + 1)}`}
            value={String(row.fromFieldId)}
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r, j) => (j === i ? { ...r, fromFieldId: Number(e.target.value) } : r)),
              )
            }
          >
            <option value="0">選來源欄</option>
            {sourceFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <span className="shrink-0 text-ink-3">→</span>
          <Select
            className="h-7 min-w-0 flex-1"
            aria-label={`帶入目標欄 ${String(i + 1)}`}
            value={String(row.toFieldId)}
            onChange={(e) =>
              setRows((prev) =>
                prev.map((r, j) => (j === i ? { ...r, toFieldId: Number(e.target.value) } : r)),
              )
            }
          >
            <option value="0">選本表欄位</option>
            {localFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <Button onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>移除</Button>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1">
        <Button onClick={() => setRows((prev) => [...prev, { fromFieldId: 0, toFieldId: 0 }])}>
          ＋ 一組
        </Button>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            setError(null)
            /* 未選完的整組不送 —— 送 0 會被後端擋,但先在這裡濾掉比較不吵 */
            const clean = rows.filter((r) => r.fromFieldId > 0 && r.toFieldId > 0)
            save.mutate(clean, {
              onSuccess: () => onSaved(),
              onError: (e) => setError(describeEngineError(e)),
            })
          }}
        >
          儲存對映
        </Button>
      </div>
      {/* 快照語意要講出來 —— 使用者會預期「來源改了這裡也會變」,而 Ragic 的行為相反,
          且它的理由很好:訂單上要顯示的是下單當時的地址,不是客戶後來搬家的新地址。 */}
      <p className="mt-1 text-ink-3">
        帶入的是**選取當下**的值,存檔後不會跟著來源異動。要即時反映請改用帶入欄(lookup)。
      </p>
      {error === null ? null : <p className="mt-1 text-er">{error}</p>}
    </div>
  )
}
