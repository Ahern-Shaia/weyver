"use client"

import { Pencil } from "lucide-react"
import Link from "next/link"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import type { FieldDto, FormSummary, RecordRow } from "@/lib/engine/schemas"
import { LineItems } from "./line-items"
import { titleOf } from "./record-list"

/* 中欄 Object Page(SAP Fiori 式):黏頂摘要頭 + 區段錨點 scroll-spy + 基本資料 + 明細(rollup)+ 稽核。
   只接真資料(明細/formula/稽核皆 SHIPPED);R2 之 GL 過帳 / 簽核不放(不造假)。 */
const NUMERIC = new Set(["money", "number", "percent"])

function fmtDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 19)
}
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (Array.isArray(v)) return v.length ? v.map(String).join("、") : "—"
  if (typeof v === "boolean") return v ? "是" : "否"
  return String(v)
}

export function ObjectPage({
  form,
  record,
  childForm,
  formId,
}: {
  readonly form: { readonly name: string; readonly fields: readonly FieldDto[] }
  readonly record: RecordRow
  readonly childForm: FormSummary | null
  readonly formId: number
}): ReactNode {
  const fields = form.fields
  const moneyField = fields.find((f) => f.type === "money")
  const sections = useMemo<readonly string[]>(
    () => ["基本資料", ...(childForm ? ["明細"] : []), "稽核"],
    [childForm],
  )
  const [active, setActive] = useState<string>("基本資料")
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
        <div className="text-[11px] text-ink-4">
          <Link href="/app" className="hover:text-primary">
            工作區
          </Link>{" "}
          / <span className="font-medium text-ink-3">{form.name}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <h3 className="text-[16px] font-semibold text-ink">{titleOf(record, fields)}</h3>
          <span className="font-mono text-[11px] text-ink-4">
            #{record.id} · v{record.version}
          </span>
          {moneyField ? (
            <span className="ml-auto flex items-baseline gap-1.5">
              <span className="text-[10px] text-ink-4">{moneyField.name}</span>
              <span className="font-mono text-[17px] font-semibold tabular-nums text-ink">
                {fmtVal(record.values[moneyField.name])}
              </span>
            </span>
          ) : null}
          <Link
            href={`/app/builder?form=${formId}`}
            className={`flex h-7 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-[12px] text-ink-2 hover:bg-head ${moneyField ? "" : "ml-auto"}`}
          >
            <Pencil size={13} strokeWidth={1.9} />
            在設計器開啟
          </Link>
        </div>
        <div className="mt-2.5 flex gap-1">
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
        <section id="sec-基本資料" className="scroll-mt-2 pb-5">
          <h4 className="mb-2.5 text-[11.5px] font-semibold text-ink-3">基本資料</h4>
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.id} className="flex items-baseline gap-3 border-b border-line-2 py-2">
                <span className="flex w-24 shrink-0 items-center gap-1 text-[11px] text-ink-4">
                  {f.name}
                  {f.type === "formula" ? (
                    <span className="rounded-xs border border-fx/40 px-1 font-mono text-[8.5px] text-fx">
                      fx
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    NUMERIC.has(f.type) || f.type === "autoNumber"
                      ? "flex-1 font-mono text-[12.5px] tabular-nums text-ink"
                      : "flex-1 text-[12.5px] text-ink"
                  }
                >
                  {fmtVal(record.values[f.name])}
                </span>
              </div>
            ))}
          </div>
        </section>

        {childForm ? (
          <section id="sec-明細" className="scroll-mt-2 border-t border-line pt-4 pb-5">
            <h4 className="mb-2.5 flex items-center gap-2 text-[11.5px] font-semibold text-ink-3">
              明細
              <span className="font-normal text-[10px] text-ink-4">
                {childForm.name} · 合計 rollup
              </span>
            </h4>
            <LineItems childFormId={childForm.id} parentRecordId={record.id} />
          </section>
        ) : null}

        <section id="sec-稽核" className="scroll-mt-2 border-t border-line pt-4">
          <h4 className="mb-2.5 text-[11.5px] font-semibold text-ink-3">稽核紀錄</h4>
          <div className="relative pl-4">
            <div className="absolute top-1 bottom-1 left-1 w-px bg-line" />
            <Event label="建立" who={`actor #${record.createdBy}`} at={fmtDate(record.createdAt)} />
            <Event
              label={`更新 · v${record.version}`}
              who={`actor #${record.updatedBy}`}
              at={fmtDate(record.updatedAt)}
              now
            />
          </div>
        </section>
      </div>
    </div>
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
        className={`absolute top-1 -left-[15px] size-[7px] rounded-full border-[1.5px] bg-card ${now ? "border-primary bg-primary" : "border-ink-4"}`}
      />
      <div className="text-[12px] text-ink">
        <b className="font-medium">{who}</b> {label}
      </div>
      <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">{at}</div>
    </div>
  )
}
