"use client"

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { engineFetch } from "./client"
import {
  type AddFieldInput,
  type CreateFormInput,
  type FormDto,
  type ListResponse,
  type Layout,
  type RecordRow,
  type ViewConfig,
  type ViewDto,
  type ViewFilterCondition,
  type ViewSort,
  formDtoSchema,
  formSummarySchema,
  layoutSchema,
  listResponseSchema,
  recordRowSchema,
  viewDtoSchema,
} from "./schemas"

const voidSchema = z.undefined().or(z.unknown().transform(() => undefined))

export const formKeys = {
  all: ["forms"] as const,
  detail: (formId: number) => ["forms", formId] as const,
  records: (formId: number) => ["forms", formId, "records"] as const,
}

export function useForms() {
  return useQuery({
    queryKey: formKeys.all,
    queryFn: () => engineFetch("/forms", z.array(formSummarySchema)),
  })
}

/* R1·UP-1 workspace-ia:分類清單(非 admin，工作區目錄用;只 id/name/position） */
const workspaceCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  position: z.number(),
})
export type WorkspaceCategory = z.infer<typeof workspaceCategorySchema>

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => engineFetch("/categories", z.array(workspaceCategorySchema)),
    staleTime: 60_000,
  })
}

export function useForm(formId: number | null) {
  return useQuery({
    queryKey: formKeys.detail(formId ?? -1),
    queryFn: () => engineFetch(`/forms/${formId}`, formDtoSchema),
    enabled: formId !== null,
    staleTime: 30_000,
  })
}

export function useRecords(formId: number | null) {
  return useQuery({
    queryKey: formKeys.records(formId ?? -1),
    queryFn: () =>
      engineFetch<ListResponse>(`/forms/${formId}/records?limit=50`, listResponseSchema),
    enabled: formId !== null,
  })
}

/* 網格用:cursor 分頁(一頁 200 = list 端點上限 + 載更多;OQ-GEI-2=A)*/
export function useInfiniteRecords(formId: number, pageSize = 200) {
  return useInfiniteQuery({
    queryKey: [...formKeys.records(formId), "grid"],
    queryFn: ({ pageParam }) =>
      engineFetch<ListResponse>(
        `/forms/${formId}/records?limit=${pageSize}${
          pageParam === undefined ? "" : `&cursor=${pageParam}`
        }`,
        listResponseSchema,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return (keys: readonly (readonly unknown[])[]) => {
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
  }
}

export function useCreateForm() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: CreateFormInput): Promise<FormDto> =>
      engineFetch("/forms", formDtoSchema, { method: "POST", body: input }),
    onSuccess: () => invalidate([formKeys.all]),
  })
}

export function useAddField(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: AddFieldInput) =>
      engineFetch(`/forms/${formId}/fields`, z.unknown(), { method: "POST", body: input }),
    onSuccess: () => invalidate([formKeys.detail(formId), formKeys.all]),
  })
}

export function useAlterFieldType(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { fieldId: number; type: string; options?: Record<string, unknown> }) =>
      engineFetch(`/forms/${formId}/fields/${input.fieldId}/type`, voidSchema, {
        method: "PATCH",
        body: { type: input.type, options: input.options ?? {} },
      }),
    onSuccess: () => invalidate([formKeys.detail(formId)]),
  })
}

export function useDropField(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (fieldId: number) =>
      engineFetch(`/forms/${formId}/fields/${fieldId}`, voidSchema, { method: "DELETE" }),
    onSuccess: () => invalidate([formKeys.detail(formId)]),
  })
}

export function useMoveField(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { fieldId: number; direction: "up" | "down" }) =>
      engineFetch(`/forms/${formId}/fields/${input.fieldId}/position`, voidSchema, {
        method: "PATCH",
        body: { direction: input.direction },
      }),
    onSuccess: () => invalidate([formKeys.detail(formId)]),
  })
}

export function useCreateRecord(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (values: Record<string, unknown>): Promise<RecordRow> =>
      engineFetch(`/forms/${formId}/records`, recordRowSchema, {
        method: "POST",
        body: { values },
      }),
    onSuccess: () => invalidate([formKeys.records(formId)]),
  })
}

export function useUpdateRecord(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: {
      recordId: number
      expectedVersion: number
      values: Record<string, unknown>
    }): Promise<RecordRow> =>
      engineFetch(`/forms/${formId}/records/${input.recordId}`, recordRowSchema, {
        method: "PATCH",
        body: { expectedVersion: input.expectedVersion, values: input.values },
      }),
    onSuccess: () => invalidate([formKeys.records(formId)]),
  })
}

/* R1·UP-1 記錄頁動作:刪除(軟刪) */
export function useDeleteRecord(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (recordId: number) =>
      engineFetch(`/forms/${formId}/records/${recordId}`, voidSchema, { method: "DELETE" }),
    onSuccess: () => invalidate([formKeys.records(formId)]),
  })
}

/* bulk 匯入(Excel onboarding);單一 tx,任一列敗整批 rollback(P0-2 A1)*/
export function useBulkCreate(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (rows: Record<string, unknown>[]): Promise<{ created: number }> =>
      engineFetch(`/forms/${formId}/records/bulk`, z.object({ created: z.number().int() }), {
        method: "POST",
        body: { rows: rows.map((values) => ({ values })) },
      }),
    onSuccess: () => invalidate([formKeys.records(formId)]),
  })
}

/* R1·UP-2 集合視圖:POST /records/query 無限捲動(套 filter/combinator/sort/快速搜尋)。 */
export interface RecordQuery {
  readonly filters: readonly ViewFilterCondition[]
  readonly combinator: "and" | "or"
  readonly sort: readonly ViewSort[]
  readonly q?: string | undefined
}

export function useInfiniteRecordsQuery(formId: number, query: RecordQuery, pageSize = 200) {
  return useInfiniteQuery({
    queryKey: [...formKeys.records(formId), "query", query],
    queryFn: ({ pageParam }) =>
      engineFetch<ListResponse>(`/forms/${formId}/records/query`, listResponseSchema, {
        method: "POST",
        body: {
          filters: query.filters,
          combinator: query.combinator,
          sort: query.sort,
          ...(query.q !== undefined && query.q !== "" ? { q: query.q } : {}),
          limit: pageSize,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/* R1·UP-3 2D 設計器版面 */
const layoutResponseSchema = z.object({ layout: layoutSchema.nullable() })

export function useLayout(formId: number | null) {
  return useQuery({
    queryKey: ["forms", formId ?? -1, "layout"],
    queryFn: () => engineFetch(`/forms/${formId}/layout`, layoutResponseSchema),
    enabled: formId !== null,
    staleTime: 30_000,
  })
}

export function usePutLayout(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (layout: Layout): Promise<Layout> =>
      engineFetch(`/forms/${formId}/layout`, layoutSchema, { method: "PATCH", body: layout }),
    onSuccess: () =>
      invalidate([["forms", formId, "layout"], formKeys.detail(formId), formKeys.all]),
  })
}

export const viewKeys = {
  list: (formId: number) => ["forms", formId, "views"] as const,
}

export function useViews(formId: number | null) {
  return useQuery({
    queryKey: viewKeys.list(formId ?? -1),
    queryFn: () => engineFetch(`/forms/${formId}/views`, z.array(viewDtoSchema)),
    enabled: formId !== null,
    staleTime: 30_000,
  })
}

export interface ViewInput {
  readonly name: string
  readonly scope?: "personal" | "shared"
  readonly config: ViewConfig
  readonly isDefault?: boolean
  readonly locked?: boolean
}

export interface ViewPatch {
  readonly name?: string
  readonly config?: ViewConfig
  readonly scope?: "personal" | "shared"
  readonly isDefault?: boolean
  readonly locked?: boolean
  readonly position?: number
}

export function useCreateView(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: ViewInput): Promise<ViewDto> =>
      engineFetch(`/forms/${formId}/views`, viewDtoSchema, { method: "POST", body: input }),
    onSuccess: () => invalidate([viewKeys.list(formId)]),
  })
}

export function useUpdateView(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { viewId: number; patch: ViewPatch }): Promise<ViewDto> =>
      engineFetch(`/forms/${formId}/views/${input.viewId}`, viewDtoSchema, {
        method: "PATCH",
        body: input.patch,
      }),
    onSuccess: () => invalidate([viewKeys.list(formId)]),
  })
}

export function useDeleteView(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (viewId: number) =>
      engineFetch(`/forms/${formId}/views/${viewId}`, voidSchema, { method: "DELETE" }),
    onSuccess: () => invalidate([viewKeys.list(formId)]),
  })
}

export function useSaveWithLines(parentFormId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: {
      childFormId: number
      header: { id?: number; expectedVersion?: number; values: Record<string, unknown> }
      lines: { id?: number; values: Record<string, unknown> }[]
    }) =>
      engineFetch(
        `/forms/${parentFormId}/records/save-with-lines`,
        z.object({ header: recordRowSchema, lines: z.array(recordRowSchema) }),
        { method: "POST", body: input },
      ),
    onSuccess: () => invalidate([formKeys.records(parentFormId)]),
  })
}
