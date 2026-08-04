import { ForbiddenException, Inject, Injectable } from "@nestjs/common"
import type { Knex } from "knex"
import { APP_KNEX } from "../../db/db.module.js"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { NotALinkFieldError, UnknownFieldError } from "../errors.js"
import { DATA_SCHEMA, physicalTableName } from "../identifiers.js"
import { MetadataService } from "../metadata/metadata.service.js"

/* 🔴 R1·LNK M1|連結欄的**候選記錄清單**。

   在此之前 `field-input.tsx` 沒有 `case "link"` —— 連結欄落到預設分支,
   **使用者要自己打目標記錄的 id**。連結是 Ragic 兩大招牌之一,遷移客戶天天在用。

   ## 權限:來源表單的權限**不蘊含**目標表單的權限

   你在填「採購單」不代表你看得到「供應商」。故除了進到這裡需要來源表單的 `view`
   (由 controller 的 `@RequiresFormAction` 擋),這裡**再驗一次目標表單**。

   ⚠️ 這條沿用 `WidgetService` 已經驗證過的範式(OQ-PC-12):
   **只在前端過濾等於沒做,直接打 API 就能繞**。後端才是執法點。

   ## label 也要過遮罩

   候選清單長的是「給人看的標題」,而標題欄可能對這個人隱藏。
   隱藏時回 `#id` —— **不是回空白**:空白會讓使用者以為那筆沒資料,
   而他其實是沒權限(同 `pivot-and-charts` 的裁定:寧可具名,不要靜默)。 */
@Injectable()
export class LinkOptionsService {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  async listOptions(
    tenantId: number,
    formId: number,
    fieldId: number,
    q: string,
    limit: number,
    permissions?: EffectivePermissions,
  ): Promise<{ id: number; label: string }[]> {
    const loaded = await this.metadata.getForm(tenantId, formId)
    const field = loaded.fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new UnknownFieldError(String(fieldId))
    if (field.cellValueType !== "link") throw new NotALinkFieldError(field.name)

    const options = field.options as { targetFormId?: unknown } | null
    const targetFormId = typeof options?.targetFormId === "number" ? options.targetFormId : null
    if (targetFormId === null) throw new NotALinkFieldError(field.name)

    /* 🔴 目標表單的 view 權 —— 來源權限不蘊含目標權限 */
    if (permissions !== undefined && !permissions.canRead(targetFormId)) {
      throw new ForbiddenException({
        code: "LINK_TARGET_FORBIDDEN",
        message: "你對這個連結欄的來源表單沒有檢視權",
      })
    }

    const target = await this.metadata.getForm(tenantId, targetFormId)
    /* 標題欄 = 第一個 text 欄(沿用 `access-preview.service.ts` 既有慣例);
       沒有 text 欄時退回 id。 */
    const titleField = target.fields.find((f) => f.cellValueType === "text")
    const titleHidden =
      titleField !== undefined &&
      permissions?.fieldVisibility(titleField.id, targetFormId) === "hidden"
    const titleCol = titleField === undefined || titleHidden ? null : `f${String(titleField.id)}`

    const table = physicalTableName(targetFormId)
    const capped = Math.min(Math.max(limit, 1), 50)

    /* 動態表走 Knex 車道 + tx 範圍的 `set_config` —— RLS 執法 + app 層 tenant 雙防線(鐵則 3) */
    return this.knex.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
      const builder = trx
        .withSchema(DATA_SCHEMA)
        .table(table)
        .where({ tenant_id: tenantId })
        .whereNull("deleted_at")
        .orderBy("id", "desc")
        .limit(capped)
      /* 搜尋只在標題欄上做 —— 掃全部欄位等於把隱藏欄變成可探測面
         (`field-leak` 已為快速搜尋修過同型)。標題被遮時不提供搜尋。 */
      if (q !== "" && titleCol !== null) {
        void builder.whereILike(titleCol, `%${q}%`)
      }
      const rows: unknown[] = await builder.select(
        titleCol === null ? { id: "id" } : { id: "id", title: titleCol },
      )
      return rows.map((r) => {
        const row = r as { id: number | string; title?: unknown }
        const id = Number(row.id)
        const raw = typeof row.title === "string" ? row.title.trim() : ""
        return { id, label: raw === "" ? `#${String(id)}` : raw }
      })
    })
  }
}
