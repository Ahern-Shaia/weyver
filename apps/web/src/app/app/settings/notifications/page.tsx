"use client"

import {
  useForms,
  useNotificationSettings,
  useSaveNotificationPref,
  useSaveNotificationSettings,
} from "@/lib/engine/hooks"
import { Select } from "@weyver/ui/select"
import { type ReactNode, useState } from "react"
import { BusyBar, FirstLoad } from "@/components/busy-indicator"

/* H-1 M4 通知設定(docs/mockups/notification-flow.html 步驟 4-5)。

   **三軸分離**|軸 0 總開關(要不要收)· 軸 1 **層級**(收多少)· 軸 2 **通道**(從哪收)。
   v0.3 曾把「收多少」與「與我相關」混在同一排勾選框,是維度錯置(OQ-NT-15)。

   軸 1 為**單一有序 enum** 而非獨立布林開關:GitHub / GitLab / Discourse / Zulip /
   Notion / Slack / Teams / Linear 無一例外皆如此,且查不到任何系統從 enum 退回
   獨立開關。有序才可繼承(全域 → 分類 → 表單,最具體者勝)。 */

const LEVELS = [
  { value: 0, name: "靜音", desc: "完全不通知,包含我自己建立的資料" },
  { value: 10, name: "與我相關", desc: "我建立的資料有變更時通知我", isDefault: true },
  { value: 20, name: "新資料 + 與我相關", desc: "另加:有人新增資料時" },
  { value: 30, name: "全部", desc: "任何人新增或修改任何一筆資料時" },
] as const

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
  const saveSettings = useSaveNotificationSettings()
  const savePref = useSaveNotificationPref()
  const [formId, setFormId] = useState<string>("")

  /* 只有「完全沒有資料可顯示」才佔位(同時讓 TS 收窄);
     後續重取由 BusyBar 表示,內容保留不塌陷 */
  if (data === undefined) return <FirstLoad />

  const enabled = data.enabled
  const selectedForm = formId === "" ? null : Number(formId)
  const formPref = data.prefs.find((p) => p.scope === "form" && p.scopeId === selectedForm)
  const tenantPref = data.prefs.find((p) => p.scope === "tenant")
  const effective = formPref?.level ?? tenantPref?.level ?? 10
  const inherited = formPref === undefined

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
      <h2 className="text-[15px] font-semibold">通知設定</h2>
      <p className="mt-1 text-[11.5px] text-ink-3">設定要接收哪些通知,以及用什麼方式接收。</p>

      {/* 軸 0 */}
      <section className="mt-5 border border-line-2">
        <div className="flex items-center gap-2 border-b border-line-2 bg-label px-2.5 py-2 text-[11.5px] font-semibold">
          <span className="font-mono text-[10px] text-ink-4">軸 0</span>接收通知
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
            <span className="ml-auto text-[10.5px] text-ink-4">
              關閉後將不會收到任何通知,下方設定一併停用
            </span>
          </label>
          {/* 裁定 ④:逾期豁免總開關。**必須明白告知** —— 靜默的例外會讓使用者以為設定壞了 */}
          <div className="mt-2 border border-warn-line bg-warn-t px-2.5 py-1.5 text-[11px] text-warn">
            簽核逾期提醒為例外,停止接收期間仍會發送。
          </div>
        </div>
      </section>

      {/* 軸 1 */}
      <section className={`mt-2.5 border border-line-2 ${enabled ? "" : "opacity-40"}`}>
        <div className="flex items-center gap-2 border-b border-line-2 bg-label px-2.5 py-2 text-[11.5px] font-semibold">
          <span className="font-mono text-[10px] text-ink-4">軸 1</span>通知層級
          <span className="ml-auto text-[10.5px] font-normal text-ink-4">
            每張表單一個層級,未設定則繼承上層
          </span>
        </div>
        <div className="p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10.5px] text-ink-4">表單</span>
            <Select
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              disabled={!enabled}
              className="h-7 w-56"
              aria-label="選擇表單"
            >
              <option value="">全租戶預設</option>
              {(forms ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          {selectedForm !== null && inherited ? (
            <div className="mb-2 border border-line-2 bg-field px-2.5 py-1.5 text-[10.5px] text-ink-3">
              目前繼承上層設定 — 選擇下列任一項即為此表單單獨設定
            </div>
          ) : null}
          <div className="flex flex-col">
            {LEVELS.map((lv) => (
              <button
                key={lv.value}
                type="button"
                disabled={!enabled}
                onClick={() =>
                  savePref.mutate({
                    scope: selectedForm === null ? "tenant" : "form",
                    scopeId: selectedForm,
                    level: lv.value,
                    customEvents: null,
                  })
                }
                className={`flex items-start gap-2 border border-b-0 border-line-2 px-2.5 py-2 text-left last:border-b ${
                  effective === lv.value ? "border-primary bg-primary-t" : ""
                }`}
              >
                <span
                  className={`mt-0.5 size-3 shrink-0 rounded-full border ${
                    effective === lv.value ? "border-[1.5px] border-primary" : "border-line"
                  }`}
                >
                  {effective === lv.value ? (
                    <span className="m-[2.5px] block size-[5px] rounded-full bg-primary" />
                  ) : null}
                </span>
                <span>
                  <span className="block text-[11.5px] font-medium">
                    {lv.name}
                    {"isDefault" in lv ? (
                      <span className="ml-1 font-normal text-ink-4">(預設)</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-ink-3">{lv.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 軸 2 */}
      <section className={`mt-2.5 border border-line-2 ${enabled ? "" : "opacity-40"}`}>
        <div className="flex items-center gap-2 border-b border-line-2 bg-label px-2.5 py-2 text-[11.5px] font-semibold">
          <span className="font-mono text-[10px] text-ink-4">軸 2</span>各事件的接收方式
        </div>
        <div className="p-2.5">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr>
                <th className="border border-cell bg-head px-2 py-1.5 text-left text-[11px] font-semibold text-ink-2">
                  事件
                </th>
                <th className="w-[74px] border border-cell bg-head px-2 py-1.5 text-center text-[11px] font-semibold text-ink-2">
                  站內
                </th>
                <th className="w-[74px] border border-cell bg-head px-2 py-1.5 text-center text-[11px] font-semibold text-ink-2">
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
                    <input type="checkbox" checked readOnly className="size-[13px] accent-primary" />
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
