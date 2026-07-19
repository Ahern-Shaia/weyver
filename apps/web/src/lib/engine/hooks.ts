"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { engineFetch } from "./client"
import {
  formDtoSchema,
  formSummarySchema,
  listResponseSchema,
  recordRowSchema,
  type AddFieldInput,
  type CreateFormInput,
  type FormDto,
  type ListResponse,
  type RecordRow,
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
