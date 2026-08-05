"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { engineFetch } from "./client"

/* R1·A-1 M4|通知通道連接資料層。

   🔴 **回應永遠不含憑證**(後端 Grafana `secureJsonFields` 語意:只回布林旗標)。
   故這裡也沒有「憑證」欄位可讀 —— 型別本身就讓「顯示明文」寫不出來。 */

const statusSchema = z.object({
  /* 🔴 **必須與後端 `channel-registry.ts` 的 `ChannelId` 同步**。
     2026-08-05 加 WhatsApp 時漏了這裡 → `z.enum` 解不到 → **整個通道設定頁掛掉**,
     畫面上只剩一段 zod 錯誤。這與 audit-D §2.2 抓到的簽核 `fieldRef` 是**同一形狀**:
     前後端兩份鏡射,加了一邊沒加另一邊,而後果不是「少一個選項」是**整頁不能用**。
     ⚠️ 前一次的結論是「補上就好」,而它又發生了 —— 下面那條測試就是為此而加。 */
  channel: z.enum(["slack", "teams", "discord", "telegram", "line", "whatsapp", "smtp"]),
  label: z.string(),
  /* 設定表單的規格由後端給 —— 前端曾有第三份複本,加通道時漏改導致整頁掛掉 */
  secretLabel: z.string(),
  secretHint: z.string(),
  configFields: z.array(z.object({ key: z.string(), label: z.string() })),
  config: z.record(z.string(), z.unknown()),
  /* 只說「有沒有設」,永不回值 */
  secretSet: z.boolean(),
  secretFingerprint: z.string().nullable(),
  /* 管理者勾選要廣播哪些事件;空 = 連上了但不廣播 */
  broadcastEvents: z.array(z.string()),
  verifiedAt: z.coerce.date().nullable(),
  enabled: z.boolean(),
  updatedAt: z.coerce.date().nullable(),
})

export type ChannelStatus = z.infer<typeof statusSchema>
export type ChannelId = ChannelStatus["channel"]

export function useChannels() {
  return useQuery({
    queryKey: ["notification-channels"],
    queryFn: () => engineFetch("/notification-channels", z.array(statusSchema)),
    staleTime: 30_000,
  })
}

export function useSaveChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      channel: ChannelId
      config: Record<string, string>
      /* 🔴 **省略 = 保留原值**,不是清空 —— 改設定時不該被迫重打憑證 */
      secret?: string
      clearSecret?: boolean
      enabled?: boolean
      broadcastEvents?: string[]
    }) => {
      const { channel, ...body } = input
      return engineFetch(`/notification-channels/${channel}`, statusSchema, {
        method: "PUT",
        body,
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-channels"] }),
  })
}

export function useTestChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channel: ChannelId) =>
      engineFetch(
        `/notification-channels/${channel}/test`,
        z.object({ ok: z.boolean(), detail: z.string() }),
        { method: "POST" },
      ),
    // 測試成功會寫入 verifiedAt → 清單要重抓才看得到「已驗證」
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-channels"] }),
  })
}
