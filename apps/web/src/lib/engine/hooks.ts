"use client"

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { z } from "zod"
import { engineFetch } from "./client"
import {
  type AddFieldInput,
  type ApprovalStep,
  type ButtonConfig,
  type CreateFormInput,
  type FormDto,
  type LabelConfig,
  type Layout,
  type ListResponse,
  type RecordRow,
  type ViewConfig,
  type ViewDto,
  type ViewFilterCondition,
  type ViewSort,
  actionResultSchema,
  apiKeySchema,
  approvalDefDtoSchema,
  approvalInstanceDtoSchema,
  buttonDtoSchema,
  formDtoSchema,
  formSummarySchema,
  labelDtoSchema,
  layoutSchema,
  listResponseSchema,
  notificationListSchema,
  notificationSettingsSchema,
  publicShareSchema,
  publicSubmissionSchema,
  recordRowSchema,
  restoreBlockerSchema,
  reverseRelationGroupSchema,
  trashItemSchema,
  userNameSchema,
  viewDtoSchema,
  viewFilterConditionSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
} from "./schemas"
import type { ViewGroup } from "./schemas"

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
    /* M7:切表單時保留前一份資料,避免整頁塌陷再長回(視覺阻斷 + CLS) */
    placeholderData: keepPreviousData,
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
          pageParam === undefined ? "" : `&cursor=${encodeURIComponent(pageParam)}`
        }`,
        listResponseSchema,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useInvalidate() {
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

/* 🔴 R1·GP|貼上走的批次更新。**單一 tx 全成或全敗**(OQ-GP-1)——
   逐格 PATCH 沒有原子性,第 300 格失敗時前 299 格已寫入,而那是正確性問題不是效能問題。
   ⚠️ 刻意**不帶 expectedVersion**:一次貼上數百格,逐列版本不切實際
   (與 saveWithLines 明細同一取捨)。兩人同時貼同一塊會後到者覆蓋而非撞版本衝突。 */
/* 🔴 R1·TPL M3|建表的第三條路(與空白、Excel 匯入並列)。
   `formCount` 讓使用者在按下去之前就知道「這會建幾張表」——
   範本的單位是**包**不是表,不講清楚會嚇到人。 */
const templateSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  industry: z.string().optional(),
  formCount: z.number().int(),
})
export type TemplateSummary = z.infer<typeof templateSummarySchema>

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"] as const,
    queryFn: () => engineFetch("/templates", z.array(templateSummarySchema)),
    staleTime: 5 * 60_000,
  })
}

export function useApplyTemplate() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: {
      key: string
      withRecords: boolean
    }): Promise<{ formIds: number[]; refMap: Record<string, number>; renamed: string[] }> =>
      engineFetch(
        `/templates/${input.key}/apply`,
        z.object({
          formIds: z.array(z.number()),
          refMap: z.record(z.string(), z.number()),
          renamed: z.array(z.string()),
        }),
        { method: "POST", body: { withRecords: input.withRecords } },
      ),
    onSuccess: () => invalidate([formKeys.all, ["categories"]]),
  })
}

/* 🔴 F-2 M4 小圖表。`unavailableReason` 非 null 時**顯示原因而不是空白圖** ——
   空白圖會被當成「沒資料」,而使用者會據此做決策(OQ-PC-11,照 Salesforce)。 */
const widgetSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  chartType: z.enum(["bar", "line", "pie"]),
  dimension: z.string(),
  measure: z.object({ fn: z.string(), field: z.string() }).nullable(),
  ownFilter: z.array(viewFilterConditionSchema).default([]),
  placement: z.enum(["list", "form"]),
  visibleRoleIds: z.array(z.number().int()),
  unavailableReason: z.string().nullable(),
})
export type Widget = z.infer<typeof widgetSchema>

export function useWidgets(formId: number, placement: "list" | "form") {
  return useQuery({
    queryKey: ["forms", formId, "widgets", placement] as const,
    queryFn: () =>
      engineFetch(`/forms/${formId}/widgets?placement=${placement}`, z.array(widgetSchema)),
    staleTime: 60_000,
  })
}

export function useWidgetRoleCandidates(formId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["forms", formId, "widget-role-candidates"] as const,
    enabled,
    queryFn: () =>
      engineFetch(
        `/forms/${formId}/widgets/role-candidates`,
        z.array(z.object({ id: z.number().int(), name: z.string() })),
      ),
    staleTime: 60_000,
  })
}

export function useCreateWidget(formId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      chartType: "bar" | "line" | "pie"
      dimension: string
      measure: { fn: string; field: string } | null
      visibleRoleIds: number[]
    }): Promise<{ id: number }> =>
      engineFetch(`/forms/${formId}/widgets`, z.object({ id: z.number().int() }), {
        method: "POST",
        body: { ...input, placement: "list" },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["forms", formId, "widgets"] }),
  })
}

export function useDeleteWidget(formId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (widgetId: number): Promise<void> =>
      engineFetch(`/forms/${formId}/widgets/${widgetId}`, z.unknown(), {
        method: "DELETE",
      }) as Promise<void>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["forms", formId, "widgets"] }),
  })
}

export function useBulkUpdateRecords(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: {
      rows: { recordId: number; values: Record<string, unknown> }[]
    }): Promise<{ updated: number; skippedComputedCells: number }> =>
      engineFetch(
        `/forms/${formId}/records/bulk-update`,
        z.object({ updated: z.number(), skippedComputedCells: z.number() }),
        { method: "POST", body: { rows: input.rows } },
      ),
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
  readonly groupBy?: readonly ViewGroup[] | undefined
  /* 折疊的群組鍵組合 —— **必須傳後端**,否則折疊只是前端隱藏卻照吃 page size */
  readonly collapsed?: readonly (readonly string[])[] | undefined
}

/* 群組統計。與列表**同一份 query** —— 母體不一致的話小計與列表對不上且錯得安靜。 */
export const groupStatsSchema = z.object({
  groups: z.array(
    z.object({
      keys: z.array(z.string().nullable()),
      depth: z.number(),
      count: z.number(),
      aggregates: z.record(z.string(), z.unknown()),
    }),
  ),
  truncated: z.boolean(),
})
export type GroupStats = z.infer<typeof groupStatsSchema>

/* F-1 行事曆:區間重疊查詢(非 group-by)。依 FullCalendar 慣例帶可見範圍。 */
export const calendarResponseSchema = z.object({
  records: z.array(recordRowSchema),
  truncated: z.boolean(),
})

export function useCalendarRange(
  formId: number,
  params: {
    startField: string
    endField?: string | undefined
    from: string
    to: string
  } | null,
) {
  return useQuery({
    queryKey: [...formKeys.records(formId), "calendar", params],
    enabled: params !== null,
    queryFn: () =>
      engineFetch(`/forms/${formId}/records/calendar`, calendarResponseSchema, {
        method: "POST",
        body: {
          startField: params?.startField,
          ...(params?.endField ? { endField: params.endField } : {}),
          from: params?.from,
          to: params?.to,
          filters: [],
          limit: 1000,
        },
      }),
  })
}

/* F-2 樞紐分析。回**長表**,由前端轉置成密集矩陣(業界一致做法)。 */
export const pivotResultSchema = z.object({
  cells: z.array(
    z.object({
      rowKeys: z.array(z.string().nullable()),
      colKeys: z.array(z.string().nullable()),
      count: z.number(),
      measures: z.record(z.string(), z.unknown()),
    }),
  ),
  rowHeaders: z.array(z.array(z.string())),
  colHeaders: z.array(z.array(z.string())),
  truncated: z.boolean(),
})
export type PivotResult = z.infer<typeof pivotResultSchema>

export interface PivotSpec {
  readonly rowGroupBy: readonly ViewGroup[]
  readonly colGroupBy: readonly ViewGroup[]
  readonly aggregates: readonly { field: string; fn: string }[]
}

export function usePivot(formId: number, spec: PivotSpec | null, query: RecordQuery) {
  return useQuery({
    queryKey: [...formKeys.records(formId), "pivot", spec, query],
    enabled: spec !== null && spec.rowGroupBy.length > 0,
    queryFn: () =>
      engineFetch(`/forms/${formId}/records/pivot`, pivotResultSchema, {
        method: "POST",
        body: {
          rowGroupBy: spec?.rowGroupBy ?? [],
          colGroupBy: spec?.colGroupBy ?? [],
          aggregates: spec?.aggregates ?? [],
          filters: query.filters,
          combinator: query.combinator,
          ...(query.q !== undefined && query.q !== "" ? { q: query.q } : {}),
        },
      }),
  })
}

export function useGroupStats(
  formId: number,
  query: RecordQuery,
  aggregates: readonly { field: string; fn: string }[],
) {
  const enabled = (query.groupBy ?? []).length > 0
  return useQuery({
    queryKey: [...formKeys.records(formId), "group-stats", query, aggregates],
    enabled,
    queryFn: () =>
      engineFetch(`/forms/${formId}/records/group-stats`, groupStatsSchema, {
        method: "POST",
        body: { query: { ...toQueryBody(query), limit: 1 }, aggregates },
      }),
  })
}

/* 列表與群組統計共用的 query body —— **母體必須一致**,否則小計與列表對不上(F-1 §4.2) */
function toQueryBody(query: RecordQuery): Record<string, unknown> {
  return {
    filters: query.filters,
    combinator: query.combinator,
    sort: query.sort,
    ...(query.q !== undefined && query.q !== "" ? { q: query.q } : {}),
    ...((query.groupBy ?? []).length > 0 ? { groupBy: query.groupBy } : {}),
    ...((query.collapsed ?? []).length > 0 ? { collapsed: query.collapsed } : {}),
  }
}

export function useInfiniteRecordsQuery(formId: number, query: RecordQuery, pageSize = 200) {
  return useInfiniteQuery({
    queryKey: [...formKeys.records(formId), "query", query],
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      engineFetch<ListResponse>(`/forms/${formId}/records/query`, listResponseSchema, {
        method: "POST",
        body: {
          ...toQueryBody(query),
          limit: pageSize,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/* R1·UP-3 2D 設計器版面 */
const layoutResponseSchema = z.object({
  layout: layoutSchema.nullable(),
  /* 樂觀鎖用(#109):與 layout 同源讀出,存檔時原樣帶回 */
  version: z.number().int(),
})

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
    mutationFn: (input: Layout & { expectedVersion?: number | undefined }): Promise<Layout> =>
      engineFetch(`/forms/${formId}/layout`, layoutSchema, { method: "PATCH", body: input }),
    onSuccess: () =>
      invalidate([["forms", formId, "layout"], formKeys.detail(formId), formKeys.all]),
  })
}

/* R1·後續-1 自訂按鈕 + 簽核 */
export const actionKeys = {
  buttons: (formId: number) => ["forms", formId, "buttons"] as const,
  approvalDefs: (formId: number) => ["forms", formId, "approvalDefs"] as const,
  recordApproval: (formId: number, recordId: number) =>
    ["forms", formId, "approval", recordId] as const,
  myPending: ["approvals", "pending"] as const,
}

export function useButtons(formId: number | null) {
  return useQuery({
    queryKey: actionKeys.buttons(formId ?? -1),
    queryFn: () => engineFetch(`/forms/${formId}/buttons`, z.array(buttonDtoSchema)),
    enabled: formId !== null,
    staleTime: 30_000,
  })
}

export function useCreateButton(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { label: string; config: ButtonConfig; confirm?: boolean }) =>
      engineFetch(`/forms/${formId}/buttons`, buttonDtoSchema, { method: "POST", body: input }),
    onSuccess: () => invalidate([actionKeys.buttons(formId)]),
  })
}

export function useDeleteButton(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (buttonId: number) =>
      engineFetch(`/forms/${formId}/buttons/${buttonId}`, voidSchema, { method: "DELETE" }),
    onSuccess: () => invalidate([actionKeys.buttons(formId)]),
  })
}

export function useRunButton(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { buttonId: number; recordId: number }) =>
      engineFetch(
        `/forms/${formId}/buttons/${input.buttonId}/run/${input.recordId}`,
        actionResultSchema,
        { method: "POST", body: {} },
      ),
    onSuccess: () => invalidate([formKeys.records(formId)]),
  })
}

export function useApprovalDefs(formId: number | null) {
  return useQuery({
    queryKey: actionKeys.approvalDefs(formId ?? -1),
    queryFn: () => engineFetch(`/forms/${formId}/approvals/defs`, z.array(approvalDefDtoSchema)),
    enabled: formId !== null,
    staleTime: 30_000,
  })
}

export function useCreateApprovalDef(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: {
      name: string
      steps: ApprovalStep[]
      onCompleteButtonId?: number | null
    }) =>
      engineFetch(`/forms/${formId}/approvals/defs`, approvalDefDtoSchema, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => invalidate([actionKeys.approvalDefs(formId)]),
  })
}

const recordApprovalSchema = z.object({ instance: approvalInstanceDtoSchema.nullable() })

export function useRecordApproval(formId: number | null, recordId: number | null) {
  return useQuery({
    queryKey: actionKeys.recordApproval(formId ?? -1, recordId ?? -1),
    queryFn: () =>
      engineFetch(`/forms/${formId}/approvals/records/${recordId}`, recordApprovalSchema),
    enabled: formId !== null && recordId !== null,
  })
}

export function useSubmitApproval(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (recordId: number) =>
      engineFetch(
        `/forms/${formId}/approvals/records/${recordId}/submit`,
        approvalInstanceDtoSchema,
        { method: "POST", body: {} },
      ),
    onSuccess: (_d, recordId) =>
      invalidate([actionKeys.recordApproval(formId, recordId), actionKeys.myPending]),
  })
}

export function useMyPendingApprovals() {
  return useQuery({
    queryKey: actionKeys.myPending,
    queryFn: () => engineFetch("/approvals/pending", z.array(approvalInstanceDtoSchema)),
    staleTime: 15_000,
  })
}

/* 🔴 M4/M5|退回到指定關 · 臨時加簽 · 強制解鎖。
   三者都會改變簽核狀態,故一律 invalidate 全部(與 decide 同做法)。 */
export function useReturnApproval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { instanceId: number; targetStep: number; comment: string }) =>
      engineFetch(`/approvals/${input.instanceId}/return`, approvalInstanceDtoSchema, {
        method: "POST",
        body: { targetStep: input.targetStep, comment: input.comment },
      }),
    onSuccess: () => void queryClient.invalidateQueries(),
  })
}

export function useAddApprover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { instanceId: number; actorId: number }) =>
      engineFetch(`/approvals/${input.instanceId}/add-approver`, approvalInstanceDtoSchema, {
        method: "POST",
        body: { actorId: input.actorId },
      }),
    onSuccess: () => void queryClient.invalidateQueries(),
  })
}

export function useUnlockApproval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { instanceId: number; comment: string }) =>
      engineFetch(`/approvals/${input.instanceId}/unlock`, approvalInstanceDtoSchema, {
        method: "POST",
        body: { comment: input.comment },
      }),
    onSuccess: () => void queryClient.invalidateQueries(),
  })
}

export function useDecideApproval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      instanceId: number
      decision: "approve" | "reject"
      comment?: string
    }) =>
      engineFetch(`/approvals/${input.instanceId}/decide`, approvalInstanceDtoSchema, {
        method: "POST",
        body: { decision: input.decision, ...(input.comment ? { comment: input.comment } : {}) },
      }),
    onSuccess: () => void queryClient.invalidateQueries(),
  })
}

export function useWithdrawApproval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (instanceId: number) =>
      engineFetch(`/approvals/${instanceId}/withdraw`, approvalInstanceDtoSchema, {
        method: "POST",
        body: {},
      }),
    onSuccess: () => void queryClient.invalidateQueries(),
  })
}

/* R1·後續-2 標籤定義 */
export const labelKeys = { list: (formId: number) => ["forms", formId, "labels"] as const }

export function useLabels(formId: number | null) {
  return useQuery({
    queryKey: labelKeys.list(formId ?? -1),
    queryFn: () => engineFetch(`/forms/${formId}/labels`, z.array(labelDtoSchema)),
    enabled: formId !== null,
    staleTime: 30_000,
  })
}

export function useCreateLabel(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { name: string; config: LabelConfig }) =>
      engineFetch(`/forms/${formId}/labels`, labelDtoSchema, { method: "POST", body: input }),
    onSuccess: () => invalidate([labelKeys.list(formId)]),
  })
}

export function useUpdateLabel(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { labelId: number; patch: { name?: string; config?: LabelConfig } }) =>
      engineFetch(`/forms/${formId}/labels/${input.labelId}`, labelDtoSchema, {
        method: "PATCH",
        body: input.patch,
      }),
    onSuccess: () => invalidate([labelKeys.list(formId)]),
  })
}

export function useDeleteLabel(formId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (labelId: number) =>
      engineFetch(`/forms/${formId}/labels/${labelId}`, voidSchema, { method: "DELETE" }),
    onSuccess: () => invalidate([labelKeys.list(formId)]),
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

/* R1·workbench-uplift A5|actor id → 顯示名。以排序後的 id 集合為 key → 同一組 id 共用快取;
   稽核區每筆記錄只有建立者/更新者兩個 id,故一次請求即足。 */
export function useUserNames(actorIds: readonly number[]) {
  const ids = [...new Set(actorIds.filter((id) => Number.isSafeInteger(id) && id > 0))].sort(
    (a, b) => a - b,
  )
  return useQuery({
    queryKey: ["users", "lookup", ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => engineFetch(`/users/lookup?ids=${ids.join(",")}`, z.array(userNameSchema)),
  })
}

/* A3|反向關聯(本筆被哪些記錄引用)。記錄切換即重取;無關聯時後端回空陣列。 */
export function useReverseRelations(formId: number, recordId: number | null) {
  return useQuery({
    queryKey: ["forms", formId, "records", recordId, "relations"],
    enabled: recordId !== null,
    queryFn: () =>
      engineFetch(
        `/forms/${formId}/records/${String(recordId)}/relations`,
        z.array(reverseRelationGroupSchema),
      ),
  })
}

/* ── H-1 通知 ───────────────────────────────────────────────── */

export const notificationKeys = {
  list: ["notifications"] as const,
  settings: ["notifications", "settings"] as const,
}

export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => engineFetch("/notifications", notificationListSchema),
    /* 輪詢而非推送:PgBouncer transaction mode 下 LISTEN/NOTIFY 不可用,
       且 SSE/WebSocket 為獨立題目。60 秒對簽核場景足夠。 */
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useMarkNotificationsRead() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (ids: readonly number[]) =>
      engineFetch("/notifications/read", z.unknown(), {
        method: "POST",
        body: { ids },
      }),
    onSuccess: () => invalidate([notificationKeys.list]),
  })
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => engineFetch("/notifications/read-all", z.unknown(), { method: "POST" }),
    onSuccess: () => invalidate([notificationKeys.list]),
  })
}

export function useNotificationSettings() {
  return useQuery({
    queryKey: notificationKeys.settings,
    queryFn: () => engineFetch("/notifications/settings", notificationSettingsSchema),
  })
}

export function useSaveNotificationSettings() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { enabled: boolean; channels: Record<string, string[]> | null }) =>
      engineFetch("/notifications/settings", z.unknown(), { method: "POST", body: input }),
    onSuccess: () => invalidate([notificationKeys.settings, notificationKeys.list]),
  })
}

/* 🔴 恢復繼承(刪除該層的偏好列)。**與 save 分開而不是「存一個特殊值」** ——
   「跟著上層走」和「明確設成某個層級」是兩種狀態,用哨兵值表達會在
   上層日後改變時失真(那正是繼承的意義)。 */
export function useClearNotificationPref() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { scope: "tenant" | "category" | "form"; scopeId: number | null }) =>
      engineFetch("/notifications/prefs", z.unknown(), { method: "DELETE", body: input }),
    onSuccess: () => invalidate([notificationKeys.settings]),
  })
}

export function useSaveNotificationPref() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: {
      scope: "tenant" | "category" | "form"
      scopeId: number | null
      level: number
      customEvents: string[] | null
    }) => engineFetch("/notifications/prefs", z.unknown(), { method: "POST", body: input }),
    onSuccess: () => invalidate([notificationKeys.settings]),
  })
}

/* H-2 回收桶 */
export const trashKeys = { list: ["trash"] as const }

export function useTrash() {
  return useQuery({
    queryKey: trashKeys.list,
    queryFn: () =>
      engineFetch(
        "/trash",
        z.object({ items: z.array(trashItemSchema), retentionDays: z.number() }),
      ),
    staleTime: 15_000,
  })
}

export function useRestoreTrash() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (entryId: number) =>
      engineFetch(
        `/trash/${String(entryId)}/restore`,
        z.object({ ok: z.boolean(), blockers: z.array(restoreBlockerSchema) }),
        { method: "POST" },
      ),
    /* 還原會讓表單 / 記錄重新出現 → 表單清單也得失效,否則還原完看不到東西 */
    onSuccess: () => invalidate([trashKeys.list, formKeys.all]),
  })
}

export function usePurgeTrash() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (entryId: number) =>
      engineFetch(`/trash/${String(entryId)}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => invalidate([trashKeys.list]),
  })
}

/* G-1 整合設定 */
export const integrationKeys = {
  webhooks: ["integrations", "webhooks"] as const,
  deliveries: (id: number) => ["integrations", "webhooks", id, "deliveries"] as const,
  apiKeys: ["integrations", "api-keys"] as const,
}

export function useWebhooks() {
  return useQuery({
    queryKey: integrationKeys.webhooks,
    queryFn: () =>
      engineFetch(
        "/integrations/webhooks",
        z.object({ endpoints: z.array(webhookEndpointSchema) }),
      ),
    staleTime: 15_000,
  })
}

export function useCreateWebhook() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { url: string; description?: string; eventTypes: string[] }) =>
      engineFetch(
        "/integrations/webhooks",
        z.object({ id: z.number(), secret: z.string(), verifyToken: z.string() }),
        { method: "POST", body: input },
      ),
    onSuccess: () => invalidate([integrationKeys.webhooks]),
  })
}

export function useWebhookAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { id: number; action: "enable" | "disable" | "test" }) =>
      engineFetch(`/integrations/webhooks/${String(input.id)}/${input.action}`, z.unknown(), {
        method: "POST",
      }),
    onSuccess: () => invalidate([integrationKeys.webhooks]),
  })
}

export function useRotateWebhookSecret() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) =>
      engineFetch(
        `/integrations/webhooks/${String(id)}/rotate-secret`,
        z.object({ secret: z.string() }),
        { method: "POST" },
      ),
    onSuccess: () => invalidate([integrationKeys.webhooks]),
  })
}

export function useDeleteWebhook() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) =>
      engineFetch(`/integrations/webhooks/${String(id)}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => invalidate([integrationKeys.webhooks]),
  })
}

export function useWebhookDeliveries(endpointId: number | null) {
  return useQuery({
    queryKey: integrationKeys.deliveries(endpointId ?? -1),
    queryFn: () =>
      engineFetch(
        `/integrations/webhooks/${String(endpointId)}/deliveries`,
        z.object({ deliveries: z.array(webhookDeliverySchema) }),
      ),
    enabled: endpointId !== null,
    staleTime: 5_000,
  })
}

export function useRedeliver(endpointId: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (deliveryId: number) =>
      engineFetch(`/integrations/deliveries/${String(deliveryId)}/redeliver`, z.unknown(), {
        method: "POST",
      }),
    onSuccess: () => invalidate([integrationKeys.deliveries(endpointId)]),
  })
}

export function useApiKeys() {
  return useQuery({
    queryKey: integrationKeys.apiKeys,
    queryFn: () => engineFetch("/integrations/api-keys", z.object({ keys: z.array(apiKeySchema) })),
    staleTime: 15_000,
  })
}

export function useIssueApiKey() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { name: string; subjectActorId: number; scopes: string[] }) =>
      engineFetch(
        "/integrations/api-keys",
        z.object({ id: z.number(), key: z.string(), keyPrefix: z.string() }),
        { method: "POST", body: input },
      ),
    onSuccess: () => invalidate([integrationKeys.apiKeys]),
  })
}

export function useRevokeApiKey() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: number) =>
      engineFetch(`/integrations/api-keys/${String(id)}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => invalidate([integrationKeys.apiKeys]),
  })
}

/* G-2 公開表單 */
export const publicFormKeys = {
  shares: ["public-forms"] as const,
  inbox: ["public-forms", "inbox"] as const,
}

export function usePublicShares() {
  return useQuery({
    queryKey: publicFormKeys.shares,
    queryFn: () => engineFetch("/public-forms", z.object({ shares: z.array(publicShareSchema) })),
    staleTime: 15_000,
  })
}

/* 🔴 可公開的欄位型別由**後端**回。前端不自己維護一份清單 ——
   兩份會漂移,而漂移的症狀是使用者挑得到一個必定失敗的欄位。 */
/* 🔴 R1·LNK M1|連結欄的候選記錄。**候選由後端過權限** ——
   來源表單的權限不蘊含目標表單的權限,且只在前端過濾等於沒做(OQ-PC-12 的教訓)。 */
export function useLinkOptions(formId: number, fieldId: number, q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["link-options", formId, fieldId, q] as const,
    queryFn: () =>
      engineFetch(
        `/forms/${String(formId)}/fields/${String(fieldId)}/link-options?q=${encodeURIComponent(q)}`,
        z.object({ options: z.array(z.object({ id: z.number(), label: z.string() })) }),
      ),
    enabled,
    staleTime: 15_000,
  })
}

export function usePublicSafeTypes() {
  return useQuery({
    queryKey: ["public-forms", "safe-types"],
    queryFn: () =>
      engineFetch("/public-forms/safe-types", z.object({ types: z.array(z.string()) })),
    staleTime: 300_000,
  })
}

export function useCreateShare() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: {
      formId: number
      title: string
      fieldIds: number[]
      maxSubmissions?: number
    }) =>
      engineFetch("/public-forms", z.object({ id: z.number(), token: z.string() }), {
        method: "POST",
        body: input,
      }),
    onSuccess: () => invalidate([publicFormKeys.shares]),
  })
}

export function useShareToggle() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { id: number; action: "open" | "close" }) =>
      engineFetch(`/public-forms/${String(input.id)}/${input.action}`, z.unknown(), {
        method: "POST",
      }),
    onSuccess: () => invalidate([publicFormKeys.shares]),
  })
}

export function useSubmissionInbox() {
  return useQuery({
    queryKey: publicFormKeys.inbox,
    queryFn: () =>
      engineFetch(
        "/public-forms/inbox",
        z.object({ submissions: z.array(publicSubmissionSchema) }),
      ),
    staleTime: 10_000,
  })
}

export function useReviewSubmission() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { id: number; action: "promote" | "reject"; reason?: string }) =>
      engineFetch(
        `/public-forms/inbox/${String(input.id)}/${input.action}`,
        z.unknown(),
        input.action === "reject"
          ? { method: "POST", body: { reason: input.reason ?? "不符需求" } }
          : { method: "POST" },
      ),
    /* promote 會建立真記錄 → 表單清單與記錄快取都要失效 */
    onSuccess: () => invalidate([publicFormKeys.inbox, publicFormKeys.shares, formKeys.all]),
  })
}
