import crypto from "node:crypto"
import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../db/db.module.js"
import {
  fieldDefs,
  formulaDefs,
  publicFormShares,
  publicSubmissions,
} from "../db/schema.js"
import { DomainError } from "../form-engine/errors.js"

/* G-2|公開表單。把一張內部表單開放給**未登入者**填寫。 */

export class PublicFormConfigError extends DomainError {}
export class PublicFormClosedError extends DomainError {
  constructor(readonly publicMessage: string) {
    super(publicMessage)
  }
}

/* 匿名者可安全填寫的型別。刻意用白名單而非黑名單 —— 新增型別時預設不開放,
   由人決定它是否適合給陌生人填,而不是預設開放再回頭補。 */
const PUBLIC_SAFE_TYPES = new Set([
  "text",
  "longText",
  "number",
  "email",
  "url",
  "phone",
  "date",
  "dateTime",
  "singleSelect",
  "multiSelect",
  "checkbox",
  "rating",
  "money",
  "percent",
])

/* 🔴 一律不得公開。理由各異但都是「給匿名者看等於洩漏或失控」:
   - link:候選清單會列舉來源表(Airtable 實證的最大破口)
   - lookup / rollup / formula:值來自別處,公開它等於公開來源
   - autoNumber:連號單據洩漏業務量(German tank problem)
   - createdBy / updatedBy / member:內部人員名冊
   - attachment / image / signature:需掃毒,平台尚未具備(#102) */
const PUBLIC_FORBIDDEN_TYPES = new Set([
  "link",
  "lookup",
  "rollup",
  "formula",
  "autoNumber",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "member",
  "attachment",
  "image",
  "signature",
  "barcode",
])

export interface ShareConfigInput {
  readonly formId: number
  readonly title: string
  readonly description?: string | undefined
  readonly fieldIds: readonly number[]
  readonly closesAt?: Date | undefined
  readonly maxSubmissions?: number | undefined
}

export interface PublicFormView {
  readonly shareId: number
  readonly tenantId: number
  readonly formId: number
  readonly title: string
  readonly description: string | null
  readonly requireCaptcha: boolean
  readonly fields: readonly {
    readonly id: number
    readonly name: string
    readonly type: string
    readonly required: boolean
    readonly options: Record<string, unknown>
  }[]
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

@Injectable()
export class PublicFormService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    /* token 解析發生在 tenant context 之前(訪客沒有租戶身分)→ 特權車道 */
    @Inject(DRIZZLE) private readonly privileged: DrizzleDb,
  ) {}

  /* 🔴 白名單驗證。三道,缺一不可(OQ-PF-1/2/3)。 */
  async assertWhitelistSafe(tenantId: number, input: ShareConfigInput): Promise<void> {
    if (input.fieldIds.length === 0) {
      throw new PublicFormConfigError("至少要選一個欄位才能開放填寫")
    }
    const fields = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(fieldDefs)
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.formId, input.formId),
            isNull(fieldDefs.deletedAt),
          ),
        ),
    )
    const byId = new Map(fields.map((f) => [f.id, f]))
    const chosen = new Set(input.fieldIds)

    for (const id of input.fieldIds) {
      const field = byId.get(id)
      if (field === undefined) throw new PublicFormConfigError(`欄位 ${String(id)} 不屬於這張表單`)

      if (PUBLIC_FORBIDDEN_TYPES.has(field.cellValueType)) {
        throw new PublicFormConfigError(
          `「${field.name}」是 ${field.cellValueType} 欄位,不得公開:${reasonFor(field.cellValueType)}`,
        )
      }
      if (!PUBLIC_SAFE_TYPES.has(field.cellValueType)) {
        throw new PublicFormConfigError(
          `「${field.name}」的型別(${field.cellValueType})尚未通過公開安全性評估,暫不開放`,
        )
      }
    }

    /* 🔴 PF-2|公式不得引用未公開的欄位。

       authz.md §12.2 **F4** 把「公式引用 hidden 欄 → 結果值間接洩漏」列為
       **已接受的 P1 殘留**,理由是內部可靠管理員配置紀律。
       但**觀眾換成匿名者後,同一個洞就是 P0** —— 既有風險評級是綁定威脅模型的,
       開放新入口時必須重評,不能沿用。故此處**設計期直接擋下**。

       (目前 formula 型別已在 FORBIDDEN 清單,此檢查是為日後放行公式欄預留的
        第二道防線 —— 兩道都在,拿掉任一道另一道仍擋得住。) */
    const formulas = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(formulaDefs)
        .where(and(eq(formulaDefs.tenantId, tenantId), eq(formulaDefs.formId, input.formId))),
    )
    for (const formula of formulas) {
      if (!chosen.has(formula.fieldId)) continue
      const deps = Array.isArray(formula.dependsOn) ? (formula.dependsOn as unknown[]) : []
      for (const dep of deps) {
        const depId = typeof dep === "number" ? dep : Number(dep)
        if (!Number.isFinite(depId) || chosen.has(depId)) continue
        const depName = byId.get(depId)?.name ?? `欄位 ${String(depId)}`
        throw new PublicFormConfigError(
          `公式欄「${byId.get(formula.fieldId)?.name ?? ""}」引用了未公開的「${depName}」——` +
            "公開它等於間接洩漏來源欄的值。請一併公開來源欄,或把公式欄移出公開範圍。",
        )
      }
    }
  }

  async create(
    tenantId: number,
    actorId: number,
    input: ShareConfigInput,
  ): Promise<{ id: number; token: string }> {
    await this.assertWhitelistSafe(tenantId, input)
    const token = crypto.randomBytes(24).toString("base64url")
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .insert(publicFormShares)
        .values({
          tenantId,
          formId: input.formId,
          tokenHash: hashToken(token),
          title: input.title,
          description: input.description ?? null,
          fieldIds: [...input.fieldIds],
          closesAt: input.closesAt ?? null,
          maxSubmissions: input.maxSubmissions ?? null,
          createdBy: actorId,
        })
        .returning({ id: publicFormShares.id }),
    )
    const row = rows[0]
    if (row === undefined) throw new Error("insert public_form_share returned no row")
    return { id: row.id, token }
  }

  async list(tenantId: number) {
    return this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: publicFormShares.id,
          formId: publicFormShares.formId,
          title: publicFormShares.title,
          fieldIds: publicFormShares.fieldIds,
          active: publicFormShares.active,
          closesAt: publicFormShares.closesAt,
          maxSubmissions: publicFormShares.maxSubmissions,
          submissionCount: publicFormShares.submissionCount,
          createdAt: publicFormShares.createdAt,
        })
        .from(publicFormShares)
        .where(and(eq(publicFormShares.tenantId, tenantId), isNull(publicFormShares.deletedAt)))
        .orderBy(desc(publicFormShares.createdAt)),
    )
  }

  async setActive(tenantId: number, shareId: number, active: boolean): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(publicFormShares)
        .set({ active })
        .where(and(eq(publicFormShares.tenantId, tenantId), eq(publicFormShares.id, shareId))),
    )
  }

  /* 訪客路徑:以 token 取得可填欄位。**只回白名單內的欄位**,
     且不回傳任何未列入的 metadata(表單真名、其他欄位、記錄數都不外流)。 */
  async resolvePublicForm(token: string): Promise<PublicFormView> {
    const shares = await this.privileged
      .select()
      .from(publicFormShares)
      .where(and(eq(publicFormShares.tokenHash, hashToken(token)), isNull(publicFormShares.deletedAt)))
      .limit(1)
    const share = shares[0]
    /* 查無 token 與已關閉一律走同一種對外訊息,不區分 —— 區分等於讓人可以
       用試 token 的方式探測「這個表單存在但關了」。 */
    if (share === undefined) throw new PublicFormClosedError("這個表單目前無法填寫。")
    this.assertOpen(share)

    const fields = await this.privileged
      .select()
      .from(fieldDefs)
      .where(and(eq(fieldDefs.formId, share.formId), isNull(fieldDefs.deletedAt)))
    const allowed = new Set(share.fieldIds)
    return {
      shareId: share.id,
      tenantId: share.tenantId,
      formId: share.formId,
      title: share.title,
      description: share.description,
      requireCaptcha: share.requireCaptcha,
      fields: fields
        .filter((f) => allowed.has(f.id))
        .sort((a, b) => a.position - b.position)
        .map((f) => ({
          id: f.id,
          name: f.name,
          type: f.cellValueType,
          required: f.required,
          options: f.options as Record<string, unknown>,
        })),
    }
  }

  private assertOpen(share: typeof publicFormShares.$inferSelect): void {
    const closed = share.closedMessage ?? "這個表單目前無法填寫。"
    if (!share.active) throw new PublicFormClosedError(closed)
    const now = Date.now()
    if (share.opensAt !== null && share.opensAt.getTime() > now) {
      throw new PublicFormClosedError(closed)
    }
    if (share.closesAt !== null && share.closesAt.getTime() < now) {
      throw new PublicFormClosedError(closed)
    }
    if (share.maxSubmissions !== null && share.submissionCount >= share.maxSubmissions) {
      throw new PublicFormClosedError(closed)
    }
  }

  /* 🔴 落待審收件匣,**不寫動態表**(OQ-PF-7)。
     計數與提交同一 tx,否則併發下 maxSubmissions 擋不住。 */
  async submit(input: {
    token: string
    values: Record<string, unknown>
    ipHash: string | null
    userAgent: string | null
  }): Promise<{ submissionId: number }> {
    const view = await this.resolvePublicForm(input.token)
    const allowedNames = new Set(view.fields.map((f) => f.name))

    /* 只收白名單欄位。多送的**直接丟棄而非報錯** —— 報錯會告訴探測者
       「這個欄位名存在」。 */
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input.values)) {
      if (allowedNames.has(key)) clean[key] = value
    }
    for (const field of view.fields) {
      if (!field.required) continue
      const v = clean[field.name]
      if (v === undefined || v === null || v === "") {
        throw new PublicFormConfigError(`「${field.name}」為必填`)
      }
    }

    const rows = await this.privileged.transaction(async (tx) => {
      const bumped = await tx
        .update(publicFormShares)
        .set({ submissionCount: sql`${publicFormShares.submissionCount} + 1` })
        .where(
          and(
            eq(publicFormShares.id, view.shareId),
            sql`(${publicFormShares.maxSubmissions} IS NULL
                 OR ${publicFormShares.submissionCount} < ${publicFormShares.maxSubmissions})`,
          ),
        )
        .returning({ id: publicFormShares.id })
      if (bumped.length === 0) throw new PublicFormClosedError("這個表單目前無法填寫。")

      return tx
        .insert(publicSubmissions)
        .values({
          tenantId: view.tenantId,
          shareId: view.shareId,
          formId: view.formId,
          values: clean,
          submitterIpHash: input.ipHash,
          submitterUa: input.userAgent?.slice(0, 200) ?? null,
        })
        .returning({ id: publicSubmissions.id })
    })
    const row = rows[0]
    if (row === undefined) throw new Error("insert public_submission returned no row")
    return { submissionId: row.id }
  }

  async inbox(tenantId: number, status = "pending") {
    return this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(publicSubmissions)
        .where(and(eq(publicSubmissions.tenantId, tenantId), eq(publicSubmissions.status, status)))
        .orderBy(desc(publicSubmissions.createdAt))
        .limit(200),
    )
  }

  async markReviewed(
    tenantId: number,
    submissionId: number,
    outcome: { status: "promoted" | "rejected"; recordId?: number; reason?: string },
    actorId: number,
  ): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(publicSubmissions)
        .set({
          status: outcome.status,
          recordId: outcome.recordId ?? null,
          rejectReason: outcome.reason ?? null,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        })
        .where(
          and(eq(publicSubmissions.tenantId, tenantId), eq(publicSubmissions.id, submissionId)),
        ),
    )
  }

  async getPending(tenantId: number, submissionId: number) {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(publicSubmissions)
        .where(
          and(
            eq(publicSubmissions.tenantId, tenantId),
            eq(publicSubmissions.id, submissionId),
            eq(publicSubmissions.status, "pending"),
          ),
        )
        .limit(1),
    )
    return rows[0] ?? null
  }
}

function reasonFor(type: string): string {
  switch (type) {
    case "link":
      return "下拉候選會列舉來源表的所有記錄"
    case "lookup":
    case "rollup":
    case "formula":
      return "值來自其他欄位,公開它等於公開來源"
    case "autoNumber":
      return "連號單據會洩漏你的業務量與成長速度"
    case "createdBy":
    case "updatedBy":
    case "member":
      return "會洩漏內部人員名冊"
    case "attachment":
    case "image":
    case "signature":
      return "匿名上傳需先掃毒,平台尚未具備"
    default:
      return "不適合開放給匿名填寫者"
  }
}
