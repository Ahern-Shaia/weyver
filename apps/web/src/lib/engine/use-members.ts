"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { engineFetch } from "./client"

/* R1·A-1 M2|使用者管理資料層。

   🔴 **`initialPassword` 只在建立那一次的回應裡出現**,之後任何查詢都拿不到。
   故它**不進 query cache** —— 放進去等於讓明文多活在記憶體裡、還可能被 devtools 看到。
   由呼叫端接住 mutation 的回傳值、顯示完就丟。 */

const memberSchema = z.object({
  actorId: z.number(),
  email: z.string(),
  name: z.string().nullable(),
  status: z.enum(["active", "suspended"]),
  /* pending = 已建帳號但對方還沒用初始密碼登入過;expired = 憑證過期需重發 */
  credential: z.enum(["pending", "expired", "set"]),
})

const createdSchema = z.object({
  actorId: z.number(),
  email: z.string(),
  initialPassword: z.string(),
  expiresAt: z.coerce.date(),
})

export type Member = z.infer<typeof memberSchema>
export type CreatedMember = z.infer<typeof createdSchema>

export function useMembers() {
  return useQuery({
    queryKey: ["members"],
    queryFn: () => engineFetch("/members", z.array(memberSchema)),
    staleTime: 30_000,
  })
}

export function useCreateMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; name: string }) =>
      engineFetch("/members", createdSchema, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members"] }),
  })
}

export function useSetMemberStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { actorId: number; status: "active" | "suspended" }) =>
      engineFetch(`/members/${String(input.actorId)}/status`, z.object({ ok: z.literal(true) }), {
        method: "PATCH",
        body: { status: input.status },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members"] }),
  })
}
