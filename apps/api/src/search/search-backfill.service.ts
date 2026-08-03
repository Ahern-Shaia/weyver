import { Inject, Injectable, Logger } from "@nestjs/common"
import type { Knex } from "knex"
import { DDL_KNEX } from "../db/db.module.js"
import { DATA_SCHEMA, physicalColumnName } from "../form-engine/identifiers.js"
import { SearchIndexService } from "./search-index.service.js"

/* 🔴 R1·H-3 殘留 R1|既有資料的搜尋索引補寫(**pilot 上線前必做**)。

   ## 為什麼需要

   索引是**同 tx 寫入**的(見 search-index.service.ts):建 / 改 / 刪 / 還原四條路徑
   都會維護它。但那只涵蓋「這個功能上線之後」的寫入 —— **上線前就存在的記錄
   從來沒有經過那些路徑**,因此完全搜不到。

   對 pilot 客戶而言這是最糟的失敗形態:功能看起來好好的(新建的搜得到),
   但他們**歷年的資料一筆都搜不到**,而且沒有任何錯誤訊息。

   ## 設計取捨

   · **分批 + 可續跑**|不用一個大交易掃完整個租戶。逐表單、逐批(預設 500 筆)
     各自成一個交易 —— 中途中斷已完成的部分不會回滾,再跑一次就從缺的地方補。
   · **冪等**|沿用索引寫入的 `onConflict … merge`,重跑不會產生重複列。
   · **只補缺的**|預設跳過已有索引的記錄(`--force` 才全部重寫)。
     pilot 前通常只需要補歷史,沒必要動已經正確的部分。
   · **不自己解析欄位值**|直接用 `SearchIndexService.upsertInTx`,與線上寫入
     走**同一段程式碼**。另寫一份解析邏輯的話,兩邊對「什麼算可搜尋」的判斷
     遲早會分岔,而分岔的結果就是「有些欄位永遠搜不到」——
     那正是這個模組已經踩過一次的坑(手寫型別清單裡有兩個不存在的型別)。 */

export interface BackfillProgress {
  readonly formId: number
  readonly formName: string
  readonly scanned: number
  readonly indexed: number
}

export interface BackfillResult {
  readonly forms: readonly BackfillProgress[]
  readonly totalScanned: number
  readonly totalIndexed: number
}

const BATCH = 500

@Injectable()
export class SearchBackfillService {
  private readonly logger = new Logger(SearchBackfillService.name)

  constructor(
    /* 特權車道:這是營運工具,要跨整個租戶掃描,且執行時沒有請求語境可帶 RLS。
     **租戶邊界由 `tenantId` 參數界定**,而呼叫端是 CLI 不是 HTTP。 */
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(SearchIndexService) private readonly index: SearchIndexService,
  ) {}

  async run(tenantId: number, options: { readonly force?: boolean } = {}): Promise<BackfillResult> {
    const forms = await this.knex("form_def")
      .where({ tenant_id: tenantId })
      .whereNull("deleted_at")
      .orderBy("id")
      .select<{ id: number; name: string; physical_table: string }[]>(
        "id",
        "name",
        "physical_table",
      )

    const progress: BackfillProgress[] = []
    for (const form of forms) {
      progress.push(
        await this.backfillForm(tenantId, { ...form, id: Number(form.id) }, options.force === true),
      )
    }

    return {
      forms: progress,
      totalScanned: progress.reduce((n, p) => n + p.scanned, 0),
      totalIndexed: progress.reduce((n, p) => n + p.indexed, 0),
    }
  }

  private async backfillForm(
    tenantId: number,
    form: { id: number; name: string; physical_table: string },
    force: boolean,
  ): Promise<BackfillProgress> {
    const fields = await this.knex("field_def")
      .where({ form_id: form.id })
      .whereNull("deleted_at")
      /* ⚠️ 型別欄叫 `cell_value_type`,不是 `type` —— 首版寫成 `type` 直接讓查詢炸掉。
         實體欄名則是 `f<id>`(generated column),不是欄位名稱。 */
      .select<{ id: number; name: string; cell_value_type: string }[]>(
        "id",
        "name",
        "cell_value_type",
      )

    /* ⚠️ knex 對 bigint 回傳**字串**(pg 的預設行為)—— 直接餵給 `physicalColumnName`
       會被 `Number.isSafeInteger` 擋下並拋 `illegal fieldId`。drizzle 那邊有
       `mode: "number"` 幫忙轉,knex 沒有。 */
    const searchable = fields
      .map((f) => ({ id: Number(f.id), name: f.name, type: f.cell_value_type }))
      .filter((f) => SearchIndexService.isSearchable(f.type))
    /* 沒有可搜尋欄位的表單直接跳過 —— 掃了也寫不出任何索引列 */
    if (searchable.length === 0)
      return { formId: form.id, formName: form.name, scanned: 0, indexed: 0 }

    let scanned = 0
    let indexed = 0
    let afterId = 0

    for (;;) {
      /* keyset 而非 offset:offset 在大表上會隨頁數線性變慢,且併發寫入時會跳列。
         `physical_table` 來自 metadata catalog 的 generated column(`'t' || id`),
         不是使用者輸入 —— 但仍以 knex 的 identifier 引用,不做字串拼接。 */
      const rows = await this.knex
        .withSchema(DATA_SCHEMA)
        .table(form.physical_table)
        .where({ tenant_id: tenantId })
        .where("id", ">", afterId)
        .whereNull("deleted_at")
        .orderBy("id")
        .limit(BATCH)
        .select<Record<string, unknown>[]>("*")

      if (rows.length === 0) break
      afterId = Number(rows[rows.length - 1]?.id ?? 0)
      scanned += rows.length

      const ids = rows.map((r) => Number(r.id))
      const already = force ? new Set<number>() : await this.indexedIds(tenantId, form.id, ids)

      await this.knex.transaction(async (trx) => {
        for (const row of rows) {
          const recordId = Number(row.id)
          if (already.has(recordId)) continue
          /* 🔴 實體列的鍵是 `f<id>`,而索引寫入吃的是**欄位名稱**為鍵的物件
             (`values[f.name]`)。直接把原始列丟過去的話,每個欄位都會查到
             undefined → 被當成「值已清空」→ 一筆都不會進索引,而且不報錯。 */
          const values: Record<string, unknown> = {}
          for (const f of searchable) values[f.name] = row[physicalColumnName(f.id)]

          await this.index.upsertInTx(trx, {
            tenantId,
            formId: form.id,
            recordId,
            fields: searchable,
            values,
          })
          /* 🔴 只數**真的寫出索引列**的那些。可搜欄位全空的記錄寫不出任何列,
             把它算進「補寫 N 筆」會讓日誌宣稱做了事,而下一次對帳照樣報同一批。 */
          if (SearchIndexService.hasIndexableContent(searchable, values)) indexed += 1
        }
      })
    }

    if (indexed > 0) {
      this.logger.log(`表單 ${form.name}(#${String(form.id)}):補寫 ${String(indexed)} 筆索引`)
    }
    return { formId: form.id, formName: form.name, scanned, indexed }
  }

  /* 已有索引的記錄 id。一次查一批,不逐筆問。 */
  private async indexedIds(
    tenantId: number,
    formId: number,
    recordIds: readonly number[],
  ): Promise<Set<number>> {
    const rows = await this.knex("search_doc")
      .where({ tenant_id: tenantId, form_id: formId })
      .whereIn("record_id", [...recordIds])
      .distinct<{ record_id: number }[]>("record_id")
    return new Set(rows.map((r) => Number(r.record_id)))
  }

  /* 🔴 對帳:算出「應該有索引卻沒有」的記錄數。**無副作用**,只讀不寫。

     backfill 跑完應為 0;日後若不為 0,代表某條寫入路徑漏接了索引 ——
     這正是 Baserow 官方自陳的「out of sync, leading to inaccurate search results」,
     而它不會自己現形,只會讓使用者覺得「搜尋怪怪的」。

     ⚠️ 逐表單查,不是一句 SQL —— 每張表單的實體表不同,無法一次 join 完。
     這是營運工具不是熱路徑,清楚比快重要。 */
  async countMissing(
    tenantId: number,
  ): Promise<{ formId: number; formName: string; missing: number }[]> {
    const forms = await this.knex("form_def")
      .where({ tenant_id: tenantId })
      .whereNull("deleted_at")
      .orderBy("id")
      .select<{ id: number; name: string; physical_table: string }[]>(
        "id",
        "name",
        "physical_table",
      )

    const out: { formId: number; formName: string; missing: number }[] = []
    for (const form of forms) {
      const formId = Number(form.id)
      const fields = await this.knex("field_def")
        .where({ form_id: formId })
        .whereNull("deleted_at")
        .select<{ id: number | string; name: string; cell_value_type: string }[]>(
          "id",
          "name",
          "cell_value_type",
        )
      if (!fields.some((f) => SearchIndexService.isSearchable(f.cell_value_type))) continue

      /* 🔴 不能只數「沒有索引列的記錄」—— 可搜欄位全空的記錄本來就寫不出索引列,
         那樣數會讓對帳恆紅:補寫完立刻又報同一批(dev 實測 form #12 只有一個
         barcode 欄且三筆全空,補寫→對帳→再補寫,永遠不會歸零)。
         恆紅的檢查等於沒有檢查,真正的缺漏會藏在那片噪音裡。

         故取出候選列後,用**與寫入端同一段判斷**(`hasIndexableContent`)過濾。
         只選可搜欄位,不 `select *`。 */
      const searchable = fields
        .map((f) => ({ id: Number(f.id), name: f.name, type: f.cell_value_type }))
        .filter((f) => SearchIndexService.isSearchable(f.type))
      const candidates = await this.knex
        .withSchema(DATA_SCHEMA)
        .table(form.physical_table)
        .where({ tenant_id: tenantId })
        .whereNull("deleted_at")
        .whereNotExists((qb) =>
          qb
            .select(this.knex.raw("1"))
            .from("search_doc")
            .whereRaw("search_doc.record_id = ??.id", [form.physical_table])
            .andWhere("search_doc.tenant_id", tenantId)
            .andWhere("search_doc.form_id", formId),
        )
        .select<Record<string, unknown>[]>(searchable.map((f) => physicalColumnName(f.id)))

      const missing = candidates.filter((row) => {
        const values: Record<string, unknown> = {}
        for (const f of searchable) values[f.name] = row[physicalColumnName(f.id)]
        return SearchIndexService.hasIndexableContent(searchable, values)
      }).length
      if (missing > 0) out.push({ formId, formName: form.name, missing })
    }
    return out
  }
}
