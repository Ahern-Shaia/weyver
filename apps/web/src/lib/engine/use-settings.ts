"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
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
  /* 全公司強制二步驟驗證(#112)。開啟者本人須先啟用,後端擋 */
  requireMfa: z.boolean(),
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

/* 🔴 顯示格式的**單一 context 來源**。

   在此之前只有 `object-page` 自己組了 `{ timeZone }`,而且**漏了 `locale`** ——
   使用者在個人設定改了語系,記錄頁的日期仍照 zh-TW 畫。
   其餘畫面(列表 / 看板 / 行事曆 / 標籤列印)則連時區都沒帶。

   同一個值在不同畫面上寫成不同的字,正是 `docs/14` 說的信任訊號**反效果**。 */
export function useDisplayCtx(): { timeZone: string | undefined; locale: string | undefined } {
  const { data } = useUserSettings()
  /* 🔴 **必須記憶化**。每次呼叫回一個新物件的話,拿它當 prop 傳下去等於
     每次 render 都換一個身分,`memo` / 相依陣列全部失效。 */
  return useMemo(
    () => ({ timeZone: data?.displayTimezone, locale: data?.locale }),
    [data?.displayTimezone, data?.locale],
  )
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
