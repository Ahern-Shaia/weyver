import { Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common"
import { DdlService } from "../form-engine/ddl/ddl.service.js"
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

  constructor(@Inject(DdlService) private readonly ddl: DdlService) {}

  async apply(tenantId: number, pack: TemplatePack, actorId?: number): Promise<ApplyResult> {
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

    const refMap: Record<string, number> = {}
    const created: number[] = []
    try {
      for (const form of ordered) {
        const built = await this.ddl.createForm(
          tenantId,
          {
            name: form.name,
            ...(form.parentRef === undefined
              ? {}
              : { parentFormId: this.mustResolve(refMap, form.parentRef) }),
            fields: form.fields.map((f) => this.resolveField(refMap, f)),
          },
          actorId,
        )
        refMap[form.ref] = built.form.id
        created.push(built.form.id)
      }
      return { formIds: created, refMap }
    } catch (e) {
      await this.compensate(tenantId, created, actorId)
      throw e
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
