"use client"

import { usePreviewActors } from "@/lib/engine/authz"
import { BarcodeView, fieldSymbology } from "@/lib/engine/barcode"
import { isStubType } from "@/lib/engine/field-types"
import type { FieldDto } from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { cn } from "@weyver/ui/lib/utils"
import { Select } from "@weyver/ui/select"
import type { ReactNode } from "react"
import { AttachmentInput } from "@/components/form/attachment-input"
import { choicesOf } from "@/components/form/value"
import { ImageInput } from "@/components/form/image-input"
import { SignatureInput } from "@/components/form/signature-input"

/* metadata(cellValueType)→ 輸入元件 map(A4)。值以「原始編輯字串 / 陣列 / 布林」保存於
   填單 state;送出前由 toSubmitValue(field-value.ts)轉成後端型別。 */

/* 🔴 R1·UP-3c M1|**格子就是輸入框**,不再是格子裡浮一個框。

   改動前三種寬度並存:`<Input>` 不帶 className → 內建 `size` 撐出 ~250px、
   帶 `baseInputClass` 的原生 input → w-full、textarea → w-full。同一張表單三種欄寬,
   這正是「排版錯位」的來源。

   欄寬改由設計器的 colSpan 決定(form-geometry),輸入本身一律填滿格子、不自帶框線
   —— 與 B-3「拆互動項框線,改吃狀態階」同一條規則:邊界由格子畫,狀態由 focus 畫。
   focus 用 inset ring 不用外框,外擴的框會蓋到相鄰格子。 */
/* focus-within 同時涵蓋「自己被 focus 的原生 input」與「內層 input 被 focus 的 <Input> 包裝」,
   一條規則兩種用法都對,不必分兩個 class。 */
const baseInputClass =
  "min-h-[30px] w-full rounded-none border-0 bg-transparent px-2.5 text-[13px] text-ink outline-none focus-within:bg-primary-t focus-within:ring-1 focus-within:ring-primary focus-within:ring-inset"

export function FieldInput({
  field,
  formId,
  value,
  onChange,
  placeholder,
}: {
  field: FieldDto
  /* F-5:附件欄上傳需表單 id(header 用主表、明細列用子表)*/
  formId: number
  value: unknown
  onChange: (value: unknown) => void
  /* 🔴 2026-08-03:版面層 `placeholder`。設計器有一格就叫「提示文字(placeholder)」,
     但它自出貨以來只在設計畫布的預覽裡看得到,填單的輸入框從來沒收到過。
     只接文字類與數值類 —— 其餘型別的控制項沒有可放提示文字的位置,
     硬塞會變成「設了沒反應」的另一種形態。 */
  placeholder?: string | undefined
}) {
  if (isStubType(field.type)) {
    return <span className="text-[12px] text-ink-3">(此型別即將推出,暫不可填)</span>
  }

  switch (field.type) {
    // F-5 M4 附件:上傳 → pending 檔,欄值存 [{key,name}],記錄存檔後由後端轉 bound
    case "attachment":
      return (
        <AttachmentInput formId={formId} fieldId={field.id} value={value} onChange={onChange} />
      )

    // R1·UP-4b 影像類欄型:同 [{key,name}] 契約,差別在輸入與呈現
    case "image":
      return <ImageInput field={field} formId={formId} value={value} onChange={onChange} />

    case "signature":
      return <SignatureInput field={field} formId={formId} value={value} onChange={onChange} />

    case "autoNumber":
      return <span className="font-mono text-[12px] text-ink-3">儲存後自動產生</span>

    case "formula": {
      // 公式欄唯讀:value 由填單面板以 computeFormulaPreview 即時算出(儲存後後端為權威)
      const shown = value === null || value === undefined || value === "" ? "—" : String(value)
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[12px] text-ink">
          {shown}
          <span className="rounded-xs bg-label px-1 text-[12px] text-ink-3">fx</span>
        </span>
      )
    }

    // R1·UP-4 讀時計算虛擬欄:唯讀(值由後端讀時注入,填單不可編)
    case "createdAt":
    case "createdBy":
    case "updatedAt":
    case "updatedBy":
    case "lookup":
    case "rollup": {
      const shown = value === null || value === undefined || value === "" ? "—" : String(value)
      return (
        <span className="inline-flex items-center gap-1 text-[12px] text-ink">
          {shown}
          <span className="rounded-xs bg-label px-1 text-[12px] text-ink-3">唯讀</span>
        </span>
      )
    }

    // R1·後續-2 M2:存值 + 即時 QR 預覽(qrcode.react)
    case "barcode": {
      const sym = fieldSymbology(field) ?? "qr"
      return (
        <div className="flex flex-col gap-1.5">
          <Input
            className={baseInputClass}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="條碼內容值"
          />
          <BarcodeView value={value} symbology={sym} size={64} />
        </div>
      )
    }

    case "longText":
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          {...(placeholder === undefined ? {} : { placeholder })}
          /* resize-y:橫向拉會撐破格線,縱向可拉是使用者真的需要的 */
          className={cn(baseInputClass, "h-auto resize-y py-1.5")}
        />
      )

    case "number":
    case "percent":
    case "rating":
    case "money": {
      const inputMode = field.type === "money" ? "decimal" : "numeric"
      return (
        <Input
          className={baseInputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          placeholder={placeholder ?? (field.type === "money" ? "0.0000" : "")}
        />
      )
    }

    case "date":
      return (
        <input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        />
      )

    case "dateTime":
      return (
        <input
          type="datetime-local"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        />
      )

    /* 🔴 member 欄選人器(#96 M2)。**這是 E-1 指派機制在 UI 上的唯一入口** ——
       沒有它,「指派負責業務」只能靠 API 寫,而指派正是 Ragic 賴以達成
       「業務只看自己的客戶」的機制。
       欄位若勾了 grantsAccess,選了誰就等於把該筆記錄的存取權給誰。 */
    case "member":
      return <MemberInput value={value} onChange={onChange} field={field} />

    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-(--color-primary)"
        />
      )

    case "singleSelect":
      return (
        <Select
          className="w-full"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">—</option>
          {choicesOf(field).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </Select>
      )

    case "multiSelect": {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="flex flex-wrap gap-2">
          {choicesOf(field).map((choice) => {
            const on = selected.includes(choice)
            return (
              <label
                key={choice}
                className={cn(
                  "flex cursor-pointer items-center gap-1 rounded-xs border px-1.5 py-0.5 text-[12px]",
                  on ? "border-primary bg-primary-t text-primary" : "border-line text-ink-2",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, choice]
                        : selected.filter((c) => c !== choice),
                    )
                  }
                  className="accent-(--color-primary)"
                />
                {choice}
              </label>
            )
          })}
        </div>
      )
    }

    default: {
      // text / email / url / phone;text 欄可設「以條碼顯示」(Ragic doc/53,QR-only)
      const sym = fieldSymbology(field)
      return (
        <div className={sym === null ? "" : "flex flex-col gap-1.5"}>
          <Input
            className={baseInputClass}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            {...(placeholder === undefined ? {} : { placeholder })}
          />
          {sym === null ? null : <BarcodeView value={value} symbology={sym} size={64} />}
        </div>
      )
    }
  }
}

/* 使用者選擇器。以 select 而非自由輸入 —— member 欄存的是 actor id,
   讓使用者打字只會得到打錯的 id。 */
function MemberInput({
  value,
  onChange,
  field,
}: {
  readonly value: unknown
  readonly onChange: (v: unknown) => void
  readonly field: FieldDto
}): ReactNode {
  const { data: actors } = usePreviewActors()
  const grants = (field.options as { grantsAccess?: boolean } | undefined)?.grantsAccess === true
  return (
    <div className="flex flex-col gap-1">
      <Select
        value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        aria-label={`${field.name} 選擇使用者`}
      >
        <option value="">未指派</option>
        {(actors ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      {grants ? <span className="text-[12px] text-ink-3">選定的人將可存取此筆記錄</span> : null}
    </div>
  )
}
