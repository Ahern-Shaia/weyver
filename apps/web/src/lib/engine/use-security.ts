"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { engineFetch } from "./client"

/* R1·A-1 M3|帳號安全資料層(裝置清單 / 強制登出 / 認證稽核)。

   三個端點都**不帶使用者參數** —— 後端由已驗證的 session 反查 `authUserId`。
   前端連「看誰的」這個念頭都沒有入口,自然也偽造不了。 */

const sessionSchema = z.object({
  id: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  /* 由後端解析好送來 —— 前端不再解析一次 UA(兩份解析必然分岔) */
  device: z.string(),
  lastActiveAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  current: z.boolean(),
})

const auditSchema = z.object({
  event: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.coerce.date(),
  detail: z.unknown(),
})

export type DeviceSession = z.infer<typeof sessionSchema>
export type AuthAuditRow = z.infer<typeof auditSchema>

export function useDeviceSessions() {
  return useQuery({
    queryKey: ["security", "sessions"],
    queryFn: () => engineFetch("/security/sessions", z.array(sessionSchema)),
    staleTime: 15_000,
  })
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      engineFetch(
        "/security/sessions/revoke-others",
        z.object({ sessions: z.number(), apiKeys: z.number() }),
        { method: "POST" },
      ),
    /* 撤銷同時影響裝置清單與稽核紀錄(會多一筆 session.revoke_others),兩個都要重抓 */
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security"] }),
  })
}

export function useAuthAudit() {
  return useQuery({
    queryKey: ["security", "audit"],
    queryFn: () => engineFetch("/security/audit", z.array(auditSchema)),
    staleTime: 15_000,
  })
}
