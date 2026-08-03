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

   ⚠️ **這是第一階段:入口聚合**。公開表單與通知設定的**面板本身**仍住在
   設定中心(它們與收件匣 / 租戶級偏好混在同一頁,乾淨拆出是另一段重構),
   此處帶著表單參數深連過去 —— 已消除「離開表單後還要把同一張表再選一次」,
   但「不必離開表單」要等第二階段。**不是雙入口**:設定只有一份,這裡是捷徑。 */

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
  canDesign,
  onImport,
  onExport,
}: {
  readonly formId: number
  readonly canDesign: boolean
  readonly onImport: () => void
  readonly onExport?: (() => void) | undefined
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
      /* 🔴 OQ-IA-3 之權限硬約束(docs/33 P4):這兩項原本受設定中心的 admin 閘門
         保護,搬到表單層之後必須改由**該表單的 design 權**把關 ——
         否則任何看得到表單的人都看得到公開設定的入口。 */
      items: canDesign
        ? [
            {
              key: "public",
              label: "公開表單設定",
              icon: Share2,
              href: `/app/settings/public-forms?form=${String(formId)}`,
            },
            {
              key: "notify",
              label: "此表單的通知設定",
              icon: Radio,
              href: `/app/settings/notifications?form=${String(formId)}`,
            },
          ]
        : [],
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
