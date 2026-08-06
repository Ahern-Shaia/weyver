import { createHash } from "node:crypto"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { PermissionService } from "../authz/permission.service.js"
import { AccessPreviewService } from "../form-engine/access/access-preview.service.js"
import { toFieldDto } from "../form-engine/api/api-schemas.js"
import { LayoutService } from "../form-engine/layout/layout.service.js"
import { MetadataService } from "../form-engine/metadata/metadata.service.js"
import { RecordService } from "../form-engine/records/record.service.js"
import { LinkOptionsService } from "../form-engine/relations/link-options.service.js"
import { SettingsService } from "../settings/settings.service.js"
import type { AttachmentRef } from "./pdf-merge.service.js"
import { type PdfJobRow, PdfRepository } from "./pdf.repository.js"

/* 票的有效期。渲染器就在同一台機器上,60 秒綽綽有餘 ——
   長效票只是把外洩窗口拉大,換不到任何東西。 */
export const TICKET_TTL_SECONDS = 60
/* 產出物保留期。與匯出同一種語意(產了就該有期限),不另立一套數字。 */
export const PDF_TTL_DAYS = 7
/* 一次最多幾筆(DB 亦有 CHECK,雙保險) */
export const PDF_MAX_RECORDS = 200
/* 一次取多少明細列。一份單據的明細不會有五百列 —— 超過代表資料有問題。 */
const LINES_LIMIT = 500

type RecordLike = { lineNo: number | null }

export interface RenderPayload {
  readonly form: { readonly id: number; readonly name: string }
  readonly fields: readonly unknown[]
  readonly layout: unknown
  readonly records: readonly unknown[]
  readonly linkLabels: Readonly<Record<string, string>>
  readonly members: Readonly<Record<string, string>>
  /* 子表明細。採購單這類單據的重點就在明細 —— 只印表頭等於沒印。 */
  readonly lines: {
    readonly form: { readonly id: number; readonly name: string }
    readonly fields: readonly unknown[]
    readonly byParent: Readonly<Record<string, readonly unknown[]>>
  } | null
  readonly tenant: { readonly name: string }
  /* M2 A3|租戶級浮水印(Ragic `doc/56` parity)。目前只有文字 ——
     圖片浮水印卡在「租戶級資產上傳」這條尚不存在的路上,`tenants.logo_file_key`
     同樣至今零 writer。詳見 migration 0063 的說明。 */
  readonly watermark: { readonly text: string | null } | null
  readonly ctx: { readonly locale: string; readonly timeZone: string }
}

@Injectable()
export class PdfService {
  constructor(
    @Inject(PdfRepository) private readonly repo: PdfRepository,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(RecordService) private readonly records: RecordService,
    @Inject(LayoutService) private readonly layout: LayoutService,
    @Inject(LinkOptionsService) private readonly linkOptions: LinkOptionsService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(AccessPreviewService) private readonly actors: AccessPreviewService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /* 建立工作。**這裡不發票** —— 票由 worker 撿件時才發,
     於是明文永遠不會出現在 API 回應裡(見 `PdfRepository.claimNext`)。 */
  async createJob(
    tenantId: number,
    actorId: number,
    formId: number,
    recordIds: readonly number[],
    permissions: EffectivePermissions,
    mergeAttachments = false,
  ): Promise<PdfJobRow> {
    if (recordIds.length === 0 || recordIds.length > PDF_MAX_RECORDS) {
      throw new ForbiddenException({
        code: "PDF_TOO_MANY",
        message: `一次最多 ${String(PDF_MAX_RECORDS)} 筆`,
      })
    }
    /* 能看才能印。**不是「能不能建工作」而是「能不能看這張表」** ——
       PDF 是值的又一個出口,入口權限與讀取權限必須是同一個。 */
    if (!permissions.canRead(formId)) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "沒有檢視這張表單的權限" })
    }
    return this.repo.create({ tenantId, actorId, formId, recordIds, mergeAttachments })
  }

  /* 🔴 OQ-PDF-6 的落點:渲染器拿票換資料,而資料是以**該工作的 actor**
     的有效權限讀出來的 —— 遮罩走 `RecordService` 既有的同一條路,
     不在這裡重寫一份。票是單次的,核銷由條件更新保證。

     ## 為什麼是**重新解析**而不是沿用建立工作時的權限

     兩者的差別只在「請求與渲染之間權限被改掉」時才看得出來 ——
     而那正是一個剛被撤權的人不該還能印出資料的情況。
     沿用快照比較快,但它把「當時能看」變成「永遠能印」。

     ⚠️ **代價誠實**:dev 車道(`x-dev-tenant`)是超級權限,而它在渲染時
     重現不了(那條車道本來就沒有真實身分),所以 dev 下用假 actor 建的工作
     會印出一張沒有值的單子。這不是缺陷,是那條車道的性質。 */
  async redeem(ticket: string): Promise<RenderPayload> {
    const job = await this.repo.redeemTicket(hashTicket(ticket), TICKET_TTL_SECONDS)
    if (job === null) throw new NotFoundException({ code: "TICKET_INVALID", message: "票無效" })

    const perms = await this.permissions.resolveForActor(job.tenantId, job.requestedByActorId)
    const { form, fields } = await this.metadata.getForm(job.tenantId, job.formId)
    const tenant = await this.settings.getTenant(job.tenantId)

    const records = []
    for (const recordId of job.recordIds) {
      records.push(
        await this.records.getRecord(
          job.tenantId,
          job.formId,
          Number(recordId),
          perms,
          job.requestedByActorId,
        ),
      )
    }

    return {
      form: { id: form.id, name: form.name },
      /* 🔴 回**前端已知的 DTO 形狀**(`type` 而非 `cellValueType`),
         用的是既有的 `toFieldDto` —— 若在這裡自己映一次,列印頁看到的欄位
         形狀就會與其他畫面分岔,而那是本 repo 已經踩過四次的「兩份鏡射」。 */
      fields: fields.map(toFieldDto),
      layout: await this.layout.getLayout(job.tenantId, job.formId),
      records,
      lines: await this.resolveLines(job, perms),
      linkLabels: await this.resolveLinkLabels(job, fields, records, perms),
      members: await this.resolveMembers(job.tenantId, fields),
      tenant: { name: tenant.name },
      watermark: { text: tenant.pdfWatermarkText },
      /* 🔴 **租戶時區,不是伺服器時區**。PDF 是離線憑證,印出來的時間若用
         伺服器的 UTC,單據上的日期會與系統裡看到的差一天(台灣 UTC+8,
         `autoNumber` 的日期分界已經為同一個理由踩過一次)。 */
      ctx: { locale: tenant.defaultLocale, timeZone: tenant.timezone },
    }
  }

  /* 🔴 子表明細。父子關係來自 `form_def.parent_form_id`,與記錄頁同一個來源
     (記錄頁是靠 `childForm` prop,值也是從那裡推的)。

     權限:子表是**另一張表單**,故 `canRead` 要對子表單再問一次 ——
     「看得到採購單」不蘊含「看得到採購明細」。這與連結欄的 lookup 越權
     (FMEA D3)是同一條理由。 */
  private async resolveLines(
    job: PdfJobRow,
    perms: EffectivePermissions,
  ): Promise<RenderPayload["lines"]> {
    const forms = await this.metadata.listForms(job.tenantId)
    const child = forms.find((f) => f.parentFormId === job.formId)
    if (child === undefined || !perms.canRead(child.id)) return null

    const { fields } = await this.metadata.getForm(job.tenantId, child.id)
    /* ⚠️ **撈一次,在記憶體裡分組**。第一版把 `listRecords` 放在
       `for (parentId)` 迴圈裡 —— 200 筆就是 200 次一模一樣的查詢(AGENTS ⚙️ N+1)。
       上限 500 列是刻意的:一份單據的明細不會有五百列,超過就是資料有問題,
       而讓它靜靜地截斷比拒絕更糟 —— 故超過時明確記錄。 */
    const page = await this.records.listRecords(
      job.tenantId,
      child.id,
      { filters: [], sort: [], limit: LINES_LIMIT },
      perms,
      job.requestedByActorId,
    )
    const wanted = new Set(job.recordIds.map(Number))
    const byParent: Record<string, unknown[]> = {}
    for (const id of wanted) byParent[String(id)] = []
    for (const row of page.records) {
      if (row.parentId === null || !wanted.has(row.parentId)) continue
      byParent[String(row.parentId)]?.push(row)
    }
    for (const key of Object.keys(byParent)) {
      byParent[key]?.sort(
        (a, b) => ((a as RecordLike).lineNo ?? 0) - ((b as RecordLike).lineNo ?? 0),
      )
    }
    return { form: { id: child.id, name: child.name }, fields: fields.map(toFieldDto), byParent }
  }

  private async resolveLinkLabels(
    job: PdfJobRow,
    fields: readonly { id: number; name: string; cellValueType: string }[],
    records: readonly { values: Record<string, unknown> }[],
    perms: EffectivePermissions,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const field of fields) {
      if (field.cellValueType !== "link") continue
      const ids = new Set<number>()
      for (const r of records) {
        const v = r.values[field.name]
        for (const one of Array.isArray(v) ? v : [v]) {
          const n = Number(one)
          if (Number.isSafeInteger(n) && n > 0) ids.add(n)
        }
      }
      if (ids.size === 0) continue
      const options = await this.linkOptions.listOptions(
        job.tenantId,
        job.formId,
        field.id,
        "",
        ids.size,
        perms,
        job.requestedByActorId,
        [...ids],
      )
      /* 鍵與前端 `useLinkLabels` 同形:`fieldId:recordId` */
      for (const o of options) out[`${String(field.id)}:${String(o.id)}`] = o.label
    }
    return out
  }

  private async resolveMembers(
    tenantId: number,
    fields: readonly { cellValueType: string }[],
  ): Promise<Record<string, string>> {
    if (!fields.some((f) => f.cellValueType === "member")) return {}
    const actors = await this.actors.listActors(tenantId)
    return Object.fromEntries(actors.map((a) => [String(a.id), a.name]))
  }

  /* 🔴 M2 A3|把這份工作的記錄裡的附件併進單據。

     ## 為什麼合併發生在**渲染之後**而不是渲染頁裡

     渲染頁是 HTML,沒有辦法把一份既有的 PDF 當成頁面插進去。而且附件是原樣
     交付的憑證(對方要的是那份發票本身,不是它的截圖),重新排版反而是損失。

     ## 權限與 `redeem` 走同一條路

     這裡**重新解析**該工作 actor 的有效權限,而不是沿用建立工作時的快照 ——
     理由與 `redeem` 逐字相同:沿用快照會把「當時能看」變成「永遠能印」。
     值的遮罩由 `getRecord` 執行,檔案那一層由 `openForDownload` 執行,
     兩者都不在這裡重寫。

     ⚠️ 只看**父記錄**的附件欄。子表明細各自的附件不併 —— 一張採購單的
     二十列明細各帶三個附件就是六十份檔案,那不是「印一張單」的意圖。 */
  async collectAttachments(job: PdfJobRow): Promise<{
    readonly permissions: EffectivePermissions
    readonly refs: readonly AttachmentRef[]
  }> {
    const perms = await this.permissions.resolveForActor(job.tenantId, job.requestedByActorId)
    const { fields } = await this.metadata.getForm(job.tenantId, job.formId)
    const attachmentFields = fields.filter((f) => f.cellValueType === "attachment")
    if (attachmentFields.length === 0) return { permissions: perms, refs: [] }

    const refs: AttachmentRef[] = []
    const seen = new Set<string>()
    for (const recordId of job.recordIds) {
      const record = await this.records.getRecord(
        job.tenantId,
        job.formId,
        Number(recordId),
        perms,
        job.requestedByActorId,
      )
      for (const field of attachmentFields) {
        for (const one of toRefs(record.values[field.name])) {
          /* 同一個檔案被兩筆記錄引用時只併一次 —— 併兩次是重複的紙。 */
          if (seen.has(one.key)) continue
          seen.add(one.key)
          refs.push(one)
        }
      }
    }
    return { permissions: perms, refs }
  }

  async listOwn(tenantId: number, actorId: number): Promise<PdfJobRow[]> {
    return this.repo.listOwn(tenantId, actorId)
  }

  async findOwn(tenantId: number, actorId: number, id: number): Promise<PdfJobRow | null> {
    return this.repo.findOwn(tenantId, actorId, id)
  }

  async countDownload(id: number): Promise<void> {
    await this.repo.countDownload(id)
  }
}

/* 附件欄的值形狀是 `[{key,name}]`(F-5 契約)。
   ⚠️ 這是**被遮罩過的值**:欄位不可見時 `getRecord` 根本不會回這個鍵,
   於是不可見欄的附件自然不會被併進來 —— 不需要在這裡再判一次權限。 */
function toRefs(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value)) return []
  const out: AttachmentRef[] = []
  for (const one of value) {
    if (typeof one !== "object" || one === null) continue
    const { key, name } = one as { key?: unknown; name?: unknown }
    if (typeof key !== "string" || key === "") continue
    out.push({ key, name: typeof name === "string" && name !== "" ? name : key })
  }
  return out
}

/* SHA-256 而非慢雜湊:票是**高熵隨機值**(32 bytes),沒有字典可猜,
   慢雜湊在這裡只會拖慢每次核銷。與 API 金鑰同一個判斷。 */
export function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex")
}
