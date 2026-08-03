import { Inject, Injectable } from "@nestjs/common"
import type { Knex } from "knex"
import { APP_KNEX } from "../db/db.module.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { MetadataService } from "../form-engine/metadata/metadata.service.js"
import { SearchTimeoutError } from "../form-engine/errors.js"

/* 🔴 R1·H-3 M3|跨表搜尋查詢。

   ## 搜尋範圍 = 使用者有權限的表(OQ-FTS-2=A)

   對齊 Ragic 官方行為:首頁搜尋涵蓋「all the sheets that you have Access Right to」。
   這也是遷移客戶的既有心智。全租戶搜尋會洩漏「無權表的存在」。

   ## 🔴 S2(P0)權限必須 pre-filter,不可事後過濾

   若先查完再濾掉無權欄位,**結果筆數本身就是洩漏** —— 使用者可由「搜某關鍵字有 3 筆
   但只顯示 1 筆」反推出另外 2 筆的存在,甚至用二分逼近猜出內容。
   故 `form_id IN (可讀表)` 與 `field_id NOT IN (隱藏欄)` 都寫進 WHERE。

   ## 排序是自建啟發式,非 BM25

   pg_bigm 是 `LIKE` 加速不是評分引擎,沒有 tf-idf。
   ⚠️ **誠實標注**:下列權重為自訂,無外部依據;若日後需要真正的相關性排序,
   那才是評估外部搜尋引擎的時機(見設計文件 §0.4 的取捨)。 */

const RESULT_CAP = 1000

/* 🔴 R2|搜尋路徑的 `statement_timeout`。2 字門檻與 1000 筆上限擋掉了**輸入端**的
   失控,但擋不住**資料端** —— 同一句查詢在租戶長大之後會愈來愈慢,而搜尋是
   使用者一邊打字一邊觸發的:一個慢查詢會被連續放大成很多個。

   逾時是取捨而不是錯誤,所以要轉成使用者做得了的事(把關鍵字打長一點),
   不能讓 PG 的 `canceling statement due to statement timeout` 冒到前端。 */
const SEARCH_STATEMENT_TIMEOUT = "5s"
/* PG 逾時取消查詢時的 SQLSTATE */
const QUERY_CANCELED = "57014"

export interface SearchHit {
  readonly formId: number
  readonly formName: string
  readonly recordId: number
  readonly fieldName: string
  readonly snippet: string
  readonly score: number
}

interface SearchRow {
  readonly form_id: unknown
  readonly record_id: unknown
  readonly field_name: unknown
  readonly value_text: unknown
}

export interface SearchResult {
  readonly hits: readonly SearchHit[]
  readonly truncated: boolean
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  async search(
    tenantId: number,
    query: string,
    permissions: EffectivePermissions,
    limit = 50,
  ): Promise<SearchResult> {
    const q = query.trim()
    /* 單字查詢對 bigram 索引無效(需至少 2 字元湊一個 bigram),
       且會命中過多結果 —— 直接回空,不讓它變成全表掃描 */
    if (q.length < 2) return { hits: [], truncated: false }

    const forms = await this.metadata.listForms(tenantId)
    const readableFormIds = permissions.readableFormIds(forms.map((f) => f.id))
    if (readableFormIds.length === 0) return { hits: [], truncated: false }

    const nameOf = new Map(forms.map((f) => [f.id, f.name]))

    /* 🔴 隱藏欄的 pre-filter:逐表算出不可見欄位,併成一組排除清單。
       fieldVisibility 回 'hidden' 者不得進搜尋範圍。 */
    const hiddenFieldIds: number[] = []
    for (const formId of readableFormIds) {
      const { fields } = await this.metadata.getForm(tenantId, formId)
      for (const f of fields) {
        if (permissions.fieldVisibility(f.id, formId) === "hidden") hiddenFieldIds.push(f.id)
      }
    }

    const cap = Math.min(limit, RESULT_CAP)

    /* 值一律參數綁定;`%` 為 LIKE 萬用字元故需先轉義,否則使用者輸入 `%` 會變成
       「匹配任意內容」的全表掃描(AGENTS.md:值一律參數綁定) */
    const pattern = `%${escapeLike(q)}%`

    /* 🔴 必須在設好 `app.tenant_id` 的交易內查 —— `search_doc` 有 RLS FORCE。
       漏掉的話:app 車道回空(壞掉但安全),而 dev 若回落到特權連線就會回**全部租戶**
       的資料(靜默洩漏)。兩種結局都不拋錯,所以非測不可(見 search.integration 端到端段)。 */
    const rows = await this.runSearch(tenantId, async (trx) => {
      let builder = trx("search_doc")
        .select("form_id", "record_id", "field_name", "value_text")
        .where("tenant_id", tenantId)
        .whereIn("form_id", readableFormIds)
        .where("value_text", "like", pattern)

      if (hiddenFieldIds.length > 0) builder = builder.whereNotIn("field_id", hiddenFieldIds)

      /* +1 用來判斷是否被截斷 —— 不多查一筆就分不出「剛好滿」與「還有更多」 */
      return builder.limit(cap + 1)
    })
    const truncated = rows.length > cap

    const hits = rows
      .slice(0, cap)
      .map((r) => {
        const value = String(r.value_text)
        return {
          formId: Number(r.form_id),
          formName: nameOf.get(Number(r.form_id)) ?? `表單 #${String(r.form_id)}`,
          recordId: Number(r.record_id),
          fieldName: String(r.field_name),
          snippet: snippet(value, q),
          score: score(value, q),
        }
      })
      .sort((a, b) => b.score - a.score || a.formId - b.formId || a.recordId - b.recordId)

    return { hits, truncated }
  }

  /* 交易 + 租戶 GUC + 逾時,三件事綁在一起 —— 分開放的話漏掉任何一件都不會拋錯:
     漏 GUC 是靜默洩漏(見上),漏逾時是靜默變慢。 */
  private async runSearch(
    tenantId: number,
    run: (trx: Knex.Transaction) => PromiseLike<SearchRow[]>,
  ): Promise<SearchRow[]> {
    try {
      return await this.knex.transaction(async (trx) => {
        await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
        await trx.raw(`SET LOCAL statement_timeout = '${SEARCH_STATEMENT_TIMEOUT}'`)
        return run(trx)
      })
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if ((error as { code: unknown }).code === QUERY_CANCELED) throw new SearchTimeoutError()
      }
      throw error
    }
  }
}

/* LIKE 萬用字元轉義 —— 使用者輸入的 % 與 _ 必須當字面值 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/* 自訂啟發式:完全命中 > 前綴命中 > 子字串;短值優先(命中佔比高者更相關) */
function score(value: string, q: string): number {
  const v = value.toLowerCase()
  const needle = q.toLowerCase()
  let s = 0
  if (v === needle) s += 100
  else if (v.startsWith(needle)) s += 50
  else s += 10
  /* 命中內容佔整個值的比例 —— 「食品」命中「食品」比命中一長串備註更相關 */
  s += Math.round((needle.length / Math.max(v.length, 1)) * 20)
  return s
}

/* 取命中處前後文;過長者截斷並加省略號 */
function snippet(value: string, q: string): string {
  const i = value.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0 || value.length <= 60) return value
  const start = Math.max(0, i - 20)
  const end = Math.min(value.length, i + q.length + 30)
  return `${start > 0 ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`
}
