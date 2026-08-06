"use client"

import { BusyBar, FirstLoad } from "@/components/busy-indicator"
import { describeEngineError } from "@/lib/engine/client"
import {
  CURRENCIES,
  LOCALE_LABELS,
  TIMEZONES,
  useTenantSettings,
  useUpdateTenantSettings,
} from "@/lib/engine/use-settings"
import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"

/* R1·A-1 M1|公司設定(S22 之租戶軸)。

   🔴 **時區這一欄的文案是刻意的。** `tenants.timezone` 不是「顯示時區」,
   它是**業務日界線** —— autoNumber 的日期段與歸零週期靠它判定。
   台灣(UTC+8)若走 UTC,01/01 08:00 前開的單會拿到**去年**的年度序號、
   單號日期段也印成去年,而那是已列印憑證上不可回收的錯誤。
   所以這裡必須講清楚它管什麼、以及它**不是**個人的顯示時區(那在個人設定)。 */

export default function CompanySettingsPage(): ReactNode {
  const { data } = useTenantSettings()
  const update = useUpdateTenantSettings()
  const [form, setForm] = useState<{
    name: string
    taxId: string
    pdfWatermarkText: string
    timezone: string
    defaultLocale: string
    defaultCurrency: string
    requireMfa: boolean
  } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (data === undefined) return
    setForm({
      name: data.name,
      taxId: data.taxId ?? "",
      pdfWatermarkText: data.pdfWatermarkText ?? "",
      timezone: data.timezone,
      defaultLocale: data.defaultLocale,
      defaultCurrency: data.defaultCurrency,
      requireMfa: data.requireMfa,
    })
  }, [data])

  if (data === undefined || form === null) return <FirstLoad />

  const set = (patch: Partial<NonNullable<typeof form>>): void =>
    setForm((f) => (f === null ? f : { ...f, ...patch }))

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setMsg(null)
    setError(null)
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        // 空字串 = 清空統編。DB CHECK 只接受 NULL 或 8 碼數字,故不可送 ""
        taxId: form.taxId.trim() === "" ? null : form.taxId.trim(),
        /* 空字串 = 關掉浮水印。後端也會轉一次(DB CHECK 不收空字串),
           這裡先轉是為了不讓「清空後按儲存」多跑一趟往返才失敗。 */
        pdfWatermarkText: form.pdfWatermarkText.trim() === "" ? null : form.pdfWatermarkText.trim(),
        timezone: form.timezone,
        defaultLocale: form.defaultLocale,
        defaultCurrency: form.defaultCurrency,
        requireMfa: form.requireMfa,
      })
      setMsg("已儲存")
    } catch (e) {
      setError(describeEngineError(e))
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-[16px] font-semibold text-ink">公司設定</h1>
        <p className="mt-1 text-[12px] text-ink-3">這些設定影響公司的所有人。只有管理員能修改。</p>
      </div>

      <form onSubmit={onSubmit} className="relative flex flex-col gap-4">
        <BusyBar busy={update.isPending} />

        <section className="flex flex-col gap-3 rounded-sm border border-line bg-card p-4">
          <h2 className="text-[13px] font-semibold text-ink">公司資料</h2>
          <Field label="公司名稱">
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
          </Field>
          <Field label="統一編號" hint="8 碼數字;非台灣公司可留空">
            <Input
              value={form.taxId}
              onChange={(e) => set({ taxId: e.target.value })}
              inputMode="numeric"
              placeholder="12345678"
            />
          </Field>
          {/* R1·後續-2b M2 A3。留空 = 不加浮水印。 */}
          <Field
            label="PDF 浮水印"
            hint="斜印在每一頁背景上,例如「副本」「作廢」「機密」。留空則不加。最多 32 字。"
          >
            <Input
              value={form.pdfWatermarkText}
              onChange={(e) => set({ pdfWatermarkText: e.target.value })}
              maxLength={32}
              placeholder="副本"
            />
          </Field>
        </section>

        <section className="flex flex-col gap-3 rounded-sm border border-line bg-card p-4">
          <h2 className="text-[13px] font-semibold text-ink">地區</h2>

          <Field
            label="業務時區"
            hint="決定單號日期段與各項期間的「一天」從何時開始。這不是顯示時區 —— 個人的顯示時區在「個人設定」。"
          >
            <Select value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="預設語言" hint="新成員的介面語言;每個人可於個人設定自行覆寫">
            <Select
              value={form.defaultLocale}
              onChange={(e) => set({ defaultLocale: e.target.value })}
            >
              {Object.entries(LOCALE_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="預設幣別">
            <Select
              value={form.defaultCurrency}
              onChange={(e) => set({ defaultCurrency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </section>

        {/* 🔴 安全政策獨立一區:它與「公司叫什麼名字」不是同一種東西 ——
            這一個開關會讓沒啟用二步驟驗證的同事**當場被擋在門外**。 */}
        <section className="flex flex-col gap-3 rounded-sm border border-line bg-card p-4">
          <h2 className="text-[13px] font-semibold text-ink">安全政策</h2>
          <label className="flex items-start gap-2 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={form.requireMfa}
              onChange={(e) => set({ requireMfa: e.target.checked })}
              className="mt-0.5 accent-primary"
            />
            <span>
              要求全公司使用二步驟驗證
              <span className="mt-0.5 block text-ink-3">
                開啟後,尚未啟用的同事在啟用之前無法使用公司資料(帳號安全頁仍可進入,以便完成啟用)。
                你必須先為自己啟用,才能開啟這一項。
              </span>
            </span>
          </label>
        </section>

        {error !== null ? <p className="text-[12px] text-er">{error}</p> : null}
        {msg !== null ? <p className="text-[12px] text-ok">{msg}</p> : null}

        <Button type="submit" variant="primary" disabled={update.isPending} className="w-fit">
          {update.isPending ? "儲存中…" : "儲存"}
        </Button>
      </form>
    </main>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string
  readonly hint?: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {hint === undefined ? null : <span className="text-[12px] text-ink-3">{hint}</span>}
    </label>
  )
}
