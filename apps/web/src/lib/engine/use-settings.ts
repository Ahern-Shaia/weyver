"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { engineFetch } from "./client"

/* R1·A-1 M1|設定中心資料層。

   ## 兩軸時區

   · `tenantSettings.timezone` = **業務日界線**(autoNumber 日期段靠它)—— 個人不可覆寫
   · `userSettings.displayTimezone` = **顯示時區** —— 只影響畫面上時間戳怎麼寫

   ## overrides 是 UI 的必要資訊,不是內部細節

   後端同時回「有效值」與「是否已自訂」。只回有效值的話,使用者看到
   `Asia/Taipei` 無從得知那是自己設的還是跟著公司 —— 也就不知道改公司設定會不會影響他。 */

const tenantSettingsSchema = z.object({
  name: z.string(),
  taxId: z.string().nullable(),
  logoFileKey: z.string().nullable(),
  timezone: z.string(),
  defaultLocale: z.string(),
  defaultCurrency: z.string(),
})

const userSettingsSchema = z.object({
  locale: z.string(),
  displayTimezone: z.string(),
  overrides: z.object({ locale: z.boolean(), displayTimezone: z.boolean() }),
  tenantDefaults: z.object({ locale: z.string(), timezone: z.string() }),
})

export type TenantSettings = z.infer<typeof tenantSettingsSchema>
export type UserSettings = z.infer<typeof userSettingsSchema>

/* `null` = 取消自訂回到繼承;不帶該鍵 = 不動。兩者不可合併(後端同語意) */
export interface UserSettingsPatch {
  locale?: string | null
  displayTimezone?: string | null
}

export function useTenantSettings() {
  return useQuery({
    queryKey: ["settings", "tenant"],
    queryFn: () => engineFetch("/settings/tenant", tenantSettingsSchema),
    staleTime: 60_000,
  })
}

export function useUserSettings() {
  return useQuery({
    queryKey: ["settings", "me"],
    queryFn: () => engineFetch("/settings/me", userSettingsSchema),
    staleTime: 60_000,
  })
}

export function useUpdateTenantSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Omit<TenantSettings, "logoFileKey">>) =>
      engineFetch("/settings/tenant", tenantSettingsSchema, { method: "PATCH", body: patch }),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "tenant"], data)
      /* 🔴 公司預設一改,所有**未自訂**的個人設定跟著變(動態繼承)——
         不失效 `me` 的話,使用者會看到一個已經過期的「跟隨公司設定」值。 */
      void qc.invalidateQueries({ queryKey: ["settings", "me"] })
    },
  })
}

export function useUpdateUserSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: UserSettingsPatch) =>
      engineFetch("/settings/me", userSettingsSchema, { method: "PATCH", body: patch }),
    onSuccess: (data) => qc.setQueryData(["settings", "me"], data),
  })
}

export const LOCALE_LABELS: Readonly<Record<string, string>> = {
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
}

/* 常用時區。**不列 IANA 全表**(600+ 筆,下拉不可用);後端仍以 Intl 驗證任意合法值,
   故日後要加只需改這個陣列,不必動後端。 */
export const TIMEZONES = [
  "Asia/Taipei",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "UTC",
] as const

export const CURRENCIES = ["TWD", "USD", "CNY", "JPY", "EUR", "VND", "THB"] as const
