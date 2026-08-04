import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.2|全框線欄位表:label 灰底靠右 112px + 值格,每格四邊 --color-cell 框線 */
export interface FieldItem {
  readonly label: ReactNode
  readonly value: ReactNode
  readonly required?: boolean
  /* 傳字串 = 把說明文字掛在 `?` 上(title + aria-label);傳 `true` = 只有記號沒有內容。
     🔴 2026-08-03:原本只收 boolean —— 設計器讓使用者打了說明文字,填單卻只渲染
     一個點不出東西的 `?`。**有記號沒內容比沒有記號更糟**,使用者會一直找那段說明。 */
  readonly help?: boolean | string
  readonly mono?: boolean
  readonly note?: ReactNode
  /* 🔴 不要外包 `<label>`。兩種情況要設 true:
     1. 值格**自己已經有 `<label>`**(附件 / 圖片 / 簽名的「選擇檔案」);
     2. 值格根本沒有輸入(設計器畫布的預覽格)—— 包了只是多一層 DOM,
        而點擊會被解讀成「啟用格子裡的控件」,與拖拉選取打架。

     外層再包一層 `<label>` 會產生**巢狀 label** —— 那是無效 HTML,
     瀏覽器對「點擊要開哪一個檔案選擇器」的解讀不一致,實測會讓上傳整個失效。
     ⚠️ 這一條是 2026-08-04 實走量出來的:M0 只預見了「label 只關聯第一個控件」,
     **沒預見巢狀**;4 支上傳相關的 spec 同時紅才浮現。 */
  readonly noLabelWrap?: boolean
}

export interface FieldGridProps {
  readonly items: readonly FieldItem[]
  readonly columns?: 1 | 2
  readonly className?: string
}

export function FieldGrid({ items, columns = 2, className }: FieldGridProps): ReactElement {
  return (
    <div
      className={cn(
        "grid",
        columns === 2 ? "grid-cols-[112px_1fr_112px_1fr]" : "grid-cols-[112px_1fr]",
        className,
      )}
    >
      {items.map((item, index) => (
        <FieldCells
          key={typeof item.label === "string" ? item.label : `field-${index}`}
          item={item}
          columns={columns}
          index={index}
          total={items.length}
        />
      ))}
    </div>
  )
}

/* 🔴 R1·UP-3c M1|把「一個欄位＝label 格 + 值格」抽成可共用原件。

   Ragic 官方逐字:「**一個欄位會佔兩格儲存格的空間,左邊是欄位名稱(也稱為欄位標頭),
   右邊是欄位值**」—— 這一對就是表單的最小單位。

   ⚠️ **共用的是「格子」不是「容器」**。OQ-FDW-2=A 原文寫「完全共用 FieldGrid」,
   實作時發現兩者**排版模型不同**:填單是流式(items 依序),設計畫布是 12 欄座標
   定位(row/col/span)。硬套會弄壞座標系統。故共用降到**格子層** ——
   視覺語言不會漂移(那是「設計即所見」的價值所在),各自保有排版模型。
   此為對 OQ-FDW-2 的實作層修正,已記錄於 M0。 */
export function FieldCellPair({
  item,
  borderB = true,
  borderR = true,
  flush = false,
}: {
  readonly item: FieldItem
  readonly borderB?: boolean
  readonly borderR?: boolean
  /* flush:值格不留內距,交給裡面的輸入元件自己撐滿(填單用)。
     不 flush 時值格自帶內距(檢視用),否則文字會貼著框線。 */
  readonly flush?: boolean
}): ReactElement {
  return <Cells item={item} borderB={borderB ? "border-b" : ""} isRowEnd={!borderR} flush={flush} />
}

function FieldCells({
  item,
  columns,
  index,
  total,
}: {
  readonly item: FieldItem
  readonly columns: 1 | 2
  readonly index: number
  readonly total: number
}): ReactElement {
  const perRow = columns
  const lastRowStart = total - (total % perRow || perRow)
  const isLastRow = index >= lastRowStart
  const isRowEnd = (index + 1) % perRow === 0 || index === total - 1
  return (
    <Cells item={item} borderB={isLastRow ? "" : "border-b"} isRowEnd={isRowEnd} flush={false} />
  )
}

/* 退回 Fragment 的兩種情況見 `FieldItem.noLabelWrap`。 */
function Wrap({
  noLabelWrap,
  children,
}: {
  readonly noLabelWrap: boolean
  readonly children: ReactNode
}): ReactElement {
  if (noLabelWrap) return <>{children}</>
  /* biome-ignore lint/a11y/noLabelWithoutControl: 控件由 `children` 傳入,靜態分析看不進去。
     `noLabelWrap` 正是「裡面沒有控件」那一種情況的出口,判斷在呼叫端。 */
  return <label style={{ display: "contents" }}>{children}</label>
}

function Cells({
  item,
  borderB,
  isRowEnd,
  flush,
}: {
  readonly item: FieldItem
  readonly borderB: string
  readonly isRowEnd: boolean
  readonly flush: boolean
}): ReactElement {
  return (
    /* 🔴 R1·A11Y|`<label>` 把**看得見的欄名**與輸入框關聯起來。

       在此之前欄名只是旁邊的一個 `div` —— 視覺上是標籤,在無障礙樹上什麼都不是,
       螢幕閱讀器只會唸「編輯文字」(WCAG 4.1.2)。
       這件事是做 `link-picker` 時 **e2e 找不到穩定錨點**才浮現的
       —— 測試找不到,通常代表使用者也找不到。

       **為什麼是 `display: contents`**|label 格與值格是外層 grid 的兩個直接子項,
       中間包一層普通元素會把它們變成「一個子項」而弄壞版面。
       `display:contents` 讓 `<label>` 自己不產生框、子元素照樣直接參與外層 grid。

       ⚠️ **量測過才用**:曾有「`display:contents` 會把元素移出無障礙樹」的說法,
       實測(2026-08-04,Chromium)名稱與**點欄名聚焦**都成立。
       選它而不是 `aria-labelledby` 正是為了後者 —— 而且不必為每個欄位產 id。
       ⚠️ Firefox / Safari **未量**(FMEA A4)。

       ⚠️ `<label>` 只關聯**第一個**表單控件 —— 值格內含多個控件者
       (連結欄的「搜尋框 + 下拉」)自帶 `aria-label`,不依賴這一層。 */
    <Wrap noLabelWrap={item.noLabelWrap === true}>
      <div
        className={cn(
          "flex min-h-[32px] min-w-0 items-center justify-end gap-[3px] border-cell border-r bg-label px-2.5 py-[5px] text-right text-[12px] text-ink-2",
          borderB,
        )}
      >
        {/* 🔴 `aria-hidden`:`*` 與 `?` 是**視覺記號**,不該混進欄位的無障礙名稱。

            它們在 `<label>` 裡面,而 `<label>` 的名稱取自**文字內容** ——
            不擋的話螢幕閱讀器唸出來的是「星號 品名 說明:…」,而不是「品名」。
            2026-08-04 由 e2e 的 `getByLabel("品名", { exact: true })` 抓不到而浮現。

            ⚠️ **必填性不該靠一個星號傳達** —— 那是視覺慣例,無障礙樹上要看的是
            輸入本身的 `required` / `aria-required`。目前欄位輸入**尚未帶該屬性**,
            列為殘留(見模組文件 FMEA)。此處先確保名稱乾淨,不讓記號污染它。

            ⚠️ **說明鈕(`?`)刻意不 `aria-hidden`** —— 它的 `aria-label` 是說明文字
            唯一被曝露的地方(`designer.spec` 有專門的斷言)。
            代價是**有說明的欄位,其名稱會變成「品名 說明:…」** ——
            正解是把說明改掛 `aria-describedby` 到輸入本身(description ≠ name),
            但那需要為每個欄位產 id 並穿到輸入元件,超出本模組範圍,**列殘留**。
            ⚠️ 2026-08-04 我一度把它也 `aria-hidden` 掉,那違反了本模組 M0 §1.2
            自己寫的「不動說明鈕」,並讓說明文字變成不可及 —— 已還原。 */}
        {item.required ? (
          <span aria-hidden="true" className="font-semibold text-er">
            *
          </span>
        ) : null}
        {item.label}
        {item.help ? (
          <span
            className="inline-flex size-3 cursor-help items-center justify-center rounded-full border border-line-2 text-[12px] text-ink-3"
            {...(typeof item.help === "string"
              ? { title: item.help, "aria-label": `說明:${item.help}` }
              : {})}
          >
            ?
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          /* min-w-0:grid 項目預設 min-width:auto,不加就撐破格子 —— 長文字會溢出到隔壁欄 */
          "flex min-h-[32px] min-w-0 items-center gap-1.5 border-cell bg-card text-[13px]",
          flush ? "" : "px-2.5 py-[5px]",
          borderB,
          isRowEnd ? "" : "border-r",
          item.mono && "font-mono tabular-nums",
        )}
      >
        {item.value}
        {item.note ? <span className="text-[12px] text-ink-3">{item.note}</span> : null}
      </div>
    </Wrap>
  )
}
