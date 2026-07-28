import type { HTMLAttributes, ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 §3.7 / §0.1|帶框方形狀態章(字/框/底三值),文字必有;禁 pill、禁裝飾圓點。

   **兩類色,語意不同(R1·UP-4c)**
   - **狀態色**(`StatusTone`:ok / warn / error / neutral)—— 承載語意。
     資訊設計(§0.1):**要行動**的狀態(待審 warn / 退回 error)留語意色;
     **已了結 / settled**(已核准 / 已收貨 / 完成)用 `neutral` 退到背景,不用 ok 綠 ——
     讓注意力導向該處理的,而非一片綠與待辦爭注意力。
   - **類別色**(`c1`–`c8`)—— **不帶語意**,只做類別編碼(如 北區/中區/南區),
     等同圖表之 categorical color;刻意避開綠/琥珀/紅以免與狀態語意混淆。

   ⚠️ `toneClass` 同時是**安全白名單**:Tailwind 無法由動態字串產生 class,而 tone 來自
   使用者可設定的欄位 options → 一律查表,查無退 `neutral`,絕不拼接字串進 className。 */
export type StatusTone = "ok" | "warn" | "error" | "neutral"
export type CategoryTone = "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "c7" | "c8"
export type ChipTone = StatusTone | CategoryTone

const toneClass: Record<ChipTone, string> = {
  ok: "text-ok border-ok-line bg-ok-t",
  warn: "text-wn border-wn-line bg-wn-t",
  error: "text-er border-er-line bg-er-t",
  neutral: "text-nt border-nt-line bg-nt-t",
  c1: "text-c1 border-c1-line bg-c1-t",
  c2: "text-c2 border-c2-line bg-c2-t",
  c3: "text-c3 border-c3-line bg-c3-t",
  c4: "text-c4 border-c4-line bg-c4-t",
  c5: "text-c5 border-c5-line bg-c5-t",
  c6: "text-c6 border-c6-line bg-c6-t",
  c7: "text-c7 border-c7-line bg-c7-t",
  c8: "text-c8 border-c8-line bg-c8-t",
}

/* 只要文字色的場合(如欄位標題著色)。同為靜態白名單 —— Tailwind 無法由動態字串產生 class,
   且 tone 來自使用者設定,一律查表。 */
const toneTextClass: Record<ChipTone, string> = {
  ok: "text-ok",
  warn: "text-wn",
  error: "text-er",
  neutral: "text-nt",
  c1: "text-c1",
  c2: "text-c2",
  c3: "text-c3",
  c4: "text-c4",
  c5: "text-c5",
  c6: "text-c6",
  c7: "text-c7",
  c8: "text-c8",
}

export function chipToneTextClass(tone: string | undefined): string {
  return toneTextClass[tone as ChipTone] ?? ""
}

export const CHIP_TONES: readonly ChipTone[] = Object.keys(toneClass) as ChipTone[]

/* 未知 / 未設定一律 neutral(白名單兜底) */
export function chipToneClass(tone: string | undefined): string {
  return toneClass[tone as ChipTone] ?? toneClass.neutral
}

export function isChipTone(value: unknown): value is ChipTone {
  return typeof value === "string" && value in toneClass
}

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: ChipTone
}

export function StatusChip({
  tone = "neutral",
  className,
  children,
  ...props
}: StatusChipProps): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex h-[17px] items-center gap-1 rounded-xs border px-[5px] text-[10.5px] font-medium",
        chipToneClass(tone),
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
