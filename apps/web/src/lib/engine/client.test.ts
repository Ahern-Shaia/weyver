import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  EngineApiError,
  describeEngineError,
  engineFetch,
  getDevTenant,
  setDevTenant,
} from "./client"
import { fieldDtoSchema, formDtoSchema, recordRowSchema } from "./schemas"

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe("dev tenant", () => {
  it("defaults to 1 and persists override", () => {
    expect(getDevTenant()).toBe("1")
    setDevTenant("42")
    expect(getDevTenant()).toBe("42")
  })
})

describe("engineFetch", () => {
  it("parses a valid response and sends tenant header", async () => {
    const spy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", spy)
    const result = await engineFetch("/health", z.object({ ok: z.boolean() }))
    expect(result.ok).toBe(true)
    const headers = (spy.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers["x-dev-tenant"]).toBe("1")
  })

  it("maps error envelope to EngineApiError", async () => {
    mockFetch(409, {
      code: "VERSION_CONFLICT",
      message: "record 5 version conflict",
      correlationId: "abc-123",
      timestamp: "2026-07-19T00:00:00Z",
    })
    const error = await engineFetch("/x", z.unknown()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineApiError)
    const apiError = error as EngineApiError
    expect(apiError.status).toBe(409)
    expect(apiError.code).toBe("VERSION_CONFLICT")
    expect(apiError.correlationId).toBe("abc-123")
    expect(describeEngineError(apiError)).toContain("重新載入")
  })

  it("handles non-envelope error bodies", async () => {
    mockFetch(502, "bad gateway")
    const error = await engineFetch("/x", z.unknown()).catch((e: unknown) => e)
    expect((error as EngineApiError).code).toBe("UNKNOWN")
  })

  it("rejects shape-drifted responses (Zod boundary)", async () => {
    mockFetch(200, { id: "not-a-number" })
    await expect(engineFetch("/x", fieldDtoSchema)).rejects.toThrow()
  })
})

describe("response schemas", () => {
  it("accepts backend DTO shapes", () => {
    expect(
      formDtoSchema.safeParse({
        id: 1,
        name: "採購單",
        provisionState: "ready",
        version: 1,
        parentFormId: null,
        fields: [
          {
            id: 2,
            name: "金額",
            type: "money",
            required: false,
            unique: false,
            options: { currency: "TWD" },
            position: 0,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      recordRowSchema.safeParse({
        id: 1,
        version: 1,
        createdAt: "2026-07-19T05:45:02.592Z",
        createdBy: 1,
        updatedAt: "2026-07-19T05:45:02.592Z",
        updatedBy: 1,
        parentId: null,
        lineNo: null,
        values: { 單號: "PO-0001" },
      }).success,
    ).toBe(true)
  })

  it("rejects unknown provisionState", () => {
    expect(
      formDtoSchema.safeParse({
        id: 1,
        name: "x",
        provisionState: "exploded",
        version: 1,
        parentFormId: null,
        fields: [],
      }).success,
    ).toBe(false)
  })
})
