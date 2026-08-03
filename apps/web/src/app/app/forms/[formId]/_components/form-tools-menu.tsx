"use client"

import { useLabels } from "@/lib/engine/hooks"
import { Download, Radio, Share2, Tags, Upload, Wrench } from "lucide-react"
import Link from "next/link"
import { type ReactNode, useEffect, useRef, useState } from "react"

/* 🔴 R1·IA-1|表單層「工具」聚合入口(docs/33,OQ-IA-1=A / OQ-IA-2=B)。

   **在此之前沒有這個聚合點** —— 使用者得自己記住「匯出在檢視工具列、
   標籤在設計器、公開在設定中心」。Ragic 的心智是**表單就是操作中心**:
   針對這張表的所有事都在這張表上做完。

   **分組用我們自己的三組,不照抄 Ragic 六組**(OQ-IA-2=B):
   我們目前只有 11 項,硬分六組會出現只有一項的組。
   依**動作對象**分:資料進出 / 產出文件 / 對外連結。

   ✅ **第二階段(2026-08-04)**:公開表單與通知的面板已搬進表單層,不再深連設定中心。
   Ragic 設計手冊 doc/71 逐字「在列表頁的**工具**中找到」+「如此一來就不需要進到
   修改設計中調整」;使用手冊 doc-user/12 逐字「表單個別通知 —— 在表單的**工具**
   選單中的同步與通知選擇通知設定」。落點與形態皆有一手依據。 */

interface ToolItem {
  readonly key: string
  readonly label: string
  readonly icon: typeof Wrench
  readonly onSelect?: () => void
  readonly href?: string
  readonly hint?: string
}

const ROW_CLASS =
  "flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[12px] text-ink hover:bg-hover"

function ToolRow({
  item,
  onDone,
}: {
  readonly item: ToolItem
  readonly onDone: () => void
}): ReactNode {
  const Icon = item.icon
  const body = (
    <>
      <Icon size={13} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.hint === undefined ? null : (
        <span className="shrink-0 text-[12px] text-ink-3">{item.hint}</span>
      )}
    </>
  )
  if (item.href !== undefined) {
    return (
      <Link role="menuitem" href={item.href} className={ROW_CLASS} onClick={onDone}>
        {body}
      </Link>
    )
  }
  return (
    <button
      type="button"
      role="menuitem"
      className={ROW_CLASS}
      onClick={() => {
        onDone()
        item.onSelect?.()
      }}
    >
      {body}
    </button>
  )
}

export function FormToolsMenu({
  formId,
  isAdmin,
  onImport,
  onExport,
  onShare,
  onNotify,
}: {
  readonly formId: number
  /* 🔴 公開表單**不是**表單級功能。後端逐字:「開放一張表單給外部人填寫是租戶級的
     安全決定,不是表單級功能 → 限 admin」(`public-form-admin.controller.ts:48`)。
     用設計權當閘門會讓有設計權而非管理員的人看到一個按下去 403 的入口 ——
     那正是剛為 `canDesign` 修掉的「畫面說謊」,在上一層又犯一次。 */
  readonly isAdmin: boolean
  readonly onImport: () => void
  readonly onExport?: (() => void) | undefined
  readonly onShare: () => void
  readonly onNotify: () => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const { data: labels = [] } = useLabels(open ? formId : null)

  /* 點外面 / Esc 關閉 —— 選單沒有這兩條就會變成擋住畫面的東西 */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const groups: { title: string; items: ToolItem[] }[] = [
    {
      title: "資料",
      items: [
        { key: "import", label: "匯入資料", icon: Upload, onSelect: onImport },
        ...(onExport === undefined
          ? []
          : [
              {
                key: "export",
                label: "匯出 Excel",
                icon: Download,
                onSelect: onExport,
                /* 誠實標注範圍 —— 使用者以為是全部,拿到的卻只有畫面上那些,
                   那是最糟的一種「看起來成功了」 */
                hint: "僅含已載入的資料",
              },
            ]),
      ],
    },
    {
      title: "產出",
      items: labels.map((l) => ({
        key: `label-${String(l.id)}`,
        label: `列印標籤:${l.name}`,
        icon: Tags,
        href: `/app/forms/${String(formId)}/labels/${String(l.id)}/print`,
      })),
    },
    {
      title: "連外",
      /* 🔴 `docs/33` P4 原文要求兩項都改由該表單的 `design` 權把關 —— **P4 推導錯了**。
         它假設「原本在 admin 頁面裡」就等於「該用設計權」,而真正的判準是
         **這件事的粒度與擁有者**:租戶級安全決定 → admin;個人訂閱 → 本人。
         詳見 `workspace-ia.md` §14.1 發現 3。 */
      items: [
        ...(isAdmin
          ? [{ key: "public", label: "公開表單設定", icon: Share2, onSelect: onShare }]
          : []),
        /* 通知**不設閘門**:`notification_pref` 帶 actor_id,是個人訂閱不是表單設定。
           擋在 design 之後等於一般使用者管不了自己的通知。 */
        { key: "notify", label: "此表單的通知", icon: Radio, onSelect: onNotify },
      ],
    },
  ].filter((g) => g.items.length > 0)

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-xs px-2.5 py-1 text-[12px] text-ink-3 hover:bg-hover hover:text-primary"
      >
        <Wrench size={13} />
        工具
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="表單工具"
          className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-line bg-card py-1 shadow-overlay"
        >
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-2.5 pt-1.5 pb-0.5 text-[12px] text-ink-3">{g.title}</div>
              {g.items.map((item) => (
                <ToolRow key={item.key} item={item} onDone={() => setOpen(false)} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
