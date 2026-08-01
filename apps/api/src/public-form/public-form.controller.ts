import crypto from "node:crypto"
import { Body, Controller, Get, Headers, Inject, Ip, Param, Post } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { z } from "zod"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { PublicFormConfigError, PublicFormService } from "./public-form.service.js"

/* 🔴 G-2|**唯一一條對未登入者開放的路徑**。

   本控制器刻意**不掛 TenantGuard / PermissionGuard** —— 訪客沒有租戶身分,
   租戶是由 token 反查出來的。正因為少了那兩道,這裡的每一個防護都要自己寫足:

   - token 是唯一憑證 → 高熵 + 只存 hash + 查無與已關閉回同一種訊息
   - 限流以 **IP × token 雙鍵**,單看 IP 會誤傷同公司多人填寫
   - honeypot + 最短填寫時間:對機器人有效且對真人零成本(不需要解謎)
   - IP 只存 hash:留追查能力,不留可回推的個資

   ⚠️ 濫用防護是**分層**的,沒有哪一層是閘門。PoW CAPTCHA 只提高成本不阻擋
   (2026 研究顯示 AI solver 已可破多數 CAPTCHA),所以限流與提交上限不能省。 */

const submitSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  /* honeypot:真人看不到這個欄位,填了就是機器人。
     命名刻意像真欄位 —— 叫 "honeypot" 等於告訴對方不要填。 */
  company_website: z.string().max(0).optional(),
  /* 前端載入表單的時間戳。人類填完一張表不可能在兩秒內。 */
  renderedAt: z.number().int().optional(),
})

const MIN_FILL_SECONDS = 2

@Controller("api/public/forms")
export class PublicFormController {
  /* 🔴 必須顯式 `@Inject()`。本專案的 tsconfig 未開 `emitDecoratorMetadata`,
     裸建構子參數拿不到 design:paramtypes → Nest 注入 undefined,
     而且**編譯期完全看不出來**:type-check 過、整合測也過(它們直接 new 服務,
     繞過 DI),只有真的把 app 跑起來打那條路由才會炸。 */
  constructor(@Inject(PublicFormService) private readonly forms: PublicFormService) {}

  /* 取表單定義。限流較寬(同一批人可能反覆整理頁面),但仍要有 ——
     否則這個端點會變成免費的 token 爆破入口。 */
  @Get(":token")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async view(@Param("token") token: string) {
    const view = await this.forms.resolvePublicForm(token)
    /* 只回渲染所需。**不回 tenantId / formId / shareId** —— 訪客不需要知道,
       而洩漏它們等於給出可猜測的內部識別。 */
    return {
      title: view.title,
      description: view.description,
      requireCaptcha: view.requireCaptcha,
      fields: view.fields,
      renderedAt: Date.now(),
    }
  }

  @Post(":token/submit")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async submit(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(submitSchema)) body: z.infer<typeof submitSchema>,
    @Ip() ip: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    /* honeypot 命中 → 回成功但不寫入。回錯誤會讓對方知道被識破而去調整。 */
    if (body.company_website !== undefined && body.company_website !== "") {
      return { ok: true, reference: syntheticReference() }
    }
    if (body.renderedAt !== undefined && Date.now() - body.renderedAt < MIN_FILL_SECONDS * 1000) {
      throw new PublicFormConfigError("送出得太快了,請確認填寫內容後再試一次")
    }

    const { submissionId } = await this.forms.submit({
      token,
      values: body.values,
      ipHash: hashIp(ip),
      userAgent: userAgent ?? null,
    })

    /* 🔴 回執給**不透明 token**,不給流水號(OQ-PF-4)。
       連號單據會洩漏業務量與成長速度(German tank problem)—— 對 ERP 尤其致命,
       競爭對手可據以推算你一天出幾張單。 */
    return { ok: true, reference: opaqueReference(submissionId) }
  }
}

/* IP 只存 hash:保留「同一來源灌單」的追查能力,但不留可回推的個資。
   加鹽以免同一 IP 在不同部署間可被比對。 */
function hashIp(ip: string): string {
  const salt = process.env["PUBLIC_FORM_IP_SALT"] ?? "weyver-public-form"
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32)
}

function opaqueReference(submissionId: number): string {
  const salt = process.env["PUBLIC_FORM_IP_SALT"] ?? "weyver-public-form"
  const mac = crypto
    .createHmac("sha256", salt)
    .update(String(submissionId))
    .digest("base64url")
    .slice(0, 10)
  return `R-${mac.toUpperCase()}`
}

/* honeypot 命中時回一個形狀相同但無意義的回執,讓機器人看不出差別。 */
function syntheticReference(): string {
  return `R-${crypto.randomBytes(8).toString("base64url").slice(0, 10).toUpperCase()}`
}
