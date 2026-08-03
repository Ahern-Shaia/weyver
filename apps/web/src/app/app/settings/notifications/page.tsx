"use client"

import {
  useCategories,
  useClearNotificationPref,
  useForms,
  useNotificationSettings,
  useSaveNotificationPref,
  useSaveNotificationSettings,
} from "@/lib/engine/hooks"
import { NOTIFICATION_LEVELS, resolveClientLevel } from "@/lib/engine/notification-levels"
import { NotificationLevelPicker } from "@/components/notification-level-picker"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import Link from "next/link"
import { type ReactNode, useState } from "react"
import { BusyBar, FirstLoad } from "@/components/busy-indicator"

/* H-1 M4 通知設定(docs/mockups/notification-flow.html 步驟 4-5)。

   **三軸分離**|軸 0 總開關(要不要收)· 軸 1 **層級**(收多少)· 軸 2 **通道**(從哪收)。
   v0.3 曾把「收多少」與「與我相關」混在同一排勾選框,是維度錯置(OQ-NT-15)。

   軸 1 為**單一有序 enum** 而非獨立布林開關:GitHub / GitLab / Discourse / Zulip /
   Notion / Slack / Teams / Linear 無一例外皆如此,且查不到任何系統從 enum 退回
   獨立開關。有序才可繼承(全域 → 分類 → 表單,最具體者勝)。

   🔴 **R1·IA 第二階段(2026-08-04)**:軸 1 的表單那一層原本是一個「選一張表單」的
   下拉 —— 那正是 `docs/33 §2.1` 記載的 IA 錯位。現在改成**逐表單列出**,對齊
   Ragic 使用手冊 doc-user/12 的「頁籤個別設定」(選頁籤 → 列出頁籤中的個別表單)。
   單張表單的調整已可在表單的「工具 › 此表單的通知」就地完成;
   留在這裡的是**清單才做得到、下拉做不到的事** —— 一次調整我對多張表單的訂閱。 */

/* P0 只有 4 檔可選 + 繼承。研究建議的「只有被提及」需 @提及,而 Weyver
   尚無註解功能 —— 不做無法運作的檔位(同「不做假開關」原則)。
   「自訂」(level 40)待事件加選 UI,P0 不出。 */

const EVENTS = [
  { code: "approval.pending", label: "待我簽核" },
  { code: "approval.approved", label: "簽核核准" },
  { code: "approval.rejected", label: "簽核駁回" },
  { code: "record.created", label: "新資料建立" },
  { code: "record.updated", label: "資料變更" },
] as const

export default function NotificationSettingsPage(): ReactNode {
  const { data, isLoading } = useNotificationSettings()
  const { data: forms } = useForms()
  const { data: categories } = useCategories()
  const saveSettings = useSaveNotificationSettings()
  const savePref = useSaveNotificationPref()
  const clearPref = useClearNotificationPref()
  /* 🔴 dev 實走時這份清單有數十張表單,平鋪等於捲不完 —— 而這是**每個租戶
     用久了都會到的狀態**,不是測試資料的特例。Ragic 用「先選頁籤」縮小範圍;
     我們用分類分組 + 名稱篩選達到同一件事,而不再引入一個選一張表單的下拉。 */
  const [q, setQ] = useState("")

  /* 只有「完全沒有資料可顯示」才佔位(同時讓 TS 收窄);
     後續重取由 BusyBar 表示,內容保留不塌陷 */
  if (data === undefined) return <FirstLoad />

  const enabled = data.enabled
  const tenantLevel = resolveClientLevel(data.prefs, null).level
  const levelName = (v: number): string =>
    NOTIFICATION_LEVELS.find((l) => l.value === v)?.name ?? String(v)

  const keyword = q.trim()
  const matched = (forms ?? []).filter((f) => keyword === "" || f.name.includes(keyword))
  /* 有覆寫的排前面 —— 「我目前設了哪些」是這一段最常被問的問題;
     其餘依分類分組,未分類者歸「未分類」。 */
  const groups = [
    ...(categories ?? []).map((c) => ({
      key: `c${String(c.id)}`,
      name: c.name,
      forms: matched.filter((f) => f.categoryId === c.id),
    })),
    { key: "none", name: "未分類", forms: matched.filter((f) => (f.categoryId ?? null) === null) },
  ].filter((g) => g.forms.length > 0)

  const emailOn = (code: string): boolean => {
    const chosen = data.channels?.[code]
    return chosen === undefined ? true : chosen.includes("email")
  }

  const toggleEmail = (code: string): void => {
    const next: Record<string, string[]> = { ...(data.channels ?? {}) }
    next[code] = emailOn(code) ? ["inapp"] : ["inapp", "email"]
    saveSettings.mutate({ enabled, channels: next })
  }

  /* 只有「完全沒有資料可顯示」才佔位;後續重取由 BusyBar 表示,內容保留不塌陷 */

  return (
    <div className="relative mx-auto max-w-[720px] p-6">
      <BusyBar busy={isLoading} />
      <h2 className="text-[16px] font-semibold">通知設定</h2>
      <p className="mt-1 text-[12px] text-ink-3">設定要接收哪些通知,以及用什麼方式接收。</p>

      {/* 軸 0 */}
      <section className="mt-5 border border-line-2">
        <div className="flex items-center gap-2 border-b border-line-2 bg-label px-2.5 py-2 text-[12px] font-semibold">
          <span className="font-mono text-[12px] text-ink-3">軸 0</span>接收通知
        </div>
        <div className="p-2.5">
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => saveSettings.mutate({ enabled: !enabled, channels: data.channels })}
              className="size-[13px] accent-primary"
            />
            <span className="text-[12px] font-medium">{enabled ? "開啟" : "已停止"}</span>
            <span className="ml-auto text-[12px] text-ink-3">
              關閉後將不會收到任何通知,下方設定一併停用
            </span>
          </label>
          {/* 裁定 ④:逾期豁免總開關。**必須明白告知** —— 靜默的例外會讓使用者以為設定壞了 */}
          <div className="mt-2 border border-warn-line bg-warn-t px-2.5 py-1.5 text-[12px] text-warn">
            簽核逾期提醒為例外,停止接收期間仍會發送。
          </div>
        </div>
      </section>

      {/* 軸 1 */}
      <section className={`mt-2.5 border border-line-2 ${enabled ? "" : "opacity-40"}`}>
        <div className="flex items-center gap-2 border-b border-line-2 bg-label px-2.5 py-2 text-[12px] font-semibold">
          <span className="font-mono text-[12px] text-ink-3">軸 1</span>通知層級
          <span className="ml-auto text-[12px] font-normal text-ink-3">
            每張表單一個層級,未設定則繼承全租戶預設
          </span>
        </div>
        <div className="p-2.5">
          <div className="mb-1.5 text-[12px] font-medium text-ink-2">全租戶預設</div>
          <NotificationLevelPicker
            value={tenantLevel}
            disabled={!enabled}
            onPick={(lv) =>
              savePref.mutate({ scope: "tenant", scopeId: null, level: lv, customEvents: null })
            }
          />

          {/* 🔴 逐表單列出,不是「選一張表單」的下拉。
              對齊 Ragic「頁籤個別設定」;下拉一次只看得到一張,調不了多張。 */}
          <div className="mt-4 mb-1.5 flex items-center gap-2 text-[12px] font-medium text-ink-2">
            表單個別設定
            <span className="font-normal text-ink-3">
              未列出層級者即跟著上方的全租戶預設({levelName(tenantLevel)})
            </span>
          </div>
          {/* 名稱篩選:分組之後仍可能有幾十張表,而使用者通常心裡已經有一張 */}
          <Input
            className="mb-1.5 h-7"
            aria-label="篩選表單"
            placeholder="篩選表單名稱…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {groups.map((g) => (
            <div key={g.key} className="mb-2">
              <div className="mb-0.5 text-[12px] text-ink-3">{g.name}</div>
              <ul className="flex flex-col">
                {g.forms.map((f) => {
                  const { level, inherited } = resolveClientLevel(data.prefs, f.id)
                  return (
                    <li
                      key={f.id}
                      className="flex items-center gap-2 border border-b-0 border-line-2 px-2.5 py-1.5 last:border-b"
                    >
                      <Link
                        href={`/app/forms/${String(f.id)}`}
                        className="min-w-0 flex-1 truncate text-[12px] text-ink hover:text-primary"
                      >
                        {f.name}
                      </Link>
                      {inherited ? null : (
                        <span className="shrink-0 rounded-sm border border-primary px-1 py-px text-[12px] text-primary">
                          已單獨設定
                        </span>
                      )}
                      <Select
                        className="h-6 w-36 shrink-0"
                        aria-label={`${f.name} 的通知層級`}
                        disabled={!enabled}
                        value={inherited ? "" : String(level)}
                        onChange={(e) => {
                          /* 空字串 = 恢復繼承。**刪列而非存一個哨兵值** ——
                             「跟著上層走」與「明確設成某層級」是兩種狀態。 */
                          if (e.target.value === "") {
                            clearPref.mutate({ scope: "form", scopeId: f.id })
                            return
                          }
                          savePref.mutate({
                            scope: "form",
                            scopeId: f.id,
                            level: Number(e.target.value),
                            customEvents: null,
                          })
                        }}
                      >
                        <option value="">繼承({levelName(tenantLevel)})</option>
                        {NOTIFICATION_LEVELS.map((lv) => (
                          <option key={lv.value} value={lv.value}>
                            {lv.name}
                          </option>
                        ))}
                      </Select>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {groups.length === 0 ? (
            <div className="border border-line-2 px-2.5 py-4 text-center text-[12px] text-ink-3">
              {keyword === "" ? "還沒有表單。" : `沒有名稱含「${keyword}」的表單。`}
            </div>
          ) : null}
        </div>
      </section>

      {/* 軸 2 */}
      <section className={`mt-2.5 border border-line-2 ${enabled ? "" : "opacity-40"}`}>
        <div className="flex items-center gap-2 border-b border-line-2 bg-label px-2.5 py-2 text-[12px] font-semibold">
          <span className="font-mono text-[12px] text-ink-3">軸 2</span>各事件的接收方式
        </div>
        <div className="p-2.5">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="border border-cell bg-head px-2 py-1.5 text-left text-[12px] font-semibold text-ink-2">
                  事件
                </th>
                <th className="w-[74px] border border-cell bg-head px-2 py-1.5 text-center text-[12px] font-semibold text-ink-2">
                  站內
                </th>
                <th className="w-[74px] border border-cell bg-head px-2 py-1.5 text-center text-[12px] font-semibold text-ink-2">
                  Email
                </th>
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((e) => (
                <tr key={e.code}>
                  <td className="border border-cell px-2 py-1.5">{e.label}</td>
                  <td className="border border-cell px-2 py-1.5 text-center">
                    {/* 站內恆開:通知中心是「我的收件匣」,關掉它等於通知無處可存 */}
                    <input
                      type="checkbox"
                      checked
                      readOnly
                      className="size-[13px] accent-primary"
                    />
                  </td>
                  <td className="border border-cell px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={emailOn(e.code)}
                      disabled={!enabled}
                      onChange={() => toggleEmail(e.code)}
                      className="size-[13px] accent-primary"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* LINE 欄 P0 不顯示(裁定 ①):既無 driver 也無連接設定頁,該列無法由任何
              操作變成「已連接」,是死控件。LINE 模組上線時整欄再出現。 */}
        </div>
      </section>
    </div>
  )
}
