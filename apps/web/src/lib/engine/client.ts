import type { z } from "zod"
import { errorEnvelopeSchema, fileDtoSchema } from "./schemas"

/* 匯出的下載自己組 fetch(POST + 兩種回應形狀),需要同一個前綴 —— 別各寫一份字面值 */
export const BASE = "/api/engine"
const DEV_TENANT_KEY = "weyver.devTenant"

/* F-2 前的開發期租戶來源(換 JWT 時只改此檔) */
export function getDevTenant(): string {
  if (typeof window === "undefined") return "1"
  return window.localStorage.getItem(DEV_TENANT_KEY) ?? "1"
}

export function setDevTenant(tenantId: string): void {
  window.localStorage.setItem(DEV_TENANT_KEY, tenantId)
}

/* 🔴 F-10|分頁級租戶上下文。

   租戶原本只存在伺服器端 session 列的 `activeOrganizationId`,而那是**整個瀏覽器共用**的。
   分頁 2 切公司會改到分頁 1 的租戶 → 分頁 1 的下一次寫入落到錯的公司。

   解法是每個請求帶上「這個分頁以為自己在哪家」,伺服器**獨立驗成員資格**後採用。
   語意與被剝除的 `x-tenant-id` 的差別見後端 `auth/org-intent.ts`。

   **這個值由 app layout 在取得 active org 時設定,不從 localStorage 推**
   —— localStorage 同樣是跨分頁共用的,用它等於換一個地方犯同樣的錯。 */
const ORG_INTENT_HEADER = "x-weyver-org-intent"
let tabOrgIntent: string | null = null

export function setTabOrgIntent(orgId: string | null): void {
  tabOrgIntent = orgId
}

/* 🔴 **所有** 對引擎的請求都必須經過這裡。
   FMEA T2:漏帶的路徑會靜默退回 session 行為,等於沒修 —— 所以只留這一個出口。 */
export function engineHeaders(
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    "x-dev-tenant": getDevTenant(),
    ...(tabOrgIntent === null ? {} : { [ORG_INTENT_HEADER]: tabOrgIntent }),
    ...extra,
  }
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
    /* F-7:HEIC(iPhone 預設格式)伺服器端無法解碼 —— HEVC 專利池將雲端服務納入收費範圍,
       故不在伺服器轉檔。給可行動的指引,而非只說「不支援」。 */
    if (error.code === "UNSUPPORTED_FILE_TYPE") {
      return "不支援的檔案格式。若為 iPhone 照片(HEIC),請於 iPhone 設定 →相機 →格式 選「最相容」後重拍,或改用截圖 / 匯出成 JPEG。"
    }
    if (error.code === "IMAGE_UNREADABLE") return "影像檔無法解析,可能在傳輸中損毀,請重新上傳。"
    if (error.code === "IMAGE_TOO_LARGE") return "影像尺寸過大,請縮小後再上傳。"
    return error.message
  }
  if (error instanceof Error) return error.message
  return "發生未知錯誤。"
}

export async function engineFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  /* idempotencyKey:網路重試不該讓同一個 mutation 生效兩次(後端 IdempotencyInterceptor
     以此標頭去重;不帶則直接放行,既有呼叫端不受影響)。 */
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  /* content-type 只在**真的有 body** 時才送 —— Fastify 對「宣告 application/json
     但 body 為空」直接回 500(無 body 的 POST 如「全部標為已讀」會踩到)。
     沒有 body 就沒有內容型別可宣告,這也是正確的 HTTP 語意。 */
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: engineHeaders({
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
    }),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => ({}))
    const parsed = errorEnvelopeSchema.safeParse(raw)
    if (parsed.success) {
      /* 🔴 首次登入尚未自設密碼 → 後端**每一支 API** 都回這個 code(AuthGuard)。
         在這裡統一導出去,不讓每頁自己接:同一個道理 #140 已經學過一次 ——
         「逐頁自律」會漏,而漏掉的那幾頁不會有人發現。 */
      if (parsed.data.code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined") {
        if (window.location.pathname !== "/set-password") window.location.href = "/set-password"
      }
      /* 🔴 公司要求二步驟驗證但這個人還沒啟用 → 直接帶去啟用的地方。
         同上:每一支 API 都會回這個 code,由此統一接。
         留在原頁只會看到一片「載入失敗」,而使用者根本不知道要去哪裡處理。
         **`/app/settings/security` 自己的請求已在後端豁免**,不會導成迴圈。 */
      if (parsed.data.code === "MFA_REQUIRED" && typeof window !== "undefined") {
        if (window.location.pathname !== "/app/settings/security") {
          window.location.href = "/app/settings/security?mfa=required"
        }
      }
      throw new EngineApiError(
        response.status,
        parsed.data.code,
        parsed.data.message,
        parsed.data.correlationId,
      )
    }
    throw new EngineApiError(response.status, "UNKNOWN", `HTTP ${response.status}`)
  }

  /* 🔴 204 不是「無內容」的唯一形態。NestJS 的 `Promise<void>` handler 在 PATCH / POST
     上回的是 **200 + 空 body**,而 `response.json()` 對空 body 會擲
     「Unexpected end of JSON input」——那個訊息會原封不動出現在使用者的設定面板上。

     ⚠️ 這條路徑活到 2026-08-04 才被發現,因為**兩個呼叫端的測試都是打 API 設值的**
     (日期顯示格式的 e2e 用 `request.patch`),UI 的那一趟從來沒有人走過。
     這正是 audit-D 的主題:設定類功能最容易只在後端被驗證。 */
  if (response.status === 204) return schema.parse(undefined)
  const text = await response.text()
  if (text === "") return schema.parse(undefined)
  return schema.parse(JSON.parse(text))
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
    headers: engineHeaders(),
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

/* #106 匯入既有表單:解析在後端(OQ-IMP-6)—— 前端只上傳與顯示。
   同 uploadFile,不設 content-type 交瀏覽器帶 boundary。 */
export async function analyzeImport(formId: number, file: File, sheet?: string): Promise<unknown> {
  const body = new FormData()
  body.append("file", file)
  const query = sheet === undefined ? "" : `?sheet=${encodeURIComponent(sheet)}`
  const response = await fetch(`${BASE}/forms/${formId}/import/analyze${query}`, {
    method: "POST",
    headers: engineHeaders(),
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
  return response.json()
}

/* 取檔案位元組(下載與影像預覽共用;預覽見 use-file-preview)。
   `variant="thumb"` 取縮圖 —— 後端取不到縮圖會自動回原檔,故前端永不破圖(F-7 OQ-IP-9=A)。 */
export async function fetchFileBlob(key: string, variant?: "thumb"): Promise<Blob> {
  const query = variant === undefined ? "" : `?variant=${variant}`
  const response = await fetch(`${BASE}/files/${key}${query}`, {
    headers: engineHeaders(),
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
    headers: engineHeaders(),
  })
}
