/* 🔴 通知層級的**單一來源**。設定中心與表單層的面板共用同一份 ——
   兩處各抄一份正是 OQ-PC-10 那個 bug 的成因(樞紐/圖表複製了列表的查詢推導後漂移)。 */

export const NOTIFICATION_LEVELS = [
  { value: 0, name: "靜音", desc: "完全不通知,包含我自己建立的資料" },
  { value: 10, name: "與我相關", desc: "我建立的資料有變更時通知我", isDefault: true },
  { value: 20, name: "新資料 + 與我相關", desc: "另加:有人新增資料時" },
  { value: 30, name: "全部", desc: "任何人新增或修改任何一筆資料時" },
] as const

export const DEFAULT_NOTIFICATION_LEVEL = 10

export interface NotificationPref {
  readonly scope: string
  readonly scopeId: number | null
  readonly level: number
}

/* 前端的繼承解析,對應後端 `resolveLevel`(notification.service.ts)。
   **最具體者勝**;缺列 = 繼承上層,**不是**關閉。
   ⚠️ 分類層前端尚未取得 categoryId → 此處只解表單與租戶兩層,
   與後端在「有分類偏好」時會有落差,故 UI 只說「繼承上層」不說繼承自哪一層。 */
export function resolveClientLevel(
  prefs: readonly NotificationPref[],
  formId: number | null,
): { level: number; inherited: boolean } {
  const byForm =
    formId === null ? undefined : prefs.find((p) => p.scope === "form" && p.scopeId === formId)
  if (byForm !== undefined) return { level: byForm.level, inherited: false }
  const byTenant = prefs.find((p) => p.scope === "tenant")
  return { level: byTenant?.level ?? DEFAULT_NOTIFICATION_LEVEL, inherited: true }
}
