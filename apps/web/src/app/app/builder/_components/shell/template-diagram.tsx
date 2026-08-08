import type { TemplateDetailField, TemplateDetailForm } from "@/lib/engine/hooks"
import { CornerDownRight, MoveLeft } from "lucide-react"
import type { ReactNode } from "react"

/* 🔴 R1·TPL M8|表單關聯圖。

   **圖由 pack 定義推導,不是另外畫的圖。** `ref` / `parentRef` / `targetRef`
   已經是結構化資料,這裡只是把它畫出來 → **不可能和實際裝進去的東西不一致**。
   ⚠️ 不宣稱競品的是靜態圖(未查證),只陳述我方性質。

   **子表用垂直縮排、連結用水平箭頭,刻意不同形** —— 它們是兩種關係:
   子表是**同一筆記錄的一部分**,連結是**指向另一張表的另一筆**。
   長得一樣會讓使用者以為裝進來是幾張互不相干的表。

   共識 R9(docs/38):型別章**純量一律灰,只有指向別張表的才上色**。 */

const TYPE_LABEL: Record<string, string> = {
  text: "文字",
  longText: "多行文字",
  number: "數字",
  money: "金額",
  date: "日期",
  datetime: "日期時間",
  singleSelect: "單選",
  multiSelect: "多選",
  checkbox: "核取",
  phone: "電話",
  email: "Email",
  url: "網址",
  autoNumber: "自動編號",
  link: "連結",
  formula: "公式",
}

function FieldRow({ field }: { readonly field: TemplateDetailField }): ReactNode {
  const isRelation = field.targetRef !== undefined
  return (
    <div className="flex items-center gap-2 py-0.5 text-[12px] leading-tight">
      <span
        className={
          isRelation
            ? "shrink-0 rounded-xs border border-rel/30 bg-rel-bg px-1 text-tag text-rel"
            : "shrink-0 rounded-xs border border-line-2 bg-sunken px-1 text-tag text-ink-3"
        }
      >
        {TYPE_LABEL[field.type] ?? field.type}
      </span>
      <span className="min-w-0 truncate text-ink-2">{field.name}</span>
      {field.required ? <span className="shrink-0 text-[12px] text-er">必填</span> : null}
    </div>
  )
}

function FormNode({
  form,
  kind,
}: {
  readonly form: TemplateDetailForm
  readonly kind: "main" | "lookup" | "sub"
}): ReactNode {
  const label = kind === "sub" ? "子表" : kind === "lookup" ? "主檔" : "主表"
  return (
    <div
      className={
        kind === "main"
          ? "min-w-[184px] rounded-md border border-primary/40 bg-card"
          : "min-w-[184px] rounded-md border border-line bg-card"
      }
    >
      <div
        className={
          kind === "main"
            ? "flex items-center gap-2 border-line-2 border-b bg-primary-t px-2.5 py-1.5"
            : "flex items-center gap-2 border-line-2 border-b bg-sunken px-2.5 py-1.5"
        }
      >
        <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{form.name}</span>
        <span className="ml-auto shrink-0 rounded-xs border border-line-2 bg-card px-1 text-tag text-ink-3">
          {label}
        </span>
      </div>
      <div className="px-2.5 py-1.5">
        {form.fields.slice(0, 4).map((f) => (
          <FieldRow key={f.name} field={f} />
        ))}
        {form.fields.length > 4 ? (
          <div className="pt-0.5 text-[12px] text-ink-3">另有 {form.fields.length - 4} 個欄位</div>
        ) : null}
      </div>
    </div>
  )
}

export function TemplateDiagram({
  forms,
}: {
  readonly forms: readonly TemplateDetailForm[]
}): ReactNode {
  const byRef = new Map(forms.map((f) => [f.ref, f]))
  /* 被別人當子表的、被別人連結指到的,都不是「主表」 */
  const subRefs = new Set(forms.flatMap((f) => (f.parentRef === undefined ? [] : [f.ref])))
  const linkedRefs = new Set(
    forms.flatMap((f) => f.fields.flatMap((x) => (x.targetRef === undefined ? [] : [x.targetRef]))),
  )
  const roots = forms.filter((f) => !subRefs.has(f.ref) && !linkedRefs.has(f.ref))
  /* 沒有明確的根(例如單表包,或互相指)→ 全部平鋪,不硬湊出階層 */
  const heads = roots.length > 0 ? roots : forms

  return (
    <div className="flex flex-col gap-4">
      {heads.map((head) => {
        const targets = [
          ...new Set(head.fields.flatMap((f) => (f.targetRef === undefined ? [] : [f.targetRef]))),
        ]
          .map((r) => byRef.get(r))
          .filter((f): f is TemplateDetailForm => f !== undefined)
        const children = forms.filter((f) => f.parentRef === head.ref)
        return (
          <div key={head.ref} className="flex flex-wrap items-start gap-x-3 gap-y-2">
            {targets.map((t) => (
              <div key={t.ref} className="flex items-start gap-3">
                <FormNode form={t} kind="lookup" />
                {/* 連結 = 水平箭頭,方向是「主表指向主檔」 */}
                <div className="flex h-[34px] flex-col items-center justify-center gap-0.5 pt-2">
                  <span className="rounded-xs border border-rel/30 bg-rel-bg px-1 text-tag font-medium text-rel">
                    連結
                  </span>
                  <MoveLeft size={14} strokeWidth={1.8} className="text-rel" />
                </div>
              </div>
            ))}
            <div className="flex flex-col">
              <FormNode form={head} kind="main" />
              {children.map((c) => (
                /* 子表 = 垂直縮排 + 轉角線,和連結的水平箭頭刻意不同形 */
                <div key={c.ref} className="flex items-start gap-1.5 pl-5 pt-1.5">
                  <CornerDownRight size={14} strokeWidth={1.8} className="mt-2.5 text-ink-4" />
                  <FormNode form={c} kind="sub" />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
