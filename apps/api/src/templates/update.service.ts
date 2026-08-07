import { Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common"
import { DdlService } from "../form-engine/ddl/ddl.service.js"
import { MetadataService } from "../form-engine/metadata/metadata.service.js"
import type { AddFieldSpec } from "../form-engine/specs/form-specs.js"
import { type InstallRecord, TemplateInstallService } from "./install.service.js"
import {
  type TemplateForm,
  type TemplatePack,
  compareVersion,
  topoOrder,
} from "./template-specs.js"

export interface UpdatePlan {
  readonly templateKey: string
  readonly fromVersion: string
  readonly toVersion: string
  /* 要更新的那一次安裝 */
  readonly installId: number
  /* pack 有、這套裡沒有的表 */
  readonly newForms: readonly { readonly ref: string; readonly name: string }[]
  /* 既有表要補的欄位 */
  readonly newFields: readonly {
    readonly ref: string
    readonly formId: number
    readonly formName: string
    readonly fields: readonly string[]
  }[]
  /* 動不了的,連同原因 */
  readonly skipped: readonly { readonly ref: string; readonly reason: string }[]
  readonly nothingToDo: boolean
  /* 🔴 一定要顯示給使用者看的但書,見 §caveat */
  readonly caveat: string
}

/* 🔴 比對是**用欄位名**。ref 只對到表,對不到欄位 ——
   使用者把範本原本的欄位改過名,我們就認不出來,會當成缺少的欄位再加一次。
   偵測不了(舊版 pack 定義不在程式裡),所以**講出來**並把每個要加的欄位逐一列出。
   靜默多加一個同義欄位,比明講「我可能會多加」糟得多。 */
const CAVEAT =
  "比對用的是欄位名稱。如果你把範本原本的欄位改過名,系統認不出來,會把它當成缺少的欄位再加一次 —— 請先看過下面要新增的清單。"

/* 🔴 R1·TPL M7|僅新增式更新(OQ-TPL-11 = B,2026-08-07 裁定)。

   ## 為什麼可以做,而 M0 曾說不能

   M0 §0.5 的承重結論是「**要能更新,就必須先鎖**」,而鎖與第一約束相衝,故列為不做。
   2026-08-07 覆核推翻該結論:Ragic `doc-kb/204` 逐字允許對範本表單
   「新增欄位、修改欄位名稱、變更欄位種類、刪除欄位」(只是計入客製化額度),
   而 `doc/37` 同時有更新入口 —— **兩者並存**,所以「不可兼得」是從 Airtable
   一個資料點過度一般化。
   ⚠️ 但 Ragic 更新時對已改過的表做什麼**仍未查證**,不得拿來背書本做法。

   ## 唯一的不變量

   **只新增,絕不改名、不改型別、不刪除、不動版面、不碰資料。**
   它因此**不可能弄壞使用者的東西** —— 定位風險為零(從不觸碰既有物件)。
   剩下的是正確性問題(見 CAVEAT),用差異預覽 + 明確確認處理。 */
@Injectable()
export class TemplateUpdateService {
  private readonly log = new Logger(TemplateUpdateService.name)

  constructor(
    @Inject(DdlService) private readonly ddl: DdlService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(TemplateInstallService) private readonly installs: TemplateInstallService,
  ) {}

  /* 算出「會加什麼」。**沒有任何副作用** —— 預覽與套用走同一段計算,
     否則預覽講的和實際做的會漂。 */
  async plan(tenantId: number, pack: TemplatePack): Promise<UpdatePlan> {
    const target = await this.latestInstall(tenantId, pack.key)
    if (target === null) {
      throw new UnprocessableEntityException({
        code: "TEMPLATE_NOT_INSTALLED",
        message: `「${pack.name}」還沒有安裝過,請先套用`,
      })
    }
    if (compareVersion(pack.version, target.version) <= 0) {
      throw new UnprocessableEntityException({
        code: "TEMPLATE_ALREADY_CURRENT",
        message: `「${pack.name}」已經是最新版(${target.version})`,
      })
    }

    const byRef = new Map(target.forms.map((f) => [f.ref, f]))
    const newForms: { ref: string; name: string }[] = []
    const newFields: { ref: string; formId: number; formName: string; fields: string[] }[] = []
    const skipped: { ref: string; reason: string }[] = []

    for (const form of pack.forms) {
      const installed = byRef.get(form.ref)
      if (installed === undefined) {
        newForms.push({ ref: form.ref, name: form.name })
        continue
      }
      if (installed.formId === null || installed.currentName === null) {
        /* 使用者刪了這張表。**不重建** —— 那是他的決定,
           而「更新」把刪掉的東西變回來會是驚嚇不是服務。 */
        skipped.push({
          ref: form.ref,
          reason: `「${installed.installedAs}」已被刪除,不會重建`,
        })
        continue
      }
      const existing = await this.metadata.getForm(tenantId, installed.formId)
      const have = new Set(existing.fields.map((f) => f.name))
      const missing = form.fields.filter((f) => !have.has(f.name)).map((f) => f.name)
      if (missing.length > 0) {
        newFields.push({
          ref: form.ref,
          formId: installed.formId,
          formName: installed.currentName,
          fields: missing,
        })
      }
    }

    return {
      templateKey: pack.key,
      fromVersion: target.version,
      toVersion: pack.version,
      installId: target.id,
      newForms,
      newFields,
      skipped,
      nothingToDo: newForms.length === 0 && newFields.length === 0,
      caveat: CAVEAT,
    }
  }

  /* 套用。**只做 plan 算出來的那些事。** */
  async apply(tenantId: number, pack: TemplatePack, actorId?: number): Promise<UpdatePlan> {
    const plan = await this.plan(tenantId, pack)
    const target = await this.latestInstall(tenantId, pack.key)
    /* plan 已經驗過,這裡只是把型別收窄 */
    if (target === null) throw new Error("install disappeared between plan and apply")

    /* ref → formId。既有的先進去,新建的邊建邊補 —— 新表可能連到既有表。 */
    const refMap: Record<string, number> = {}
    for (const f of target.forms) if (f.formId !== null) refMap[f.ref] = f.formId

    const byRef = new Map(pack.forms.map((f) => [f.ref, f]))
    const ordered = topoOrder(pack)
    if (ordered === null) {
      throw new UnprocessableEntityException({
        code: "TEMPLATE_PACK_CYCLE",
        message: "範本包內的表單互相指向,無法決定建立順序",
      })
    }

    const taken = new Set((await this.metadata.listForms(tenantId)).map((f) => f.name))
    const createdIds: number[] = []
    /* 依 topo 順序建新表 —— 新表可能是既有表的子表,或連到另一張新表 */
    for (const form of ordered) {
      if (!plan.newForms.some((n) => n.ref === form.ref)) continue
      const name = this.uniqueName(taken, form.name)
      const built = await this.ddl.createForm(
        tenantId,
        {
          name,
          ...(form.parentRef === undefined
            ? {}
            : { parentFormId: this.mustResolve(refMap, form.parentRef) }),
          fields: form.fields.map((f) => this.resolveField(refMap, f)),
        },
        actorId,
      )
      refMap[form.ref] = built.form.id
      createdIds.push(built.form.id)
    }

    /* 既有表補欄位。
       ⚠️ **一欄一欄加,失敗不回滾前面的** —— 加欄位是 DDL,而部分成功
       在這裡是可接受的:每一欄都是獨立的新增,沒有半套的欄位。
       但失敗要出聲,不能靜默少加。 */
    for (const grp of plan.newFields) {
      const form = byRef.get(grp.ref)
      if (form === undefined) continue
      for (const fieldName of grp.fields) {
        const spec = form.fields.find((f) => f.name === fieldName)
        if (spec === undefined) continue
        try {
          await this.ddl.addField(tenantId, grp.formId, this.resolveField(refMap, spec))
        } catch (e) {
          this.log.error(
            `更新「${pack.key}」時,欄位「${fieldName}」加到表 ${String(grp.formId)} 失敗`,
            e instanceof Error ? e.stack : String(e),
          )
          throw e
        }
      }
    }

    /* 記一列 kind='update' —— 帶上更新後的**完整** ref → formId 對映,
       讓每一列都自足,下一次更新不必回頭追鏈。 */
    const allForms = pack.forms
      .map((f) => ({ ref: f.ref, formId: refMap[f.ref] }))
      .filter((f): f is { ref: string; formId: number } => f.formId !== undefined)
    const names = new Map<number, string>()
    for (const f of target.forms) {
      if (f.formId !== null && f.currentName !== null) names.set(f.formId, f.currentName)
    }
    for (const id of createdIds) {
      const row = await this.metadata.getForm(tenantId, id)
      names.set(id, row.form.name)
    }
    await this.installs.record({
      tenantId,
      pack,
      version: pack.version,
      withRecords: false,
      ...(actorId === undefined ? {} : { actorId }),
      kind: "update",
      supersedesInstallId: target.id,
      forms: allForms,
      nameOf: (id) => names.get(id) ?? String(id),
    })
    return plan
  }

  /* 最近一次(同 key)的安裝。更新是接在**最新那一次**後面。 */
  private async latestInstall(tenantId: number, key: string): Promise<InstallRecord | null> {
    const list = await this.installs.list(tenantId, key)
    return list[0] ?? null
  }

  private uniqueName(taken: Set<string>, base: string): string {
    if (!taken.has(base)) {
      taken.add(base)
      return base
    }
    for (let n = 2; n < 100; n++) {
      const candidate = `${base} (${String(n)})`
      if (!taken.has(candidate)) {
        taken.add(candidate)
        return candidate
      }
    }
    throw new UnprocessableEntityException({
      code: "TEMPLATE_NAME_EXHAUSTED",
      message: `「${base}」已存在超過 99 份,請先整理既有表單`,
    })
  }

  private resolveField(
    refMap: Record<string, number>,
    field: TemplateForm["fields"][number],
  ): AddFieldSpec {
    const { targetRef, ...rest } = field
    if (targetRef === undefined) return rest
    return {
      ...rest,
      options: { ...(rest.options ?? {}), targetFormId: this.mustResolve(refMap, targetRef) },
    }
  }

  private mustResolve(refMap: Record<string, number>, ref: string): number {
    const id = refMap[ref]
    if (id === undefined) {
      throw new UnprocessableEntityException({
        code: "TEMPLATE_REF_UNRESOLVED",
        message: `範本內的代號「${ref}」在這次更新中對不到任何表`,
      })
    }
    return id
  }
}
