import { ForbiddenException, Inject, Injectable } from "@nestjs/common"
import type { Knex } from "knex"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { APP_KNEX } from "../../db/db.module.js"
import { NotALinkFieldError, UnknownFieldError } from "../errors.js"
import { DATA_SCHEMA, physicalTableName } from "../identifiers.js"
import { MetadataService } from "../metadata/metadata.service.js"
import { RecordService } from "../records/record.service.js"

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
/* 🔴 對映以 **field id** 存,不用欄名 —— 沿用 `formula_def.depends_on` 的同一理由:
 **id 穩定於改名**。用欄名的話,來源表單改個欄名就靜默斷掉,而畫面上看不出來。 */
export interface LoadPair {
  readonly fromFieldId: number
  readonly toFieldId: number
}

export function parseLoadMap(raw: unknown): LoadPair[] {
  if (!Array.isArray(raw)) return []
  const out: LoadPair[] = []
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue
    const o = item as { fromFieldId?: unknown; toFieldId?: unknown }
    if (typeof o.fromFieldId !== "number" || typeof o.toFieldId !== "number") continue
    if (!Number.isInteger(o.fromFieldId) || !Number.isInteger(o.toFieldId)) continue
    out.push({ fromFieldId: o.fromFieldId, toFieldId: o.toFieldId })
  }
  return out
}

/* 🔴 audit-E §2.5|**記錄範圍的閘**。

   `record_scope` 未設時,`ddl.service` 的 RESTRICTIVE policy 整條為真
   (`NULLIF(current_setting('app.record_scope', true), '')` → 視同 'all')——
   於是受「只能看自己的記錄」限制的人,可以用 `?ids=1,2,3…` 逐一枚舉
   目標表任意記錄的標題。原本候選清單只回最近 20 筆,`ids=` 把它放大成任意 id 查詢。

   ⚠️ **機制早就存在,範本就在 `record.service.inTenantTx`** —— 新路徑沒有套用而已。
   這正是「綁了 tenant_id ≠ 有權存取這一筆」的形狀:租戶對了,**這一筆**沒對。

   ⚠️ 三個 GUC 一起設,**不設的那個會沿用同一條連線上的殘值**
   (連線池重用;`record.service` 的同一段註解逐字警告過)——
   所以這裡明確把三個都寫一次,而不是「只設需要的那個」。 */
async function setScopeGucs(
  trx: Knex.Transaction,
  tenantId: number,
  targetFormId: number,
  permissions: EffectivePermissions | undefined,
  actorId: number | null | undefined,
): Promise<void> {
  const own = permissions?.isScopedToOwn?.(targetFormId, "view") === true
  await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
  await trx.raw(`SELECT set_config('app.record_scope', ?, true)`, [own ? "own" : "all"])
  await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [
    actorId === undefined || actorId === null ? "" : String(actorId),
  ])
}

@Injectable()
export class LinkOptionsService {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(RecordService) private readonly records: RecordService,
  ) {}

  async listOptions(
    tenantId: number,
    formId: number,
    fieldId: number,
    q: string,
    limit: number,
    permissions?: EffectivePermissions,
    /* 🔴 記錄範圍(E-1)需要「我是誰」。缺它就只能全開,而那正是下面那個 bug。 */
    actorId?: number | null,
    /* 🔴 audit-D §2.2|**指名解析**:給定 id 取標題,而不是「最近 N 筆裡找找看」。

       記錄頁要顯示的是**這一筆連到誰**,而候選清單只回最近的一批 ——
       用清單去查表的話,連到舊記錄就查不到,而畫面會靜靜地顯示一個數字 id。
       同一支方法、同一套遮罩與標題推導,只是換一個過濾條件。 */
    ids?: readonly number[],
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
      await setScopeGucs(trx, tenantId, targetFormId, permissions, actorId)
      const builder = trx
        .withSchema(DATA_SCHEMA)
        .table(table)
        .where({ tenant_id: tenantId })
        .whereNull("deleted_at")
        .orderBy("id", "desc")
        .limit(capped)
      if (ids !== undefined) void builder.whereIn("id", [...ids])
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

  /* 🔴 R1·LNK M2|Load 帶入:取目標記錄的**已對映欄值**。

     ## 為什麼回「本地欄名 → 值」而不是原樣

     前端的填單狀態是 `本地欄名 → 值` 的 record,直接可 spread。
     讓後端做對映還有一個更重要的理由:**對映表是設定,不該讓前端自己解讀** ——
     前端拿到 `fromFieldId` 還要自己查欄名,那份查表邏輯遲早與後端漂移。

     ## 權限:走 `getRecord` 而不是自己查表

     `getRecord` 已經套 `maskRead`(含 2026-08-04 的公式污染閉包)——
     來源欄若對此人隱藏,**它根本不會出現在回傳值裡**,於是也帶不進來。
     🔴 **這是 fail-closed 的關鍵**:自己寫一條 SQL 取值等於繞過遮罩,
     而 Ragic 對同一風險的解法是「**設定了欄位層級存取權限的欄位不准當連結欄位**」
     (`doc/14`)—— 它用禁止,我們用遮罩,兩者都不讓值漏出去。 */
  async loadValues(
    tenantId: number,
    formId: number,
    fieldId: number,
    recordId: number,
    permissions?: EffectivePermissions,
    actorId?: number | null,
  ): Promise<Record<string, unknown>> {
    const loaded = await this.metadata.getForm(tenantId, formId)
    const field = loaded.fields.find((f) => f.id === fieldId)
    if (field === undefined) throw new UnknownFieldError(String(fieldId))
    if (field.cellValueType !== "link") throw new NotALinkFieldError(field.name)

    const options = field.options as { targetFormId?: unknown; loadMap?: unknown } | null
    const targetFormId = typeof options?.targetFormId === "number" ? options.targetFormId : null
    if (targetFormId === null) throw new NotALinkFieldError(field.name)
    if (permissions !== undefined && !permissions.canRead(targetFormId)) {
      throw new ForbiddenException({
        code: "LINK_TARGET_FORBIDDEN",
        message: "你對這個連結欄的來源表單沒有檢視權",
      })
    }

    const pairs = parseLoadMap(options?.loadMap)
    if (pairs.length === 0) return {}

    const target = await this.metadata.getForm(tenantId, targetFormId)
    /* 🔴 `getRecord` 的第五個參數是**記錄範圍所需的 actor**,不給的話受 own 限制者
       一律解析不到(而症狀是「這筆帶不出來」,指不到原因)。 */
    const record = await this.records.getRecord(
      tenantId,
      targetFormId,
      recordId,
      permissions,
      actorId ?? null,
    )

    const out: Record<string, unknown> = {}
    for (const pair of pairs) {
      const from = target.fields.find((f) => f.id === pair.fromFieldId)
      const to = loaded.fields.find((f) => f.id === pair.toFieldId)
      if (from === undefined || to === undefined) continue
      /* 🔴 來源欄被遮罩時 `values` 裡根本沒有這個鍵 → 不帶入(而不是帶入 undefined)。
         帶入 undefined 會把使用者原本填的值清掉,那是靜默的資料遺失。 */
      if (!(from.name in record.values)) continue
      out[to.name] = record.values[from.name]
    }
    return out
  }
}
