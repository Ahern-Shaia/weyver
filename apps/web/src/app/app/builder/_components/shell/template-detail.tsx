"use client"

import { type TemplateDetail, useTemplateDetail } from "@/lib/engine/hooks"
import { Button } from "@weyver/ui/button"
import { Check, Download, Info, Plus, Share2 } from "lucide-react"
import type { ReactNode } from "react"
import { TemplateDiagram } from "./template-diagram"

/* 🔴 R1·TPL M8|範本詳情。

   查驗(2026-08-07)發現的缺口不是「範本太少」,是**看不懂就不敢裝** ——
   舊版選擇器只有一行被 `truncate` 切掉的說明。範本庫的價值前提是
   「打開就能用」,而使用者得先相信它能用。

   〈套用後會發生什麼〉是**所見即後果**:對不會寫程式的人,按下去之前
   最想知道的不是功能多強,是**會不會弄壞我現在的東西**。 */

function Row({
  tone,
  children,
}: {
  readonly tone: "add" | "keep"
  readonly children: ReactNode
}): ReactNode {
  return (
    <div className="flex gap-2.5 border-line-2 border-b px-3 py-2 text-[12px] leading-relaxed last:border-b-0">
      <span
        className={
          tone === "add"
            ? "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-ok-t text-ok"
            : "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-nt-t text-nt"
        }
      >
        {tone === "add" ? (
          <Plus size={11} strokeWidth={2.6} />
        ) : (
          <Check size={11} strokeWidth={2.6} />
        )}
      </span>
      <span className="text-ink-2">{children}</span>
    </div>
  )
}

function Consequences({ d }: { readonly d: TemplateDetail }): ReactNode {
  return (
    <div className="mt-4 rounded-md border border-line bg-card">
      <div className="flex items-center gap-1.5 border-line-2 border-b px-3 py-2">
        <Info size={13} strokeWidth={1.9} className="text-ink-3" />
        <span className="text-[12px] font-semibold text-ink-2">套用後會發生什麼</span>
      </div>
      <Row tone="add">
        新增 <b className="font-semibold text-ink">{d.forms.length} 張表</b>、
        <b className="font-semibold text-ink">{d.fieldCount} 個欄位</b>,並建立上圖的連結與子表關係。
      </Row>
      {d.categoryName === undefined ? null : (
        <Row tone="keep">
          {d.categoryExists ? (
            <>
              分類「{d.categoryName}」
              <b className="font-semibold text-ink">你已經有了 → 直接放進去</b>
              ,不會多開一個同名分類。
            </>
          ) : (
            <>
              會建立一個新分類「<b className="font-semibold text-ink">{d.categoryName}</b>」。
            </>
          )}
        </Row>
      )}
      <Row tone="keep">
        <b className="font-semibold text-ink">不會動到你現有的任何一張表</b>
        ,也不會改你的角色與權限設定。
      </Row>
      {d.hasLayout ? (
        <Row tone="keep">
          版面已經排好。<span className="text-ink-3">裝完欄位、版面、流程全部可以自己改。</span>
        </Row>
      ) : null}
      {d.hasSampleRows ? (
        <Row tone="keep">
          附示範資料,讓你一打開就看得到東西長怎樣。
          <span className="text-ink-3">要不要帶,下面可以勾。</span>
        </Row>
      ) : null}
    </div>
  )
}

export function TemplateDetailPane({
  templateKey,
  withRecords,
  onWithRecordsChange,
  onApply,
  applying,
}: {
  readonly templateKey: string | null
  readonly withRecords: boolean
  readonly onWithRecordsChange: (v: boolean) => void
  readonly onApply: (key: string) => void
  readonly applying: boolean
}): ReactNode {
  const detail = useTemplateDetail(templateKey)

  if (templateKey === null) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-ink-3">
        從左邊選一個範本,這裡會顯示它會建出哪些表、彼此怎麼連。
      </div>
    )
  }
  if (detail.isPending) {
    return <div className="p-6 text-[12px] text-ink-3">載入範本內容…</div>
  }
  if (detail.data === undefined) {
    return <div className="p-6 text-[12px] text-er">讀不到這個範本的內容。</div>
  }
  const d = detail.data

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <h3 className="text-[16px] font-semibold text-ink">{d.name}</h3>
      <div className="mt-1 text-[12px] text-ink-3">
        {d.categoryName === undefined ? null : <>分類「{d.categoryName}」 · </>}
        {d.forms.length} 張表 / {d.fieldCount} 個欄位 · v{d.version}
        {d.installedVersion === null ? null : <> · 已安裝 v{d.installedVersion}</>}
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">{d.description}</p>

      <div className="mt-4 rounded-md border border-line bg-card">
        <div className="flex items-center gap-1.5 border-line-2 border-b px-3 py-2">
          <Share2 size={13} strokeWidth={1.9} className="text-ink-3" />
          <span className="text-[12px] font-semibold text-ink-2">
            這 {d.forms.length} 張表怎麼連
          </span>
          {/* 這句不是宣傳詞,是一個可稽核的性質:圖從 pack 定義推導 */}
          <span className="ml-auto text-[12px] text-ink-3">由範本定義推導,與實際建出來的一致</span>
        </div>
        <div className="px-3 py-3.5">
          <TemplateDiagram forms={d.forms} />
        </div>
      </div>

      <Consequences d={d} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={applying} onClick={() => onApply(d.key)}>
          <Download size={14} strokeWidth={1.9} />
          {applying ? "套用中…" : "套用到我的工作區"}
        </Button>
        {d.hasSampleRows ? (
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={withRecords}
              onChange={(e) => onWithRecordsChange(e.target.checked)}
              className="accent-(--color-primary)"
            />
            一併帶入示範資料
          </label>
        ) : null}
        <span className="text-[12px] text-ink-3">套用後可從「資源回收桶」還原。</span>
      </div>
    </div>
  )
}
