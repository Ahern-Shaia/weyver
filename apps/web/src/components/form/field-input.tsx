"use client"

import { usePreviewActors } from "@/lib/engine/authz"
import { useLinkOptions } from "@/lib/engine/hooks"
import { BarcodeView, fieldSymbology } from "@/lib/engine/barcode"
import { isStubType } from "@/lib/engine/field-types"
import type { FieldDto } from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { cn } from "@weyver/ui/lib/utils"
import { Select } from "@weyver/ui/select"
import { type ReactNode, useState } from "react"
import { AttachmentInput } from "@/components/form/attachment-input"
import { DateInput } from "@/components/form/date-input"
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

    /* 🔴 R1·FMT M3:改用自製輸入。原生控件的顯示格式**由瀏覽器語系決定**
       (量測見 `docs/modules/R1/date-and-display-format.md` §0.3-bis),
       而且不能打字。對外契約仍是 `yyyy-MM-dd`,`toSubmitValue` 不動。 */
    case "date":
      return (
        <DateInput
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          options={field.options}
          className={baseInputClass}
          placeholder={placeholder}
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

    /* 🔴 R1·LNK M1|連結欄選記錄。**在此之前這裡沒有 `case "link"`** ——
       連結欄落到預設分支,使用者要自己打目標記錄的 id。
       連結是 Ragic 兩大招牌之一(doc/14「連結與載入」),遷移客戶天天在用。 */
    case "link":
      return <LinkInput value={value} onChange={onChange} field={field} formId={formId} />

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
          aria-label={field.name}
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
          {/* ⚠️ **此輸入框在無障礙樹上沒有名字** —— 視覺欄名是旁邊的一個 div,
              沒有 `<label for>` 關聯,螢幕閱讀器只會唸「編輯文字」(WCAG 4.1.2)。

              2026-08-04 曾補上 `aria-label={field.name}`,但**量到的波及面是 27 條 e2e** ——
              現行多數 spec 以 placeholder 推導出的無障礙名稱當錨點(如 money 欄的 `0.0000`),
              一改就全斷。修法本身是對的(placeholder 一打字就消失,拿它當名稱是反樣式),
              但它是一件**獨立的 a11y 工作**,不該夾帶在別的 commit 裡順手做掉。已開 task。 */}
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

/* 🔴 R1·LNK M1|連結欄選記錄。刻意**沿用 `MemberInput` 的形狀**(搜尋 + 選一筆 + 顯示名稱)
   而不另創語彙 —— 兩者對使用者是同一個動作。

   候選清單由後端過權限(目標表單的 `view`),前端只負責顯示;
   label 對隱藏的標題欄會回 `#id`,那是後端刻意的具名退場,不要在這裡改寫成空白。 */
function LinkInput({
  value,
  onChange,
  field,
  formId,
}: {
  readonly value: unknown
  readonly onChange: (v: unknown) => void
  readonly field: FieldDto
  readonly formId: number
}): ReactNode {
  const [q, setQ] = useState("")
  const { data, isPending } = useLinkOptions(formId, field.id, q, true)
  const options = data?.options ?? []
  const current = typeof value === "number" || typeof value === "string" ? String(value) : ""
  /* 已選的那筆可能不在當下搜尋結果裡 —— 補一個佔位項,否則 select 會顯示成「未選擇」,
     使用者會以為自己的選擇被清掉了。 */
  const missing = current !== "" && !options.some((o) => String(o.id) === current)

  return (
    <div className="flex w-full flex-col gap-1">
      <Input
        className="h-7"
        aria-label={`${field.name} 搜尋`}
        placeholder="搜尋…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Select
        value={current}
        aria-label={`${field.name} 選擇記錄`}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">未選擇</option>
        {missing ? <option value={current}>{`#${current}`}</option> : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      {isPending ? <span className="text-[12px] text-ink-3">載入候選…</span> : null}
      {!isPending && options.length === 0 ? (
        <span className="text-[12px] text-ink-3">
          {q === "" ? "來源表單沒有記錄,或你對它沒有檢視權" : `沒有符合「${q}」的記錄`}
        </span>
      ) : null}
    </div>
  )
}
