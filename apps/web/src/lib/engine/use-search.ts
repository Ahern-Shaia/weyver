"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { z } from "zod"
import { engineFetch } from "./client"

/* R1·H-3 M4|⌘K 的跨表記錄搜尋資料源。

   ## 為什麼要 debounce

   後端每次查詢都要先算「可讀表 + 隱藏欄」再打 `search_doc`(見 search.service.ts)。
   逐鍵送出等於把打字速度直接當成 QPS。取 220ms:比一般連續打字的鍵間隔略長,
   一串連打收斂成一次請求;同時遠低於 NN/g「1 秒內不打斷思緒」的門檻。
   ⚠️ **220 為本專案取值,無外部共識** —— 上面兩個邊界是理由,不是出處。

   ## 兩字門檻與後端一致

   後端對 <2 字直接回空(bigram 需 2 字元才成一個 gram,否則退化全表掃描)。
   前端同樣不送 —— 讓「打一個字」完全不產生網路往返。

   ## keepPreviousData:這是「禁止視覺阻斷」的具體手段

   預設行為是查詢字串一變就把 data 清成 undefined,結果區會先空再填 —— 那正是
   R1·UX-1 要消除的閃爍與位移。保留前一次結果直到新結果到達,清單只會「換內容」
   不會「先塌再長」。 */

const DEBOUNCE_MS = 220
const MIN_QUERY_LEN = 2

const searchHitSchema = z.object({
  formId: z.number(),
  formName: z.string(),
  recordId: z.number(),
  fieldName: z.string(),
  snippet: z.string(),
  score: z.number(),
})

const searchResultSchema = z.object({
  hits: z.array(searchHitSchema),
  truncated: z.boolean(),
})

export type SearchHit = z.infer<typeof searchHitSchema>
export type SearchResult = z.infer<typeof searchResultSchema>

export function useDebounced(value: string, delayMs = DEBOUNCE_MS): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function useRecordSearch(
  query: string,
  enabled: boolean,
): { hits: readonly SearchHit[]; truncated: boolean; isFetching: boolean } {
  const q = query.trim()
  const active = enabled && q.length >= MIN_QUERY_LEN

  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => engineFetch(`/search?q=${encodeURIComponent(q)}&limit=20`, searchResultSchema),
    enabled: active,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  /* 🔴 未達門檻一律回空 —— `keepPreviousData` 會讓上一次的結果在查詢停用後**繼續留著**,
     使用者刪字回到 1 個字時,畫面上仍掛著前一輪的記錄。門檻只寫在這裡一處。 */
  if (!active) return { hits: [], truncated: false, isFetching: false }
  return { hits: data?.hits ?? [], truncated: data?.truncated ?? false, isFetching }
}

/* 記錄深連結 —— 記錄模式的 master-detail 由 `mode` + `rid` 兩個查詢參數決定,
   只給 rid 會停在列表模式(form-workspace.tsx:66 / 269)。 */
export function recordHref(formId: number, recordId: number): string {
  return `/app/forms/${String(formId)}?mode=record&rid=${String(recordId)}`
}
