import type { z } from "zod"
import { errorEnvelopeSchema } from "./schemas"

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
