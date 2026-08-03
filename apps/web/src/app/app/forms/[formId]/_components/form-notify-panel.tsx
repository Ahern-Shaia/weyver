"use client"

import { NotificationLevelPicker } from "@/components/notification-level-picker"
import {
  useClearNotificationPref,
  useNotificationSettings,
  useSaveNotificationPref,
} from "@/lib/engine/hooks"
import { resolveClientLevel } from "@/lib/engine/notification-levels"
import { Button } from "@weyver/ui/button"
import { Radio, X } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

/* 🔴 R1·IA 第二階段|「這張表單的通知」,開在表單上。

   Ragic 使用手冊 doc-user/12 逐字:「**表單個別通知** —— 在表單的**工具**選單中的
   同步與通知選擇**通知設定**。」同一份文件另記個人設定裡的「頁籤個別設定」——
   **同一筆設定的兩個入口**,而不是兩份各存一份的設定,所以沒有「改哪個才算數」的歧義。

   🔴 **這裡刻意不設權限閘門**。`notification_pref` 帶 `actor_id`,是**個人訂閱**
   不是表單設定;進得到這張表單就該能決定自己要不要收它的通知。
   `docs/33` P4 把它與公開表單一起推導成「需要 design 權」是錯的 ——
   那會讓一般使用者管不了自己的通知。 */
export function FormNotifyPanel({
  formId,
  formName,
  onClose,
}: {
  readonly formId: number
  readonly formName: string
  readonly onClose: () => void
}): ReactNode {
  const { data } = useNotificationSettings()
  const savePref = useSaveNotificationPref()
  const clearPref = useClearNotificationPref()

  const prefs = data?.prefs ?? []
  const { level, inherited } = resolveClientLevel(prefs, formId)
  const enabled = data?.enabled ?? true

  return (
    <div className="mx-auto w-full max-w-[560px] p-6">
      <div className="mb-1 flex items-center gap-2">
        <Radio size={15} className="text-ink-2" />
        <h2 className="text-[16px] font-semibold text-ink">通知 · {formName}</h2>
        <Button className="ml-auto" onClick={onClose}>
          <X size={12} className="mr-1" />
          關閉
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">這是你自己對這張表單的訂閱層級,不影響其他人。</p>

      {/* 🔴 總開關關閉時,這一頁的每個選項都不會生效。
          不講出來的話,使用者會設好之後納悶為什麼沒收到 —— 而畫面看起來完全正常。 */}
      {enabled ? null : (
        <div className="mt-3 border border-warn-line bg-warn-t px-2.5 py-1.5 text-[12px] text-warn">
          你已在通知設定中停止接收所有通知,此處的設定暫時不會生效。
          <Link href="/app/settings/notifications" className="ml-1 underline">
            前往開啟
          </Link>
        </div>
      )}

      <div className={`mt-3 ${enabled ? "" : "opacity-40"}`}>
        {inherited ? (
          <div className="mb-2 border border-line-2 bg-field px-2.5 py-1.5 text-[12px] text-ink-3">
            目前繼承上層設定 — 選擇下列任一項即為這張表單單獨設定
          </div>
        ) : (
          <div className="mb-2 flex items-center gap-2 border border-line-2 bg-field px-2.5 py-1.5 text-[12px] text-ink-3">
            這張表單已單獨設定
            {/* 🔴 沒有這顆按鈕,`scope='form'` 就是單向的 —— 上面那句「繼承上層」
                會變成一個宣告了卻回不去的狀態(後端 DELETE /notifications/prefs)。 */}
            <Button
              className="ml-auto"
              disabled={clearPref.isPending}
              onClick={() => clearPref.mutate({ scope: "form", scopeId: formId })}
            >
              恢復繼承
            </Button>
          </div>
        )}
        <NotificationLevelPicker
          value={level}
          disabled={!enabled || savePref.isPending}
          onPick={(lv) =>
            savePref.mutate({ scope: "form", scopeId: formId, level: lv, customEvents: null })
          }
        />
      </div>

      <p className="mt-3 text-[12px] text-ink-3">
        接收方式(站內 / Email)與總開關為跨表單的設定,在
        <Link href="/app/settings/notifications" className="mx-1 text-primary underline">
          通知設定
        </Link>
        調整。
      </p>
    </div>
  )
}
