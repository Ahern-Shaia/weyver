"use client"

import { CHIP_TONES, type ChipTone, StatusChip } from "@weyver/ui/status-chip"
import type { ReactNode } from "react"

import type { FormatRule, Section } from "@/lib/engine/schemas"

/* R1·UP-3b C-2|一條規則「做什麼」——目標(欄位 / 分段)與效果(隱藏 / 唯讀 / 訊息 / 顏色)。

   自 `conditional-format.tsx` 拆出:該檔在加入分段與訊息之前已 411 行,
   而規則清單 / 頁籤 / 即時預覽與「這條規則做什麼」是兩件會分開改的事。 */

export const TONE_LABEL: Partial<Record<ChipTone, string>> = {
  ok: "完成",
  warn: "待辦",
  error: "異常",
  neutral: "中性",
}

export function toneOf(rule: FormatRule): ChipTone {
  return rule.effects.reduce<ChipTone>((acc, e) => (e.kind === "color" ? e.tone : acc), "neutral")
}

function withTone(rule: FormatRule, tone: ChipTone): Partial<FormatRule> {
  const rest = rule.effects.filter((e) => e.kind !== "color")
  return { effects: [...rest, { kind: "color", tone }] }
}

function toggleEffect(rule: FormatRule, kind: "hide" | "readonly"): Partial<FormatRule> {
  const has = rule.effects.some((e) => e.kind === kind)
  const next = has
    ? rule.effects.filter((e) => e.kind !== kind)
    : [...rule.effects, { kind } as const]
  /* 規則至少要有一個效果(schema `min(1)`)—— 全關掉時退回無色的中性,
     而不是讓使用者存下一條會被後端擋掉的規則。 */
  return { effects: next.length > 0 ? next : [{ kind: "color", tone: "neutral" }] }
}

function messageOf(rule: FormatRule): string | null {
  for (const e of rule.effects) if (e.kind === "message") return e.text
  return null
}

function withMessage(rule: FormatRule, text: string): Partial<FormatRule> {
  const rest = rule.effects.filter((e) => e.kind !== "message")
  const next = text.trim() === "" ? rest : [...rest, { kind: "message" as const, text }]
  return { effects: next.length > 0 ? next : [{ kind: "color", tone: "neutral" }] }
}

function Chip({
  on,
  onClick,
  children,
}: {
  readonly on: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-xs border px-1.5 py-0.5 text-[12px] ${
        on ? "border-primary bg-primary-t text-primary" : "border-line text-ink-3"
      }`}
    >
      {children}
    </button>
  )
}

export function RuleEffects({
  rule,
  fieldNames,
  sections,
  face,
  patch,
}: {
  readonly rule: FormatRule
  readonly fieldNames: readonly string[]
  readonly sections: readonly Section[]
  readonly face: "record" | "list"
  readonly patch: (next: Partial<FormatRule>) => void
}): ReactNode {
  const targetSections = rule.targetSections
  const message = messageOf(rule)

  return (
    <>
      <div className="mt-3">
        <div className="mb-1 text-[12px] text-ink-3">套用到哪些欄位(不選 = 條件所涉之欄位)</div>
        <div className="flex flex-wrap gap-1">
          {fieldNames.map((n) => (
            <Chip
              key={n}
              on={rule.targets.includes(n)}
              onClick={() =>
                patch({
                  targets: rule.targets.includes(n)
                    ? rule.targets.filter((t) => t !== n)
                    : [...rule.targets, n],
                })
              }
            >
              {n}
            </Chip>
          ))}
        </div>
      </div>

      {/* 🔴 分段是**目標選擇器**不是效果(OQ-CF-9)。官方逐字:把相關欄位設成同一分段後
          「再透過條件式格式一次設定,就無需逐一針對各欄位進行設定」。 */}
      {sections.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 text-[12px] text-ink-3">或整段套用(與上面的欄位併集)</div>
          <div className="flex flex-wrap gap-1">
            {sections.map((s) => (
              <Chip
                key={s.id}
                on={targetSections.includes(s.id)}
                onClick={() =>
                  patch({
                    targetSections: targetSections.includes(s.id)
                      ? targetSections.filter((t) => t !== s.id)
                      : [...targetSections, s.id],
                  })
                }
              >
                {s.name === "" ? s.id : s.name}
              </Chip>
            ))}
          </div>
          {/* 官方逐字的注意事項 —— 不講的話使用者會以為整段都鎖住了 */}
          <p className="mt-1 text-[12px] text-ink-3">
            上鎖分段 = 該段欄位設為唯讀;段內的動作按鈕不受影響,需另外設定。
          </p>
        </div>
      ) : null}

      <div className="mt-3">
        {/* 🔴 C-2:效果種類。**加 schema 的同一批就要加寫入端** ——
            否則就是又造一個「欄位存在、沒人寫得進去」的陷阱,
            而 form-designer-2d 的 colWidths 剛因為同一個理由被移除。 */}
        <div className="mb-1 text-[12px] text-ink-3">效果(可複選)</div>
        <div className="mb-2 flex flex-wrap gap-1">
          {(["hide", "readonly"] as const).map((kind) => (
            <Chip
              key={kind}
              on={rule.effects.some((e) => e.kind === kind)}
              onClick={() => patch(toggleEffect(rule, kind))}
            >
              {kind === "hide" ? "隱藏欄位" : "設為唯讀"}
            </Chip>
          ))}
        </div>
        {/* 隱藏不是權限 —— Ragic / Airtable 官方都明文警告過,這裡照講 */}
        <p className="mb-2 text-[12px] text-ink-3">
          隱藏與唯讀為版面層效果,擋不住 API。欄位級保護請用權限設定。
        </p>

        {/* 🔴 訊息是**規則層**效果,不落在任何欄位上;列表頁一列一則訊息沒有意義,故不提供 */}
        {face === "record" ? (
          <div className="mb-3">
            <label className="mb-1 block text-[12px] text-ink-3" htmlFor="cf-message">
              條件成立時顯示訊息
            </label>
            <input
              id="cf-message"
              value={message ?? ""}
              maxLength={500}
              placeholder="例:{{fieldValue:狀態}} 需經主管核可"
              onChange={(e) => patch(withMessage(rule, e.target.value))}
              className="w-full rounded-xs border border-line bg-card px-1.5 py-1 text-[12px]"
            />
            <p className="mt-1 text-[12px] text-ink-3">
              可帶入 {"{{fieldValue:欄名}}"} 與 {"{{fieldName:欄名}}"};訊息以純文字顯示。
            </p>
          </div>
        ) : null}

        <div className="mb-1 text-[12px] text-ink-3">顏色(12 色受控色盤)</div>
        <div className="flex flex-wrap gap-1">
          {CHIP_TONES.map((tone: ChipTone) => (
            <button
              key={tone}
              type="button"
              onClick={() => patch(withTone(rule, tone))}
              aria-label={`顏色 ${tone}`}
              className={toneOf(rule) === tone ? "outline-2 outline-primary outline-offset-1" : ""}
            >
              <StatusChip tone={tone}>{TONE_LABEL[tone] ?? tone}</StatusChip>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
