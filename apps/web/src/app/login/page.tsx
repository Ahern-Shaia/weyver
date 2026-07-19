"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useState } from "react"
import { AuthShell, Field } from "@/lib/auth/auth-shell"
import { organization, signIn } from "@/lib/auth/client"

export default function LoginPage(): React.ReactNode {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await signIn.email({ email, password })
    if (result.error) {
      setBusy(false)
      // 不洩漏帳號是否存在(enumeration 防護)
      setError("帳號或密碼錯誤")
      return
    }
    // 新 session 之 activeOrganizationId 為空 → 設回使用者第一個 org(確保 tenant 可解析)
    const list = await organization.list()
    const first = list.data?.[0]
    if (first) await organization.setActive({ organizationId: first.id })
    router.push("/app/builder")
  }

  return (
    <AuthShell title="登入" subtitle="織雲工作區">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
        <Field label="密碼">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </Field>
        {error ? <p className="text-[12px] text-er">{error}</p> : null}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
          {busy ? "登入中…" : "登入"}
        </Button>
      </form>
      <p className="mt-4 text-[12px] text-ink-3">
        還沒有帳號?
        <Link href="/register" className="text-primary hover:underline">
          建立公司工作區
        </Link>
      </p>
    </AuthShell>
  )
}
