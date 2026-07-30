"use client"
import { Lock, Plus, Search, Table2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useCategories, useForms } from "@/lib/engine/hooks"
import { SETTINGS_NAV } from "./settings-nav"

/* R1·UP-1 ⌘K 導航搜尋(client-side,資料源=三態 forms list → 零後端、零洩漏)。
   表單(含分類徽章)/ 固定動作即時過濾;↑↓↵ 鍵盤。跨表記錄搜尋歸 views-list/P1-I。 */
interface Item {
  readonly key: string
  readonly label: string
  readonly hint?: string | undefined
  readonly icon: ReactNode
  readonly href: string
}

export function CommandPalette(): ReactNode {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: forms } = useForms()
  const { data: cats } = useCategories()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQ("")
      setSel(0)
      queueMicrotask(() => inputRef.current?.focus())
    }
  }, [open])

  const catName = useMemo(() => new Map((cats ?? []).map((c) => [c.id, c.name])), [cats])

  const items = useMemo<Item[]>(() => {
    /* 🔴 設定頁全數列入 —— rail 收斂後這是它們唯一的「一次操作」路徑。 */
    const actions: Item[] = [
      { key: "new", label: "新增表單", icon: <Plus size={15} />, href: "/app/builder" },
      ...SETTINGS_NAV.map((s) => ({
        key: `set-${s.href}`,
        label: s.label,
        hint: "設定",
        icon: <s.icon size={15} />,
        href: s.href,
      })),
    ]
    const formItems: Item[] = (forms ?? [])
      .filter((f) => f.parentFormId === null && !f.locked)
      .map((f) => ({
        key: `form-${f.id}`,
        label: f.name,
        hint: f.categoryId != null ? (catName.get(f.categoryId) ?? undefined) : undefined,
        icon: f.locked ? <Lock size={14} /> : <Table2 size={15} />,
        href: `/app/forms/${f.id}`,
      }))
    return [...formItems, ...actions]
  }, [forms, catName])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter(
      (i) => i.label.toLowerCase().includes(s) || (i.hint ?? "").toLowerCase().includes(s),
    )
  }, [items, q])

  const go = (i: Item | undefined): void => {
    if (!i) return
    setOpen(false)
    router.push(i.href)
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[12vh]">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 cursor-default"
        onClick={() => setOpen(false)}
      />
      <div className="relative w-full max-w-xl overflow-hidden rounded-lg border border-line bg-card shadow-lg">
        <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
          <Search size={16} className="text-ink-4" strokeWidth={1.9} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, filtered.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                go(filtered[sel])
              }
            }}
            placeholder="搜尋表單、動作…"
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
          />
          <kbd className="rounded-xs border border-line px-1.5 font-mono text-[10px] text-ink-4">
            ⌘K
          </kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-ink-4">無相符結果</div>
          ) : (
            filtered.map((i, n) => (
              <button
                type="button"
                key={i.key}
                onMouseEnter={() => setSel(n)}
                onClick={() => go(i)}
                className={
                  n === sel
                    ? "flex w-full items-center gap-3 bg-primary-t px-3.5 py-2 text-left"
                    : "flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-head"
                }
              >
                <span className="text-ink-4">{i.icon}</span>
                <span className="flex-1 truncate text-[12.5px] text-ink">{i.label}</span>
                {i.hint ? (
                  <span className="rounded-xs border border-line bg-label px-1.5 font-mono text-[10px] text-ink-4">
                    {i.hint}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
