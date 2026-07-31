"use client"
import { FileText, Lock, Plus, Search, Table2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { BusyBar } from "@/components/busy-indicator"
import { useCategories, useForms } from "@/lib/engine/hooks"
import { recordHref, useDebounced, useRecordSearch } from "@/lib/engine/use-search"
import { SETTINGS_NAV } from "./settings-nav"

/* R1·UP-1 ⌘K 導航搜尋 + **R1·H-3 M4 跨表記錄搜尋**。

   兩段資料源刻意分開:
   · **導航**(表單 / 設定 / 動作)—— client-side 過濾既有 forms list,零往返、零洩漏
   · **記錄**(跨表全文)—— 後端 `/search`,權限 pre-filter 寫在 WHERE(見 search.service.ts)

   ## 為什麼記錄結果**接在導覽項之後**而非混排

   `sel` 是扁平索引。導覽結果同步算出,記錄結果 220ms 後才到 —— 若混排,新結果插進中間
   會讓「選取中的那一列」在使用者眼下換成另一個項目,按 Enter 就去錯地方。
   一律 append 於尾端 → 既有索引不變,視覺上也不推擠已渲染的內容。 */
interface Item {
  readonly key: string
  readonly label: string
  readonly hint?: string | undefined
  /* 記錄結果用:命中欄位名,置於 label 前作為弱化前綴 */
  readonly prefix?: string | undefined
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

  const navItems = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter(
      (i) => i.label.toLowerCase().includes(s) || (i.hint ?? "").toLowerCase().includes(s),
    )
  }, [items, q])

  /* 記錄搜尋:debounce 後才送(門檻與理由見 use-search.ts) */
  const debouncedQ = useDebounced(q)
  const { hits, truncated, isFetching } = useRecordSearch(debouncedQ, open)

  const recordItems = useMemo<Item[]>(() => {
    /* 同一筆記錄可能多欄命中 —— 後端已依分數排序,故取第一個即最相關的那一欄。
       一筆記錄只佔一列,否則同一張單的多欄命中會洗掉整個清單。 */
    const seen = new Set<string>()
    const out: Item[] = []
    for (const h of hits) {
      const id = `${String(h.formId)}-${String(h.recordId)}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({
        key: `rec-${id}`,
        label: h.snippet,
        prefix: h.fieldName,
        hint: h.formName,
        icon: <FileText size={15} />,
        href: recordHref(h.formId, h.recordId),
      })
    }
    return out
  }, [hits])

  const filtered = useMemo(() => [...navItems, ...recordItems], [navItems, recordItems])

  /* 清單縮短(記錄結果收掉)時把選取夾回範圍內,否則高亮會整個消失 */
  useEffect(() => {
    setSel((s) => (s >= filtered.length ? Math.max(0, filtered.length - 1) : s))
  }, [filtered.length])

  /* 選取列捲入可視範圍 —— 記錄結果讓清單可能超出容器高度,
     沒有這段的話 ↓ 到底部時焦點列會消失在畫面外。 */
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [sel])

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
        <div className="relative flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
          <Search size={16} className="text-ink-3" strokeWidth={1.9} />
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
            placeholder="搜尋表單、記錄、設定…"
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded-xs border border-line px-1.5 font-mono text-[12px] text-ink-3">
            ⌘K
          </kbd>
          {/* 記錄搜尋往返中 —— absolute 不佔版面流(FMEA U8) */}
          <BusyBar busy={isFetching} />
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {navItems.map((i, n) => (
            <Row key={i.key} item={i} selected={n === sel} onHover={() => setSel(n)} onGo={go} />
          ))}
          {recordItems.length > 0 ? (
            /* 分隔線只在**上方真的有導覽項**時才畫 —— 否則會與輸入框的下框線疊成兩條 */
            <div
              className={`px-3.5 pb-1 text-[12px] text-ink-3 ${
                navItems.length > 0 ? "mt-1 border-t border-line pt-2" : "pt-1"
              }`}
            >
              記錄
            </div>
          ) : null}
          {recordItems.map((i, n) => {
            const idx = navItems.length + n
            return (
              <Row
                key={i.key}
                item={i}
                selected={idx === sel}
                onHover={() => setSel(idx)}
                onGo={go}
              />
            )
          })}
          {truncated ? (
            <div className="px-3.5 py-2 text-[12px] text-ink-3">結果過多,請縮小搜尋範圍</div>
          ) : null}
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-ink-3">
              {isFetching ? "搜尋中…" : "無相符結果"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Row({
  item,
  selected,
  onHover,
  onGo,
}: {
  readonly item: Item
  readonly selected: boolean
  readonly onHover: () => void
  readonly onGo: (i: Item) => void
}): ReactNode {
  return (
    <button
      type="button"
      data-selected={selected}
      onMouseEnter={onHover}
      onClick={() => onGo(item)}
      className={
        selected
          ? "flex w-full items-center gap-3 bg-primary-t px-3.5 py-2 text-left"
          : "flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-head"
      }
    >
      <span className="text-ink-3">{item.icon}</span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        {item.prefix ? (
          <span className="shrink-0 text-[12px] text-ink-3">{item.prefix}</span>
        ) : null}
        <span className="truncate text-[13px] text-ink">{item.label}</span>
      </span>
      {item.hint ? (
        <span className="shrink-0 rounded-xs border border-line bg-label px-1.5 font-mono text-[12px] text-ink-3">
          {item.hint}
        </span>
      ) : null}
    </button>
  )
}
