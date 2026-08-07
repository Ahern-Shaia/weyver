import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, isNull } from "drizzle-orm"
import { TenantDb } from "../db/db.module.js"
import { formDefs, templateInstallForms, templateInstalls } from "../db/schema.js"
import { type TemplatePack, compareVersion } from "./template-specs.js"

/* 一筆安裝紀錄,含它裝出來的表**現在還在不在**。 */
export interface InstallRecord {
  readonly id: number
  readonly templateKey: string
  readonly version: string
  readonly withRecords: boolean
  readonly appliedAt: string
  readonly forms: readonly InstalledForm[]
}

export interface InstalledForm {
  readonly ref: string
  /* 表被硬清出回收桶時為 null */
  readonly formId: number | null
  /* 安裝當下的名字。表沒了、或使用者改過名,這一欄都還講得出原本是哪一張 */
  readonly installedAs: string
  /* 現在的名字。null = 表已不存在(軟刪或被清掉) */
  readonly currentName: string | null
}

/* 🔴 R1·TPL M6|安裝紀錄。
   OQ-TPL-6 裁定 **C「先脫鉤,但記錄來源與版本」**,而 v1.0 沒有落地 ——
   `version` 在 `packs.ts` 寫了 8 次、全庫 reader 為 0。
   本服務就是補上那個 reader。 */
@Injectable()
export class TemplateInstallService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /* 套用成功後記一筆。
     ⚠️ **不放進 apply 的 try/catch 補償範圍內** —— 表已經建好了,
     紀錄寫失敗不該把使用者的表刪掉。失敗就是少一筆紀錄,不是少幾張表。 */
  async record(input: {
    readonly tenantId: number
    readonly pack: TemplatePack
    readonly version: string
    readonly withRecords: boolean
    readonly actorId?: number
    /* ref → 實際建出來的 formId,以及當下用的名字(可能被加了序號) */
    readonly forms: readonly { readonly ref: string; readonly formId: number }[]
    readonly nameOf: (formId: number) => string
  }): Promise<number> {
    return this.db.withTenant(input.tenantId, async (tx) => {
      const [row] = await tx
        .insert(templateInstalls)
        .values({
          tenantId: input.tenantId,
          templateKey: input.pack.key,
          version: input.version,
          withRecords: input.withRecords,
          ...(input.actorId === undefined ? {} : { appliedBy: input.actorId }),
        })
        .returning({ id: templateInstalls.id })
      /* insert ... returning 在 drizzle 型別上是陣列。空陣列表示寫入沒發生 ——
         那是 RLS 擋掉或 grant 缺失,不是正常路徑,所以拋而不是靜默回 0。 */
      if (row === undefined) throw new Error("template_installs 寫入未回傳 id")
      if (input.forms.length > 0) {
        await tx.insert(templateInstallForms).values(
          input.forms.map((f) => ({
            installId: row.id,
            tenantId: input.tenantId,
            ref: f.ref,
            formId: f.formId,
            formName: input.nameOf(f.formId),
          })),
        )
      }
      return row.id
    })
  }

  /* 這個租戶裝過哪些。新的在前。 */
  async list(tenantId: number, templateKey?: string): Promise<readonly InstallRecord[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const where =
        templateKey === undefined
          ? eq(templateInstalls.tenantId, tenantId)
          : and(
              eq(templateInstalls.tenantId, tenantId),
              eq(templateInstalls.templateKey, templateKey),
            )
      const installs = await tx
        .select()
        .from(templateInstalls)
        .where(where)
        .orderBy(desc(templateInstalls.appliedAt), desc(templateInstalls.id))
      if (installs.length === 0) return []

      /* 一次撈完所有相關的表,不逐 install 查(N+1 是明文鐵則) */
      const rows = await tx
        .select({
          installId: templateInstallForms.installId,
          ref: templateInstallForms.ref,
          formId: templateInstallForms.formId,
          formName: templateInstallForms.formName,
          currentName: formDefs.name,
        })
        .from(templateInstallForms)
        .leftJoin(
          formDefs,
          and(eq(formDefs.id, templateInstallForms.formId), isNull(formDefs.deletedAt)),
        )
        .where(eq(templateInstallForms.tenantId, tenantId))

      const byInstall = new Map<number, InstalledForm[]>()
      for (const r of rows) {
        const list = byInstall.get(r.installId) ?? []
        list.push({
          ref: r.ref,
          formId: r.formId,
          installedAs: r.formName,
          currentName: r.currentName,
        })
        byInstall.set(r.installId, list)
      }

      return installs.map((i) => ({
        id: i.id,
        templateKey: i.templateKey,
        version: i.version,
        withRecords: i.withRecords,
        appliedAt: i.appliedAt.toISOString(),
        forms: byInstall.get(i.id) ?? [],
      }))
    })
  }

  /* 每個 template_key 目前裝到的**最高**版本。
     ⚠️ 不是「最後一次安裝的版本」—— 同一個 pack 可以裝多次(M4 已確立那是合法意圖),
     若使用者先裝 v1.1 再裝一份 v1.0 舊的,提示「有新版」會是錯的。 */
  async highestVersions(tenantId: number): Promise<ReadonlyMap<string, string>> {
    const installs = await this.list(tenantId)
    const out = new Map<string, string>()
    for (const i of installs) {
      const cur = out.get(i.templateKey)
      if (cur === undefined || compareVersion(i.version, cur) > 0) out.set(i.templateKey, i.version)
    }
    return out
  }
}
