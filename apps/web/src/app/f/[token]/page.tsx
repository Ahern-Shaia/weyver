"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { CheckCircle2 } from "lucide-react"
import { useParams } from "next/navigation"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"

/* 🔴 G-2|**公開填寫頁。這是全站唯一給未登入者看的畫面。**

   刻意不用 `/app` 的 layout:那層有側欄、通知鈴、租戶名稱 —— 全都是
   訪客不該看到的內部資訊。這頁只有表單本身。

   也刻意不用 `engineFetch`:那支會帶 `x-dev-tenant` 標頭與內部錯誤處理,
   訪客路徑不該共用內部客戶端。 */

interface PublicField {
  readonly id: number
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly options: Record<string, unknown>
}

interface PublicForm {
  readonly title: string
  readonly description: string | null
  readonly fields: readonly PublicField[]
  readonly renderedAt: number
}

function choicesOf(options: Record<string, unknown>): string[] {
  const raw = options["choices"]
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => (typeof c === "string" ? c : ((c as { name?: string; retired?: boolean }) ?? {})))
    .filter((c) => typeof c === "string" || c.retired !== true)
    .map((c) => (typeof c === "string" ? c : (c.name ?? "")))
    .filter((n) => n !== "")
}

function inputTypeFor(type: string): string {
  switch (type) {
    case "email":
      return "email"
    case "url":
      return "url"
    case "phone":
      return "tel"
    case "number":
    case "money":
    case "percent":
    case "rating":
      return "number"
    case "date":
      return "date"
    case "dateTime":
      return "datetime-local"
    default:
      return "text"
  }
}

export default function PublicFormPage(): ReactNode {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [form, setForm] = useState<PublicForm | null>(null)
  const [closed, setClosed] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)
  /* honeypot:真人看不到,填了就是機器人 */
  const [trap, setTrap] = useState("")

  useEffect(() => {
    void fetch(`/api/engine/public/forms/${token}`)
      .then(async (res) => {
        const body = (await res.json()) as PublicForm & { message?: string }
        if (!res.ok) {
          setClosed(body.message ?? "這個表單目前無法填寫。")
          return
        }
        setForm(body)
      })
      .catch(() => setClosed("這個表單目前無法填寫。"))
  }, [token])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/engine/public/forms/${token}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values,
          company_website: trap,
          renderedAt: form?.renderedAt,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; reference?: string; message?: string }
      if (!res.ok) {
        setError(body.message ?? "送出失敗,請稍後再試")
        return
      }
      setReference(body.reference ?? "")
    } catch {
      setError("送出失敗,請稍後再試")
    } finally {
      setBusy(false)
    }
  }

  if (closed !== null) {
    return (
      <Shell>
        <p className="text-[13px] text-ink-2">{closed}</p>
      </Shell>
    )
  }
  if (reference !== null) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 size={28} className="text-ok" />
          <p className="text-[14px] font-semibold text-ink">已收到你的填寫內容</p>
          {/* 🔴 回執是不透明代碼,不是流水號 —— 連號會洩漏對方的業務量 */}
          <p className="text-[12px] text-ink-2">
            查詢代碼 <code className="font-mono text-ink">{reference}</code>
          </p>
          <p className="text-[11.5px] text-ink-3">內容將由承辦人員確認後處理。</p>
        </div>
      </Shell>
    )
  }
  if (form === null) {
    return (
      <Shell>
        <p className="text-[12px] text-ink-3">載入中…</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-[17px] font-semibold text-ink">{form.title}</h1>
      {form.description === null ? null : (
        <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-2">{form.description}</p>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="mt-5 flex flex-col gap-3">
        {form.fields.map((f) => (
          <label key={f.id} className="flex flex-col gap-1">
            <span className="text-[12px] text-ink-2">
              {f.name}
              {f.required ? <span className="ml-0.5 text-er">*</span> : null}
            </span>
            {f.type === "singleSelect" || f.type === "multiSelect" ? (
              <Select
                required={f.required}
                multiple={f.type === "multiSelect"}
                value={(values[f.name] as string) ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              >
                <option value="">請選擇</option>
                {choicesOf(f.options).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            ) : f.type === "longText" ? (
              <textarea
                required={f.required}
                rows={4}
                className="rounded-sm border border-line bg-card px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary"
                value={(values[f.name] as string) ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            ) : f.type === "checkbox" ? (
              <input
                type="checkbox"
                className="size-4 self-start"
                checked={values[f.name] === true}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
              />
            ) : (
              <Input
                type={inputTypeFor(f.type)}
                required={f.required}
                value={(values[f.name] as string) ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            )}
          </label>
        ))}

        {/* honeypot:視覺與輔助技術皆隱藏,只有機器人會填 */}
        <input
          type="text"
          name="company_website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        />

        {error === null ? null : (
          <div className="rounded-sm border border-er-line bg-er-t px-2.5 py-1.5 text-[14px] text-er">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 self-start">
          {busy ? "送出中…" : "送出"}
        </Button>
      </form>
    </Shell>
  )
}

function Shell({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <main className="min-h-screen bg-surface px-4 py-10">
      <div className="mx-auto max-w-[560px] rounded-md border border-line bg-card p-6">
        {children}
      </div>
      {/* 不放租戶名稱 / 版本 / 內部連結 —— 訪客不需要,洩漏也無益 */}
      <p className="mx-auto mt-3 max-w-[560px] text-center text-[10.5px] text-ink-3">
        由 Weyver 提供表單服務
      </p>
    </main>
  )
}
