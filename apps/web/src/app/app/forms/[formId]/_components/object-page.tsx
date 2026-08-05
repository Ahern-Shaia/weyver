"use client"

import { Button } from "@weyver/ui/button"

import { FieldInput } from "@/components/form/field-input"
import { ImageThumb } from "@/components/form/image-input"
import { RuleMessages } from "@/components/form/rule-messages"
import { BarcodeView, fieldSymbology } from "@/lib/engine/barcode"
import { describeEngineError, downloadFile } from "@/lib/engine/client"
import { formatFieldValue } from "@/components/form/value"
import { useMemberNames, useRuleContext } from "@/lib/engine/authz"
import { evaluateFormats, evaluateMessages } from "@/lib/engine/conditional-format"
import { formatDateTime } from "@/lib/engine/display-value"
import {
  useButtons,
  useCreateRecord,
  useDeleteRecord,
  useRecordApproval,
  useUserNames,
} from "@/lib/engine/hooks"
import { useLayout, useLinkLabels, useRecordRevisions } from "@/lib/engine/hooks"
import { chipValues, isChipField, optionTone } from "@/lib/engine/option-tone"
import type { FieldDto, FormSummary, RecordRow } from "@/lib/engine/schemas"
import { useRecordPdf } from "@/lib/engine/use-pdf"
import { useUserSettings } from "@/lib/engine/use-settings"
import { StatusChip, chipToneTextClass } from "@weyver/ui/status-chip"
import { Copy, FileDown, Paperclip, Pencil, Printer, Trash2 } from "lucide-react"
import Link from "next/link"
import type { CSSProperties } from "react"
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { LineItems } from "./line-items"
import { RecordActions } from "./record-actions"
import { titleOf } from "./record-list"
import { RelationRail } from "./relation-rail"
import { useRecordEdit } from "./use-record-edit"

/* 複製時排除的欄位型別(系統計算/自動產生;由引擎於新記錄重算) */
const COPY_EXCLUDE = new Set(["autoNumber", "formula"])

/* 中欄 Object Page(SAP Fiori 式):黏頂摘要頭 + 區段錨點 scroll-spy + 基本資料 + 明細(rollup)+ 稽核。
   只接真資料(明細/formula/稽核皆 SHIPPED);R2 之 GL 過帳 / 簽核不放(不造假)。 */
const NUMERIC = new Set(["money", "number", "percent"])

/* 🔴 顯示格式化集中於 `display-value` —— 原本這裡是 `String(v)`,
   於是金額印成 `128400.0000`、時間印成 `2026-07-19T05:45:02.592Z`。
   docs/14 把兩者列為信任訊號,原樣印出內部表示的效果恰好相反。 */

/* R1·workbench-uplift A2|狀態欄慣例(OQ-RWB-3=A):**第一個 singleSelect 即狀態**,零設定。
   tone 由 R1·UP-4c 之選項配色供給(`optionTone`,受控白名單);未設定一律 neutral —— 不以
   字面猜測「已核准/待審」(客戶自訂用語會猜錯),且對齊 docs/14「已了結退到背景」。 */
function statusFieldOf(fields: readonly FieldDto[]): FieldDto | undefined {
  return fields.find((f) => f.type === "singleSelect")
}

/* 金額彙總:money / percent / formula / rollup 之現值(單筆的「算」的結果)。
   與「基本資料」重複呈現是刻意的 —— 摘要區讓人不必往下捲就看到數字(信任訊號,docs/14)。 */
const SUMMARY_TYPES = new Set(["money", "percent", "formula", "rollup"])

/* 歷史存的是**原始值**(OQ-RV-6:顯示格式會變,存顯示值等於把當時的格式凍進歷史)。
   這裡做最小的可讀化:空值講「(空)」而不是印 null,物件走 JSON。
   ⚠️ 刻意**不**套 `formatFieldValue` —— 那需要當下的欄位設定,而歷史裡的欄位可能已經
   改過型別甚至被刪掉;硬套會把「當時的值」渲染成今天的樣子,那是另一種說謊。 */
function revValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(空)"
  if (typeof v === "object") return JSON.stringify(v)
  const raw = String(v)
  /* 🔴 前值來自 DB(`numeric(19,4)` 回 `3.0000000000`),後值來自送進來的 payload(`10`)
     —— 同一個數字兩種寫法,畫面上會變成「3.0000000000 → 10」,看起來像壞掉。
     只去掉尾隨的零,**不套欄位格式**:歷史裡的欄位可能已改型別或被刪,
     硬套會把「當時的值」渲染成今天的樣子,那是另一種說謊。
     ⚠️ 超出安全整數範圍的不動 —— 那多半是 bigint id,轉數字會失真。 */
  if (/^-?\d+\.\d+$/.test(raw)) {
    const n = Number(raw)
    if (Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return String(n)
  }
  return raw
}

const SELF_LABELLED = new Set(["attachment", "image", "signature"])

function Row({
  noLabelWrap,
  className,
  style,
  children,
}: {
  readonly noLabelWrap: boolean
  readonly className: string
  readonly style: CSSProperties | undefined
  readonly children: ReactNode
}): ReactElement {
  if (noLabelWrap)
    return (
      <div className={className} style={style}>
        {children}
      </div>
    )
  return (
    <label className={className} style={style}>
      {children}
    </label>
  )
}

export function ObjectPage({
  form,
  record,
  childForm,
  formId,
  onDirtyChange,
}: {
  readonly form: { readonly name: string; readonly fields: readonly FieldDto[] }
  readonly record: RecordRow
  readonly childForm: FormSummary | null
  readonly formId: number
  /* 未儲存變更往上報:切換記錄會讓本元件重掛(見父層 `key`),
     擋不到自己的狀態 —— 只有父層攔得住 */
  readonly onDirtyChange?: (dirty: boolean) => void
}): ReactNode {
  const fields = form.fields
  const moneyField = fields.find((f) => f.type === "money")
  const statusField = statusFieldOf(fields)
  const summaryFields = fields.filter((f) => SUMMARY_TYPES.has(f.type))
  const { data: userNames } = useUserNames([record.createdBy, record.updatedBy])
  /* 系統動作(排程 / 還原)沒有 actor —— 講「系統」而不是印 `actor #null` */
  const nameOf = (actorId: number | null): string =>
    actorId === null
      ? "系統"
      : (userNames?.find((u) => u.id === actorId)?.name ?? `actor #${String(actorId)}`)
  const createRecord = useCreateRecord(formId)
  const deleteRecord = useDeleteRecord(formId)

  /* R1·workbench-uplift A4(OQ-RWB-5=A)|就地編輯:同一版面切換檢視↔編輯,不跳設計器。
     狀態與**未儲存變更防護**在 `use-record-edit`(Fiori:取消 / 離開皆須先警示)。 */
  const {
    editing,
    draft,
    busy: saving,
    msg,
    setMsg,
    setField,
    setFields,
    startEdit,
    cancelEdit,
    saveEdit,
  } = useRecordEdit(formId, record, fields, onDirtyChange)

  /* ⚠️ hook 一律放在任何提前 return 之前 —— 本檔上方 20 行就有這條警語,
     而我在別處剛違反過一次。 */
  const pdf = useRecordPdf()
  /* 條件式格式的「登入使用者 / 群組」與「當前時間」條件要用 */
  const ruleCtx = useRuleContext()

  const { data: userSettings } = useUserSettings()
  /* 顯示時區來自個人設定;未載入前用瀏覽器預設,不擋畫面 */
  const fmtCtx = { timeZone: userSettings?.displayTimezone }
  /* 🔴 audit-D §2.2|原本直接走 `displayValue`,而那支**不認識 member 與 link**
     —— 兩者都存數字 id,於是記錄頁把 id 印在畫面上。改走 `formatFieldValue`
     (列表頁本來就走這支),差別只在多帶兩張對照表。 */
  const memberNames = useMemberNames(fields)
  const linkLabels = useLinkLabels(formId, fields, [record])
  const fmtVal = (f: FieldDto, v: unknown): string =>
    formatFieldValue(f, v, memberNames, fmtCtx, linkLabels)
  const fmtDate = (iso: string): string => formatDateTime(iso, fmtCtx)

  const { data: layoutResp } = useLayout(formId)
  /* R1·UP-3b 條件式格式(記錄頁那一組;純前端求值,規則來自 layout)*/
  /* R1·H-4|修改紀錄(逐欄遮罩在後端) */
  const { data: revResp } = useRecordRevisions(formId, record.id)
  const revisions = revResp?.revisions ?? []
  const recordRules = layoutResp?.layout?.conditionalFormats?.record ?? []
  const formatTones = evaluateFormats(
    recordRules,
    record.values,
    fields.map((f) => f.name),
    ruleCtx,
  )
  /* 訊息是規則層效果 —— 顯示在內容區最上方,與欄位無關(OQ-CF-11) */
  const ruleMessages = evaluateMessages(
    recordRules,
    record.values,
    fields.map((f) => f.name),
    ruleCtx,
  )
  /* R1·後續-2 M4 列印設定:依 layout.print 之列範圍,對該列欄位套列印樣式
     (頁首/頁尾列於每頁重複;換頁列後分頁)。紙張設定委派瀏覽器(OQ-PM-3)。 */
  const printStyleFor = (fieldId: number): CSSProperties | undefined => {
    const layout = layoutResp?.layout
    if (!layout?.print) return undefined
    const row = layout.fields[String(fieldId)]?.row
    if (row === undefined) return undefined
    const { headerRows, footerRows, pageBreakAfterRows } = layout.print
    const style: CSSProperties = {}
    if (headerRows.includes(row)) style.breakInside = "avoid"
    if (footerRows.includes(row)) style.breakInside = "avoid"
    if (pageBreakAfterRows.includes(row)) style.breakAfter = "page"
    return Object.keys(style).length === 0 ? undefined : style
  }

  const onCopy = (): void => {
    const values: Record<string, unknown> = {}
    for (const f of fields) if (!COPY_EXCLUDE.has(f.type)) values[f.name] = record.values[f.name]
    createRecord.mutate(values, {
      onSuccess: () => setMsg("已複製為新記錄(見左側清單)"),
      onError: (e) => setMsg(describeEngineError(e)),
    })
  }
  const onDelete = (): void => {
    if (!window.confirm(`確定刪除「${titleOf(record, fields)}」?此動作可於資源回收桶還原。`)) return
    deleteRecord.mutate(record.id, { onError: (e) => setMsg(describeEngineError(e)) })
  }
  const busy = createRecord.isPending || deleteRecord.isPending || saving
  /* 🔴 Fiori 硬規則:**section 一律直接反映在導覽列**。
     原本只列了三段,而畫面上實際還有「摘要」與「動作/簽核」兩個區塊 ——
     使用者看得到卻跳不過去,捲到它們時導覽列也不會亮任何一項。

     ⚠️ **有內容才列**:`RecordActions` 在沒有自訂按鈕也沒有簽核流程時回 `null`,
     若無條件列出「動作」,點下去會跳到一片空白 —— 那正是本專案禁止的死控件。
     故用同一組 hook 在此判斷,不猜。 */
  const { data: buttons = [] } = useButtons(formId)
  const { data: approval } = useRecordApproval(formId, record.id)
  const hasActions = buttons.length > 0 || (approval?.instance ?? null) !== null
  const sections = useMemo<readonly string[]>(
    () => [
      ...(summaryFields.length > 0 ? ["摘要"] : []),
      ...(hasActions ? ["動作"] : []),
      "基本資料",
      ...(childForm ? ["明細"] : []),
      "稽核",
    ],
    [childForm, summaryFields.length, hasActions],
  )
  const [active, setActive] = useState<string>(sections[0] ?? "基本資料")
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onScroll = (): void => {
      const top = el.scrollTop + 48
      let cur = sections[0] ?? "基本資料"
      for (const s of sections) {
        const sec = el.querySelector<HTMLElement>(`#sec-${s}`)
        if (sec && sec.offsetTop - el.offsetTop <= top) cur = s
      }
      setActive(cur)
    }
    el.addEventListener("scroll", onScroll)
    return () => el.removeEventListener("scroll", onScroll)
  }, [sections])

  const jump = (s: string): void => {
    const el = bodyRef.current
    const sec = el?.querySelector<HTMLElement>(`#sec-${s}`)
    if (el && sec) el.scrollTo({ top: sec.offsetTop - el.offsetTop, behavior: "smooth" })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface">
      {/* 黏頂摘要頭 */}
      <div className="shrink-0 border-b border-line bg-card px-6 pt-3">
        <div className="text-[12px] text-ink-3">
          <Link href="/app" className="hover:text-primary">
            工作區
          </Link>{" "}
          / <span className="font-medium text-ink-3">{form.name}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <h3 className="text-[16px] font-semibold text-ink">{titleOf(record, fields)}</h3>
          <span className="font-mono text-[12px] text-ink-3">
            #{record.id} · v{record.version}
          </span>
          {statusField ? (
            <StatusChip tone={optionTone(statusField, record.values[statusField.name])}>
              {fmtVal(statusField, record.values[statusField.name])}
            </StatusChip>
          ) : null}
          {moneyField ? (
            <span className="ml-auto flex items-baseline gap-1.5">
              <span className="text-[12px] text-ink-3">{moneyField.name}</span>
              <span className="font-mono text-[16px] font-semibold tabular-nums text-ink">
                {fmtVal(moneyField, record.values[moneyField.name])}
              </span>
            </span>
          ) : null}
          <div data-noprint className={`flex items-center gap-1.5 ${moneyField ? "" : "ml-auto"}`}>
            {/* 🔴 Fiori 官方分工:**Edit / Delete / Copy 在 header,
                Save / Post / Accept / Reject 在 footer**。編輯中時 header 不放
                儲存/取消 —— 它們在下方的 footer toolbar(見本檔結尾)。 */}
            {editing ? null : (
              <ActBtn
                icon={<Pencil size={13} strokeWidth={1.9} />}
                label="編輯"
                onClick={startEdit}
                disabled={busy}
              />
            )}
            <ActBtn
              icon={<Copy size={13} strokeWidth={1.9} />}
              label="複製"
              onClick={onCopy}
              disabled={busy}
            />
            <ActBtn
              icon={<Trash2 size={13} strokeWidth={1.9} />}
              label="刪除"
              onClick={onDelete}
              disabled={busy}
              danger
            />
            <ActBtn
              icon={<Printer size={13} strokeWidth={1.9} />}
              label="列印"
              onClick={() => window.print()}
            />
            {/* 🔴 「列印」與「下載 PDF」是兩件事:前者要人站在電腦前,
                後者才寄得出去、存得回附件欄。R1·後續-2b。 */}
            <ActBtn
              icon={<FileDown size={13} strokeWidth={1.9} />}
              label={pdf.state.kind === "working" ? "產生中…" : "下載 PDF"}
              onClick={() => pdf.request(formId, [record.id])}
              disabled={pdf.state.kind === "working"}
            />
            <Link
              href={`/app/builder?form=${formId}`}
              title="在設計器開啟"
              className="flex size-7 items-center justify-center rounded-md bg-card text-ink-2 hover:bg-hover"
            >
              <Pencil size={13} strokeWidth={1.9} />
            </Link>
          </div>
        </div>
        {msg ? (
          <div className="mt-2 rounded-sm border border-line bg-label px-2.5 py-1 text-[12px] text-ink-2">
            {msg}
          </div>
        ) : null}
        <div className="mt-2.5 flex gap-1" data-noprint>
          {sections.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => jump(s)}
              className={
                active === s
                  ? "border-b-2 border-primary px-3 pt-1 pb-2 text-[12px] font-semibold text-primary"
                  : "border-b-2 border-transparent px-3 pt-1 pb-2 text-[12px] font-medium text-ink-3 hover:text-ink"
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 區段 */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <RuleMessages messages={ruleMessages} />
        {summaryFields.length > 0 ? (
          <section
            id="sec-摘要"
            className="mb-4 flex scroll-mt-2 flex-wrap gap-x-8 gap-y-2 border border-line bg-card px-4 py-3"
          >
            {summaryFields.map((f) => (
              <div key={f.id} className="flex flex-col gap-0.5">
                <span className="text-[12px] text-ink-3">{f.name}</span>
                <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">
                  {fmtVal(f, record.values[f.name])}
                </span>
              </div>
            ))}
          </section>
        ) : null}

        {/* R1·後續-1:自訂按鈕 + 簽核。**移進捲動容器**才量得到位置 ——
            放在容器外的話 scroll-spy 永遠不會把它算成當前區段。 */}
        {hasActions ? (
          <section id="sec-動作" className="scroll-mt-2 pb-4" data-noprint>
            <RecordActions
              formId={formId}
              recordId={record.id}
              rules={recordRules}
              values={record.values}
              fieldNames={fields.map((f) => f.name)}
            />
          </section>
        ) : null}

        <section id="sec-基本資料" className="scroll-mt-2 border-t border-line pt-4 pb-5">
          <h4 className="mb-2.5 text-[12px] font-semibold text-ink-3">基本資料</h4>
          {/* 🔴 audit-E §2.3|**靜態敘述第一批只補了 builder 的填單面板** ——
              而這裡才是終端使用者的主要畫面,它自己排版、不經 `HeaderFields`。
              「補了一半」比兩邊都沒有更難發現:設計者在填單頁看得到,
              到記錄頁就沒了,而沒有人會去比對這兩個畫面。
              ⚠️ 這裡是**流式版面**不是 12 欄格線,故依 row 排序後平鋪,不套座標。 */}
          {(layoutResp?.layout?.statics ?? [])
            .filter((el) => el.designOnly !== true)
            .slice()
            .sort((a, b) => a.row - b.row || a.col - b.col)
            .map((el) => (
              <p key={el.id} className="mb-2 text-[13px] text-ink-2">
                {el.kind === "image" ? null : el.href !== undefined && el.href !== "" ? (
                  <a href={el.href} className="text-primary hover:underline">
                    {el.text ?? el.href}
                  </a>
                ) : (
                  <span className="whitespace-pre-wrap">{el.text ?? ""}</span>
                )}
              </p>
            ))}
          {/* 🔴 欄數隨寬度降級(Material adaptive layout):寬螢幕放得下就多欄,
              窄螢幕強行兩欄會讓每欄只剩一半寬、標籤與值互相擠壓。 */}
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {fields.map((f) => (
              /* 🔴 R1·A11Y|記錄頁**有自己的版面**,不走 `field-grid.tsx` 的共用格子
                 (M0 §0.1 只查了填單面板 —— 那是一個站①的漏,「單一落點」只對了一半)。
                 故這裡自己用 `<label>` 把欄名與編輯中的輸入關聯起來。
                 檢視模式沒有輸入框,`<label>` 不會關聯到任何東西,無害。 */
              /* 附件 / 圖片 / 簽名的輸入元件自帶 `<label>`,外層再包一層會變巢狀 label
                 —— 無效 HTML,實測讓上傳失效(見 `field-grid.tsx` 的 `noLabelWrap`)。 */
              <Row
                key={f.id}
                noLabelWrap={SELF_LABELLED.has(f.type)}
                className="flex items-baseline gap-3 border-b border-line-2 py-2"
                style={printStyleFor(f.id)}
              >
                <span
                  className={`flex w-24 shrink-0 items-center gap-1 text-[12px] ${
                    chipToneTextClass(formatTones.get(f.name)) || "text-ink-3"
                  }`}
                >
                  {f.name}
                  {f.type === "formula" ? (
                    <span className="rounded-xs border border-fx/40 px-1 font-mono text-[12px] text-fx">
                      fx
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    NUMERIC.has(f.type) || f.type === "autoNumber"
                      ? "flex-1 font-mono text-[13px] tabular-nums text-ink"
                      : "flex-1 text-[13px] text-ink"
                  }
                >
                  {!editing && isChipField(f) ? (
                    <span className="flex flex-wrap gap-1">
                      {chipValues(record.values[f.name]).map((v) => (
                        <StatusChip key={v} tone={optionTone(f, v)}>
                          {v}
                        </StatusChip>
                      ))}
                      {chipValues(record.values[f.name]).length === 0 ? (
                        <span className="text-ink-3">—</span>
                      ) : null}
                    </span>
                  ) : !editing && (f.type === "image" || f.type === "signature") ? (
                    <ImageGallery value={record.values[f.name]} />
                  ) : editing ? (
                    <FieldInput
                      field={f}
                      formId={formId}
                      value={draft[f.name]}
                      onChange={(v) => setField(f.name, v)}
                      /* R1·LNK M2:連結欄選取當下把來源欄值帶進兄弟欄位 */
                      onLoadMany={setFields}
                      /* 連動選項:編輯中的草稿值(不是已存檔的 record.values)*/
                      siblings={draft}
                      fields={fields}
                    />
                  ) : f.type === "attachment" ? (
                    <AttachmentLinks value={record.values[f.name]} />
                  ) : fieldSymbology(f) === null ? (
                    fmtVal(f, record.values[f.name])
                  ) : (
                    <BarcodeView
                      value={record.values[f.name]}
                      symbology={fieldSymbology(f) ?? "qr"}
                      size={72}
                    />
                  )}
                </span>
              </Row>
            ))}
          </div>
        </section>

        {childForm ? (
          <section id="sec-明細" className="scroll-mt-2 border-t border-line pt-4 pb-5">
            <h4 className="mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-ink-3">
              明細
              <span className="font-normal text-[12px] text-ink-3">
                {childForm.name} · 合計 rollup
              </span>
            </h4>
            <LineItems childFormId={childForm.id} parentRecordId={record.id} />
          </section>
        ) : null}

        <RelationRail formId={formId} record={record} fields={fields} />

        <section id="sec-稽核" className="scroll-mt-2 border-t border-line pt-4">
          <h4 className="mb-2.5 text-[12px] font-semibold text-ink-3">稽核紀錄</h4>
          <div className="relative pl-4">
            <div className="absolute top-1 bottom-1 left-1 w-px bg-line" />
            <Event label="建立" who={nameOf(record.createdBy)} at={fmtDate(record.createdAt)} />
            <Event
              label={`更新 · v${record.version}`}
              who={nameOf(record.updatedBy)}
              at={fmtDate(record.updatedAt)}
              now
            />
          </div>

          {/* 🔴 R1·H-4|**修改紀錄**。上面那條時間軸只說得出「誰、何時」,
              而 Ragic 使用者天天在看的是「**把什麼改成什麼**」(官方 `doc/81` 逐字:
              「點選修改紀錄後,會列出該筆資料**詳細的修改內容**」)。
              逐欄遮罩在後端 —— 看不到的欄位,其歷史也看不到。 */}
          <h4 className="mt-4 mb-2 text-[12px] font-semibold text-ink-3">修改紀錄</h4>
          {revisions.length === 0 ? (
            <p className="text-[12px] text-ink-3">尚無修改紀錄。</p>
          ) : (
            <ul data-testid="record-revisions" className="flex flex-col">
              {revisions.map((rev) => (
                <li
                  key={`${String(rev.version)}-${rev.createdAt}`}
                  className="border-b border-line-2 py-1.5 last:border-b-0"
                >
                  <div className="flex items-baseline gap-2 text-[12px] text-ink-3">
                    <span className="text-ink-2">
                      {rev.action === "create" ? "建立" : `更新 · v${String(rev.version)}`}
                    </span>
                    <span>{nameOf(rev.actorId)}</span>
                    <span className="ml-auto font-mono">{fmtDate(rev.createdAt)}</span>
                  </div>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {rev.changes.map((c) => (
                      <li key={c.field} className="flex items-baseline gap-1.5 text-[12px]">
                        <span className="w-20 shrink-0 truncate text-ink-3">{c.field}</span>
                        {/* 建立時沒有「前值」 —— 不畫一個空的箭頭 */}
                        {rev.action === "create" ? (
                          <span className="text-ink">{revValue(c.after)}</span>
                        ) : (
                          <>
                            <span className="text-ink-3 line-through">{revValue(c.before)}</span>
                            <span className="text-ink-3">→</span>
                            <span className="text-ink">{revValue(c.after)}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 🔴 footer toolbar(Fiori 官方分工:Save / Post / Accept / Reject 在 footer)。
          **只在編輯中出現** —— 常駐一條空工具列只會吃掉垂直空間。
          黏在底部而非跟著內容捲走:長表單捲到一半要存檔時,按鈕必須還在。 */}
      {editing ? (
        <div
          data-noprint
          className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-card px-6 py-2.5"
        >
          <Button onClick={cancelEdit} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={saveEdit} disabled={busy}>
            {busy ? "儲存中…" : "儲存"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/* R1·UP-4b:圖片 / 簽名以縮圖呈現(值契約同附件,差別只在呈現) */
function ImageGallery({ value }: { readonly value: unknown }): ReactNode {
  const items = Array.isArray(value)
    ? value.filter(
        (v): v is { key: string; name: string } =>
          typeof v === "object" &&
          v !== null &&
          typeof (v as { key?: unknown }).key === "string" &&
          typeof (v as { name?: unknown }).name === "string",
      )
    : []
  if (items.length === 0) return <span className="text-ink-3">—</span>
  return (
    <span className="flex flex-wrap gap-2">
      {items.map((item) => (
        <ImageThumb key={item.key} item={item} maxHeight={72} />
      ))}
    </span>
  )
}

/* F-5:附件下載走 API 代理(每次驗權限);純 href 於 dev 帶不了租戶標頭 */
function AttachmentLinks({ value }: { readonly value: unknown }): ReactNode {
  const items = Array.isArray(value)
    ? value.filter(
        (v): v is { key: string; name: string } =>
          typeof v === "object" &&
          v !== null &&
          typeof (v as { key?: unknown }).key === "string" &&
          typeof (v as { name?: unknown }).name === "string",
      )
    : []
  if (items.length === 0) return <span className="text-ink-3">—</span>
  return (
    <span className="flex flex-col gap-0.5">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => void downloadFile(item.key, item.name)}
          className="flex items-center gap-1 text-left text-[12px] text-primary hover:underline"
        >
          <Paperclip size={11} strokeWidth={1.9} />
          {item.name}
        </button>
      ))}
    </span>
  )
}

function ActBtn({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly danger?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      /* 🔴 窄螢幕收成純圖示。原本標籤恆顯示,600px 下每顆按鈕都折成兩行
         (「編 輯」「複 製」),既醜也難點。名稱留在 `title` 與 `aria-label`
         —— 圖示按鈕沒有可及名稱等於螢幕閱讀器使用者按不到。 */
      title={label}
      aria-label={label}
      className={`flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[12px] whitespace-nowrap transition-colors duration-fast-01 ease-productive-exit disabled:opacity-50 ${
        danger
          ? "border-er-line text-er hover:bg-er-t"
          : "border-line bg-card text-ink-2 hover:bg-head"
      }`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}

function Event({
  label,
  who,
  at,
  now,
}: {
  readonly label: string
  readonly who: string
  readonly at: string
  readonly now?: boolean
}): ReactNode {
  return (
    <div className="relative pb-3">
      <span
        className={`absolute top-1 -left-[15px] size-[7px] rounded-full border-[1.5px] bg-card ${now ? "border-primary bg-primary" : "border-ink-3"}`}
      />
      <div className="text-[12px] text-ink">
        <b className="font-medium">{who}</b> {label}
      </div>
      <div className="mt-0.5 font-mono text-[12px] text-ink-3">{at}</div>
    </div>
  )
}
