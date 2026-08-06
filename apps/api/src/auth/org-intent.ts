import type { IncomingHttpHeaders } from "node:http"
import { ConflictException } from "@nestjs/common"

/* 🔴 F-10|分頁級租戶上下文。

   ## 為什麼需要它

   租戶原本只來自伺服器端 session 列的 `activeOrganizationId`,而那一列是
   **整個瀏覽器共用的**。分頁 2 切換公司會改到分頁 1 的租戶,
   於是分頁 1 的下一次寫入落到錯的公司 —— 而且沒有任何訊號。

   Shopify 對非嵌入式 app 的同一問題官方回覆是「無 workaround,請改架構」;
   Clerk 官方文件逐字警告 session cookie 是 **singleton (global) value**;
   Better Auth 官方也已預期並明文把解法推給應用層。

   ## 🔴 這個 header 與 AGENTS 鐵則 3 剝除的那些差在哪

   **差別細微,而且改錯的後果是 BOLA。所以寫在這裡而不是只寫在 doc。**

   | | 語意 | 後果 |
   |---|---|---|
   | `x-tenant-id`(**剝除**) | 「這**就是**我的租戶」= 授權結論 | 送什麼給什麼 → OWASP API1 BOLA |
   | `x-weyver-org-intent`(**本檔**) | 「我**以為**我在這個租戶」= 選擇器 | 伺服器**獨立查成員資格**才採用 |

   攻擊者偽造 intent 的上限 = **他本來就進得去的租戶**。
   風險因此從「越權」降為「誤寫」,而誤寫正是 mismatch 檢查要擋的那一半。

   **⚠️ 若日後有人為了「簡化」而拿掉成員驗證,這個 header 立刻變成 BOLA。**
   `org-intent.test.ts` 有一條測試專門釘住這件事。 */

export const ORG_INTENT_HEADER = "x-weyver-org-intent"

/* 讀取路徑不擋:使用者回頭看舊分頁的資料是合理的。
   寫入路徑必須擋:讓人明確決定要寫進哪一家,而不是靜默寫錯。 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function readOrgIntent(headers: IncomingHttpHeaders): string | null {
  const raw = headers[ORG_INTENT_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

export function isMutation(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase())
}

/* 分頁想寫進 A,但目前作業租戶已是 B → 不猜,交回給人決定。

   **刻意不在信封裡帶兩邊的 org id**:AGENTS 橫切鐵則要求統一信封
   (code / message / correlationId / timestamp),為單一案例加欄位會侵蝕它。
   而前端本來就兩邊都有 —— intent 是它自己送的,目前的 active org 由
   `useActiveOrganization()` 讀得到,還能拿到公司**名稱**(比 id 更適合給人看)。 */
export class TenantContextMismatchError extends ConflictException {
  constructor() {
    super({
      code: "TENANT_CONTEXT_MISMATCH",
      message: "此分頁的作業公司與目前選定的公司不同,請確認要寫入哪一家",
    })
  }
}
