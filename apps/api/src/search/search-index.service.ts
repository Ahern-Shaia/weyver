import { Injectable } from "@nestjs/common"
import type { Knex } from "knex"
import { FIELD_TYPE_REGISTRY } from "../form-engine/field-types/field-type-registry.js"

/* 🔴 R1·H-3 M2|搜尋索引寫入。

   ## 為什麼與記錄寫入同一個 tx

   Baserow 官方 issue #3642 第一手承認,他們用 Celery 非同步維護索引的結果是
   「proven fragile」「increases the likelihood of deadlocks」「can become
   **out of sync**, leading to inaccurate search results」。
   本表 grain 是「一列一欄位值」,單筆記錄的 upsert 成本可忽略 —— 沒有理由為了
   省這點成本換來「索引與資料不一致」這種最難查的 bug。

   ## 只索引「文字型」欄位

   數值 / 日期 / 布林走既有的 filter,不需要全文搜尋;把它們塞進來只會膨脹索引
   並讓命中變得沒有意義(搜「1」命中所有數量為 1 的記錄)。

   ## 🔴 為什麼存 field_name 快照

   搜尋結果要說得出「命中哪一欄」。若查詢時才去 join field_def,
   欄位改名後歷史結果的欄名會跟著變,且多一次 join。 */

/* 🔴 由 FIELD_TYPE_REGISTRY **推導**,不手寫字串清單。

   首版是手寫的,裡面有 `textarea` 與 `richText` —— **兩個型別都不存在**(真正的長文字
   型別叫 `longText`)。結果是備註 / 說明這類最該被搜尋的欄位靜默地從未進索引;
   而型別參數是 `string` 不是 union,型別檢查完全抓不到。推導使這種漂移不可能發生。

   規則:物理存文字的(`text` / `text_array`)且**非 virtual**。
   virtual(lookup / rollup / createdBy…)是讀時計算,沒有任何寫入路徑會通知我們更新
   索引 —— 索引下去保證過期。要搜這些欄位得先有依賴失效機制,屬後續範圍。 */
const SEARCHABLE: ReadonlySet<string> = new Set(
  Object.entries(FIELD_TYPE_REGISTRY)
    .filter(
      ([, def]) =>
        (def.dbFieldType === "text" || def.dbFieldType === "text_array") && def.virtual !== true,
    )
    .map(([type]) => type),
)

export interface IndexableField {
  readonly id: number
  readonly name: string
  readonly type: string
}

/* 單值上限 —— 長備註沒必要整篇進索引;GIN 寫入放大與此成正比(FMEA S6) */
const MAX_VALUE_LEN = 2000

@Injectable()
export class SearchIndexService {
  /* 無建構子依賴 —— 一律在**呼叫端的 tx** 內寫入,不自己取連線。
     這正是「同一個 tx」的具體保證:拿不到自己的連線就不可能寫到別的 tx 去。 */

  static isSearchable(type: string): boolean {
    return SEARCHABLE.has(type)
  }

  /* 在**呼叫端的 tx 內**寫入 —— 不自己開 tx。 */
  async upsertInTx(
    trx: Knex.Transaction,
    input: {
      readonly tenantId: number
      readonly formId: number
      readonly recordId: number
      readonly fields: readonly IndexableField[]
      readonly values: Readonly<Record<string, unknown>>
    },
  ): Promise<void> {
    const rows: {
      tenant_id: number
      form_id: number
      record_id: number
      field_id: number
      field_name: string
      value_text: string
    }[] = []
    const stale: number[] = []

    for (const f of input.fields) {
      if (!SearchIndexService.isSearchable(f.type)) continue
      const raw = input.values[f.name]
      const text = normalize(raw)
      if (text === null) {
        /* 值被清空 → 該欄的索引列必須刪掉,否則搜得到已不存在的內容 */
        stale.push(f.id)
        continue
      }
      rows.push({
        tenant_id: input.tenantId,
        form_id: input.formId,
        record_id: input.recordId,
        field_id: f.id,
        field_name: f.name,
        value_text: text.slice(0, MAX_VALUE_LEN),
      })
    }

    if (stale.length > 0) {
      await trx("search_doc")
        .where({ tenant_id: input.tenantId, form_id: input.formId, record_id: input.recordId })
        .whereIn("field_id", stale)
        .delete()
    }
    if (rows.length === 0) return

    await trx("search_doc")
      .insert(rows)
      .onConflict(["tenant_id", "form_id", "record_id", "field_id"])
      .merge(["field_name", "value_text", "updated_at"])
  }

  /* 記錄刪除(含 soft delete)→ 移出索引。
     soft delete 的記錄不該被搜到 —— 它在使用者眼中已經不存在。 */
  async removeInTx(
    trx: Knex.Transaction,
    tenantId: number,
    formId: number,
    recordId: number,
  ): Promise<void> {
    await trx("search_doc")
      .where({ tenant_id: tenantId, form_id: formId, record_id: recordId })
      .delete()
  }

  /* 整張表移出(表被刪 / 欄位定義大改後重建) */
  async removeFormInTx(trx: Knex.Transaction, tenantId: number, formId: number): Promise<void> {
    await trx("search_doc").where({ tenant_id: tenantId, form_id: formId }).delete()
  }
}

/* 值正規化 —— 陣列(multiSelect)攤平為空白分隔;空值回 null 代表「該刪」 */
function normalize(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) {
    const joined = raw
      .map((v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : ""))
      .filter((v) => v !== "")
      .join(" ")
    return joined === "" ? null : joined
  }
  if (typeof raw === "string") return raw.trim() === "" ? null : raw.trim()
  if (typeof raw === "number") return String(raw)
  return null
}
