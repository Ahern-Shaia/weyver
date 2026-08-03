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

/* PG 單句綁定參數上限 65535,一列 6 欄 → 理論上限約 10900 列。取一半留餘裕。 */
const INSERT_CHUNK = 5000

@Injectable()
export class SearchIndexService {
  /* 無建構子依賴 —— 一律在**呼叫端的 tx** 內寫入,不自己取連線。
     這正是「同一個 tx」的具體保證:拿不到自己的連線就不可能寫到別的 tx 去。 */

  static isSearchable(type: string): boolean {
    return SEARCHABLE.has(type)
  }

  /* 🔴 這筆記錄**寫得出任何索引列嗎**。

     可搜欄位全為空的記錄(例如只有一個 barcode 欄而它沒填)本來就不該有索引列。
     對帳若只看「有沒有索引列」,這種記錄會被永遠當成缺漏 —— 補寫完立刻又報一次。
     那會讓對帳變成恆紅的假警報,而真正的缺漏就藏在那片噪音裡。

     與 `upsertInTx` 共用 `normalize`,兩邊對「什麼算有內容」不可能分岔。 */
  static hasIndexableContent(
    fields: readonly IndexableField[],
    values: Readonly<Record<string, unknown>>,
  ): boolean {
    return fields.some(
      (f) => SearchIndexService.isSearchable(f.type) && normalize(values[f.name]) !== null,
    )
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

  /* 🔴 R4|**批次建立**專用。此前 `createManyRecords` 完全沒有寫索引 ——
     Excel 匯進來的資料一筆都搜不到,而那對遷移中的客戶就是他的全部資料。
     沒有任何錯誤訊息,只有「搜尋看起來好好的」。

     **只給建立用**:不處理「值被清空要刪索引列」,因為新記錄沒有舊索引可清。
     更新路徑(含 `saveWithLines` 的既有列)一律走逐筆的 `upsertInTx`。

     分段送是必要的不是保險:PG 單句上限 65535 個綁定參數,一列 6 欄 →
     一次最多約 10900 列;5000 筆記錄 × 數個可搜欄位輕易就超過。 */
  async upsertManyInTx(
    trx: Knex.Transaction,
    input: {
      readonly tenantId: number
      readonly formId: number
      readonly fields: readonly IndexableField[]
      readonly records: readonly {
        readonly recordId: number
        readonly values: Readonly<Record<string, unknown>>
      }[]
    },
  ): Promise<void> {
    const searchable = input.fields.filter((f) => SearchIndexService.isSearchable(f.type))
    if (searchable.length === 0) return

    const rows: {
      tenant_id: number
      form_id: number
      record_id: number
      field_id: number
      field_name: string
      value_text: string
    }[] = []
    for (const record of input.records) {
      for (const f of searchable) {
        const text = normalize(record.values[f.name])
        if (text === null) continue
        rows.push({
          tenant_id: input.tenantId,
          form_id: input.formId,
          record_id: record.recordId,
          field_id: f.id,
          field_name: f.name,
          value_text: text.slice(0, MAX_VALUE_LEN),
        })
      }
    }
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await trx("search_doc")
        .insert(rows.slice(i, i + INSERT_CHUNK))
        .onConflict(["tenant_id", "form_id", "record_id", "field_id"])
        .merge(["field_name", "value_text", "updated_at"])
    }
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
