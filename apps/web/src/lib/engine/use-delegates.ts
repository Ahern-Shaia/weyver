"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { engineFetch } from "./client"

/* #104|簽核代理人資料層。

   兩個方向都取:`granted`(我交出去的)與 `received`(我背在身上的)。
   少了後者,代理人會不知道簽核匣裡為什麼多出別人的單。 */

const delegateSchema = z.object({
  id: z.number(),
  principalActorId: z.number(),
  delegateActorId: z.number(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable(),
  active: z.boolean(),
})

const listSchema = z.object({
  /* 我自己的 actor id —— 挑代理人時要把自己排除 */
  actorId: z.number(),
  granted: z.array(delegateSchema),
  received: z.array(delegateSchema),
})

const voidSchema = z.undefined().or(z.unknown().transform(() => undefined))

export type Delegate = z.infer<typeof delegateSchema>

export function useDelegates() {
  return useQuery({
    queryKey: ["approval-delegates"],
    queryFn: () => engineFetch("/approval-delegates", listSchema),
    staleTime: 30_000,
  })
}

export function useCreateDelegate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { delegateActorId: number; startsAt?: string; endsAt?: string }) =>
      engineFetch("/approval-delegates", delegateSchema, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approval-delegates"] }),
  })
}

export function useRevokeDelegate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      engineFetch(`/approval-delegates/${String(id)}`, voidSchema, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approval-delegates"] }),
  })
}
