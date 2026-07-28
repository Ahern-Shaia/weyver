import type { z } from "zod"
import { errorEnvelopeSchema, fileDtoSchema } from "./schemas"

const BASE = "/api/engine"
const DEV_TENANT_KEY = "weyver.devTenant"

/* F-2 前的開發期租戶來源(換 JWT 時只改此檔) */
export function getDevTenant(): string {
  if (typeof window === "undefined") return "1"
  return window.localStorage.getItem(DEV_TENANT_KEY) ?? "1"
}

export function setDevTenant(tenantId: string): void {
  window.localStorage.setItem(DEV_TENANT_KEY, tenantId)
}

export class EngineApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message)
  }
}

export function describeEngineError(error: unknown): string {
  if (error instanceof EngineApiError) {
    if (error.code === "VERSION_CONFLICT") return "資料已被其他人修改,請重新載入後再試。"
    if (error.code === "TENANT_REQUIRED") return "缺少租戶識別,請重新整理頁面。"
    if (error.status === 404) return "找不到資料(可能已被移除)。"
    return error.message
  }
  if (error instanceof Error) return error.message
  return "發生未知錯誤。"
}

export async function engineFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-dev-tenant": getDevTenant(),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => ({}))
    const parsed = errorEnvelopeSchema.safeParse(raw)
    if (parsed.success) {
      throw new EngineApiError(
        response.status,
        parsed.data.code,
        parsed.data.message,
        parsed.data.correlationId,
      )
    }
    throw new EngineApiError(response.status, "UNKNOWN", `HTTP ${response.status}`)
  }

  if (response.status === 204) return schema.parse(undefined)
  return schema.parse(await response.json())
}

/* F-5 檔案:上傳走 multipart(不設 content-type,交瀏覽器帶 boundary);
   下載走 fetch + blob —— 純 <a href> 於 dev 帶不了 x-dev-tenant 標頭,且可統一錯誤處理。 */
export async function uploadFile(
  formId: number,
  fieldId: number,
  file: File,
): Promise<{ key: string; name: string; mime: string; size: number }> {
  const body = new FormData()
  body.append("file", file)
  const response = await fetch(`${BASE}/forms/${formId}/files?fieldId=${fieldId}`, {
    method: "POST",
    headers: { "x-dev-tenant": getDevTenant() },
    body,
  })
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => ({}))
    const parsed = errorEnvelopeSchema.safeParse(raw)
    throw new EngineApiError(
      response.status,
      parsed.success ? parsed.data.code : "UNKNOWN",
      parsed.success ? parsed.data.message : `HTTP ${response.status}`,
    )
  }
  return fileDtoSchema.parse(await response.json())
}

/* 取檔案位元組(下載與影像預覽共用;預覽見 use-file-preview) */
export async function fetchFileBlob(key: string): Promise<Blob> {
  const response = await fetch(`${BASE}/files/${key}`, {
    headers: { "x-dev-tenant": getDevTenant() },
  })
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => ({}))
    const parsed = errorEnvelopeSchema.safeParse(raw)
    throw new EngineApiError(
      response.status,
      parsed.success ? parsed.data.code : "UNKNOWN",
      parsed.success ? parsed.data.message : `HTTP ${response.status}`,
    )
  }
  return response.blob()
}

export async function downloadFile(key: string, name: string): Promise<void> {
  const url = URL.createObjectURL(await fetchFileBlob(key))
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = name
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function deleteFile(key: string): Promise<void> {
  await fetch(`${BASE}/files/${key}`, {
    method: "DELETE",
    headers: { "x-dev-tenant": getDevTenant() },
  })
}
