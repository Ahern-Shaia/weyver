"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useState } from "react"
import { AuthShell, Field } from "@/lib/auth/auth-shell"
import { organization, signUp } from "@/lib/auth/client"

/* org slug 內部識別:ascii 化公司名 + 時戳後綴保唯一(中文名 → 退回 org-xxxx)。 */
function toSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${base || "org"}-${Date.now().toString(36)}`
}

export default function RegisterPage(): React.ReactNode {
  const router = useRouter()
  const [name, setName] = useState("")
  const [orgName, setOrgName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const signed = await signUp.email({ email, password, name })
    if (signed.error) {
      setBusy(false)
      setError(signed.error.message ?? "註冊失敗,請確認資料")
      return
    }

    // 建立公司工作區(org)→ 後端 hook 自動建 tenant + 連結;設為 active
    const created = await organization.create({ name: orgName, slug: toSlug(orgName) })
    if (created.error || !created.data) {
      setBusy(false)
      setError(created.error?.message ?? "建立公司工作區失敗")
      return
    }
    await organization.setActive({ organizationId: created.data.id })
    router.push("/app/builder")
  }

  return (
    <AuthShell title="建立公司工作區" subtitle="織雲工作區">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="公司名稱">
          <Input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            placeholder="鮮勇食品"
          />
        </Field>
        <Field label="您的姓名">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="王小明" />
        </Field>
        <Field label="電子郵件">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </Field>
        <Field label="密碼(至少 15 碼)">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </Field>
        {error ? <p className="text-[13px] text-er">{error}</p> : null}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
          {busy ? "建立中…" : "建立並進入"}
        </Button>
      </form>
      <p className="mt-4 text-[12px] text-ink-3">
        已經有帳號?
        <Link href="/login" className="text-primary hover:underline">
          登入
        </Link>
      </p>
    </AuthShell>
  )
}
