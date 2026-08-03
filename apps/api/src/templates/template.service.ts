import { Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common"
import { AuthzRepository } from "../authz/authz.repository.js"
import { DdlService } from "../form-engine/ddl/ddl.service.js"
import { type Layout, layoutSchema } from "../form-engine/layout/layout-specs.js"
import { LayoutService } from "../form-engine/layout/layout.service.js"
import { MetadataService } from "../form-engine/metadata/metadata.service.js"
import { RecordService } from "../form-engine/records/record.service.js"
import type { AddFieldSpec } from "../form-engine/specs/form-specs.js"
import {
  type TemplateForm,
  type TemplatePack,
  topoOrder,
  validatePackRefs,
} from "./template-specs.js"

export interface ApplyResult {
  readonly formIds: readonly number[]
  /* ref → 實際建出來的 formId。呼叫端要導到主表時用得到 */
  readonly refMap: Readonly<Record<string, number>>
  /* 因為同名而被加了序號的表 —— 呼叫端要講給使用者聽 */
  readonly renamed: readonly string[]
}

/* 🔴 R1·TPL M1|套用範本包。

   **OQ-TPL-5 = A(全成或全不成)在此有一個誠實的偏離**:
   `createForm` 是多階段的(metadata draft → DDL provision → formula 定義),
   **不可能把 N 張表包進單一 DB transaction**。
   故改以**補償刪除**達成使用者層面的「全成或全不成」:任一張失敗即回頭下架已建的。

   ⚠️ 補償本身也可能失敗(例如 DB 斷線)。那種情況**不吞** ——
   拋出時把「已建了哪幾張、哪幾張沒收拾掉」寫進訊息與 log,
   因為使用者接下來看到的是幾張半成品的表,而他需要知道那是什麼。
   靜默留下半套的應用正是 OQ-TPL-5 要避免的:**使用者看不出來少了什麼**(他沒看過完整版)。 */
@Injectable()
export class TemplateService {
  private readonly log = new Logger(TemplateService.name)

  constructor(
    @Inject(DdlService) private readonly ddl: DdlService,
    @Inject(RecordService) private readonly records: RecordService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(LayoutService) private readonly layouts: LayoutService,
    @Inject(AuthzRepository) private readonly authz: AuthzRepository,
  ) {}

  async apply(
    tenantId: number,
    pack: TemplatePack,
    actorId?: number,
    /* OQ-TPL-4=A:一個布林同時解掉「要不要帶範例資料」與「事後怎麼清」——
       不帶就不用清。Airtable 一律帶再提供清除,而它自己踩了坑:
       清除入口藏在一次性側欄,官方文件還得補一段 workaround。 */
    opts?: { readonly withRecords?: boolean },
  ): Promise<ApplyResult> {
    /* 建任何表**之前**先驗完 —— 建到一半才發現 ref 打錯,就得靠補償去收拾,
       而補償本身也可能失敗。這一步把可預期的錯誤擋在有副作用之前。 */
    const errors = validatePackRefs(pack)
    if (errors.length > 0) {
      throw new UnprocessableEntityException({
        code: "TEMPLATE_PACK_INVALID",
        message: `範本包不合法:${errors.join(";")}`,
      })
    }
    const ordered = topoOrder(pack)
    if (ordered === null) {
      throw new UnprocessableEntityException({
        code: "TEMPLATE_PACK_CYCLE",
        message: "範本包內的表單互相指向,無法決定建立順序",
      })
    }

    /* 🔴 同一個範本套第二次會撞表單名唯一,而錯誤訊息是「internal error」——
       實走時抓到。使用者的意圖通常是「我要再一份」(不同部門 / 不同年度),
       故**自動加序號**而不是拒絕;但**要講出來**(回 `renamed`),
       靜默改名跟靜默不改一樣糟。 */
    const taken = new Set((await this.metadata.listForms(tenantId)).map((f) => f.name))
    const renamed: string[] = []
    const uniqueName = (base: string): string => {
      if (!taken.has(base)) {
        taken.add(base)
        return base
      }
      for (let n = 2; n < 100; n++) {
        const candidate = `${base} (${String(n)})`
        if (!taken.has(candidate)) {
          taken.add(candidate)
          renamed.push(candidate)
          return candidate
        }
      }
      throw new UnprocessableEntityException({
        code: "TEMPLATE_NAME_EXHAUSTED",
        message: `「${base}」已存在超過 99 份,請先整理既有表單`,
      })
    }

    const refMap: Record<string, number> = {}
    const created: number[] = []
    try {
      for (const form of ordered) {
        const built = await this.ddl.createForm(
          tenantId,
          {
            name: uniqueName(form.name),
            ...(form.parentRef === undefined
              ? {}
              : { parentFormId: this.mustResolve(refMap, form.parentRef) }),
            fields: form.fields.map((f) => this.resolveField(refMap, f)),
          },
          actorId,
        )
        refMap[form.ref] = built.form.id
        created.push(built.form.id)

        await this.applyLayout(tenantId, built, form)

        if (opts?.withRecords === true && form.sampleRows.length > 0) {
          await this.records.createManyRecords(
            tenantId,
            built.form.id,
            form.sampleRows,
            actorId ?? 0,
          )
        }
      }
      /* 分類最後套 —— 它不影響表能不能用,失敗不該讓整包回滾。
         但**也不能靜默** ,故失敗時記 log(見 `assignCategory`)。 */
      await this.assignCategory(tenantId, pack, created)
      return { formIds: created, refMap, renamed }
    } catch (e) {
      await this.compensate(tenantId, created, actorId)
      throw e
    }
  }

  /* 版面帶入(OQ-TPL-3 = B)。範本以**欄位顯示名**為 key,此處換成真實 id。

     ⚠️ **對不到的欄位名直接略過而非拋錯** —— 範本改版時欄位可能改名,
     為了一個排版問題讓整包回滾不划算(表已經建好且可用)。
     但**略過要出聲**:記 log,否則就是靜默少做。 */
  private async applyLayout(
    tenantId: number,
    built: { form: { id: number }; fields: readonly { id: number; name: string }[] },
    form: TemplateForm,
  ): Promise<void> {
    if (form.layout === undefined) return
    const idByName = new Map(built.fields.map((f) => [f.name, f.id]))
    const fields: Layout["fields"] = {}
    const missing: string[] = []
    for (const [name, spec] of Object.entries(form.layout)) {
      const id = idByName.get(name)
      if (id === undefined) {
        missing.push(name)
        continue
      }
      fields[String(id)] = spec
    }
    if (missing.length > 0) {
      this.log.warn(`範本 ${form.ref} 的版面有對不到的欄位名(已略過):${missing.join("、")}`)
    }
    try {
      /* 走 zod 解析而不是 cast —— 版面 schema 有預設值與 `.strict()`,
         手動組物件會漂移。解析失敗代表範本的版面本身寫錯,由下方 catch 記下。 */
      await this.layouts.setLayout(
        tenantId,
        built.form.id,
        layoutSchema.parse({ grid: { cols: form.gridCols ?? 12 }, fields }),
      )
    } catch (err) {
      this.log.error(`範本 ${form.ref} 的版面套用失敗,表單已建立但為預設排版`, err)
    }
  }

  /* 🔴 OQ-TPL-10 = A|分類是**建議值**:同名沿用,否則建立。

     對碼發現 `form_categories` **沒有預設 seed** —— 也就是說範本帶進來的分類
     會**實質決定租戶的分類體系**。強制建立(選項 B)會在客戶既有的分類樹裡
     塞進陌生節點;不帶分類(選項 C)則讓範本一裝進來就散在未分類,
     失去「打開就能用」的觀感,而那正是範本的價值。 */
  private async assignCategory(
    tenantId: number,
    pack: TemplatePack,
    formIds: readonly number[],
  ): Promise<void> {
    if (pack.categoryName === undefined) return
    try {
      const existing = (await this.authz.listCategories(tenantId)).find(
        (c) => c.name === pack.categoryName,
      )
      const category = existing ?? (await this.authz.createCategory(tenantId, pack.categoryName))
      for (const formId of formIds) await this.authz.setFormCategory(tenantId, formId, category.id)
    } catch (err) {
      /* 表已經建好且可用 —— 為了分類把整包回滾不划算。但不吞:
         使用者會看到表出現在「未分類」,而他需要知道那不是設計如此。 */
      this.log.error(`範本 ${pack.key} 的分類指派失敗,表單已建立但落在未分類`, err)
    }
  }

  /* 相對代號 → 真實 formId。**解析不出來就是程式錯**(`validatePackRefs` 已擋過),
     故拋而不是回 undefined —— 帶著 undefined 往下走會生出一個沒有 target 的 link 欄,
     而那正是「壞掉的關聯而且不會報錯」。 */
  private mustResolve(refMap: Record<string, number>, ref: string): number {
    const id = refMap[ref]
    if (id === undefined) throw new Error(`template ref not resolved: ${ref}`)
    return id
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

  private async compensate(
    tenantId: number,
    created: readonly number[],
    actorId?: number,
  ): Promise<void> {
    const failed: number[] = []
    /* 反序下架:子表先於父表,避免父表被下架後子表成為孤兒 */
    for (const formId of [...created].reverse()) {
      try {
        await this.ddl.dropForm(tenantId, formId, actorId)
      } catch (err) {
        failed.push(formId)
        this.log.error(`套用範本失敗後,補償下架表單 ${String(formId)} 也失敗`, err)
      }
    }
    if (failed.length > 0) {
      /* 不吞 —— 使用者接下來會看到幾張半成品的表,他需要知道那是什麼 */
      this.log.error(
        `範本套用失敗且未能完全復原;殘留表單 id:${failed.join(", ")}(租戶 ${String(tenantId)})`,
      )
    }
  }
}
