import { Inject, Injectable, Logger } from "@nestjs/common"

import { type RecordValues, conditionsMatch } from "@weyver/rules"
import { compileValues } from "../actions/compile-values.js"
import { type TriggerRow, TriggersRepository } from "./triggers.repository.js"

/* 🔴 R1·C-4 M2|同步觸發器。**整個模組的關鍵在這一支的一句話上:**

   ## 改的是「即將寫入的值」,不是「寫完再改一次」

   直覺的做法是存檔後再跑一次 `updateRecord`。那樣做會同時得到四個問題:

   1. **遞迴** —— 第二次 DML 會再發一個 `record.updated`,再觸發一次,無限下去
   2. **兩筆修改紀錄** —— 使用者改了一次,畫面上卻顯示「使用者改了、然後系統又改了」
   3. **中間態外洩** —— 兩次寫入之間,別人讀得到還沒被觸發器修正的值
   4. **半套** —— 主檔存了、觸發器那次失敗了,資料停在不一致的狀態

   本支的做法是在寫入**之前**把值算好,一次寫進去。上面四個問題**在構造上不存在**,
   不是「有處理」。

   ⚠️ **這段第一版寫著「這也是 Salesforce before-save 與 after-save 分開的理由」——
   而那句話當時沒有任何查證,是憑印象寫的。** 2026-08-06 補查後改成這樣:

   Salesforce 官方〈Triggers and Order of Execution〉第 3 步逐字
   「Executes record-triggered flows that are configured to **run before the record is saved**」
   —— **時機**這件事查證屬實。
   <https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm>

   但**「因為省掉第二次 DML 所以比較快」這個理由,本專案沒查到一手出處**
   (Architect 決策指南的 URL 404,只有搜尋摘要,不算數)。
   故此處只引用時機,不引用理由 —— 上面四點本來就自己站得住,不必借別人的權威。

   ## 為什麼只有 `updateSelf` 走同步

   `pushTo` 是往**別張表**寫,它會失敗(權限 / 驗證 / 目標表不在)。
   讓它跟著使用者的存檔一起 rollback,等於「別人的表設錯了,我這張表存不了」。
   故 `pushTo` 走既有 `event_outbox` 非同步(M3)。

   ## 🔴 欄位級寫入權限:同步側**刻意繞過**

   這是與 `pushTo` 不同的裁定,理由是**跨不跨邊界**:

   - `updateSelf` 動的是**這張表、這一筆** —— 而觸發器是**這張表的設計者**設的,
     設計者本來就有權決定這張表的欄位怎麼變。最常見的用途正是
     「使用者不能改『狀態』,但存檔時系統把它設成待審」——
     若照使用者的欄位權限擋,這個功能等於不存在。
   - `pushTo` 跨到**別張表**,設計者未必有那張表的權限 → 仍以觸發者身分執行,
     否則「我看不到那張表,但我可以設一條觸發器往裡面寫」就成立(M3)。

   ⚠️ 代價誠實記:誰能建觸發器 = 誰能繞過這張表的欄位級寫入權限。
   故建立 / 修改觸發器的權限與**改表單設計**同級,不是一般編輯權。 */

const EMPTY: ReadonlySet<string> = new Set()

const noop = (values: RecordValues): SyncTriggerResult => ({
  values,
  ran: [],
  bypassFields: EMPTY,
  skipped: [],
})

export interface SyncTriggerResult {
  readonly values: RecordValues
  /* 跑過的觸發器,供呼叫端寫執行紀錄 —— 本支不自己寫,因為它拿不到交易 */
  readonly ran: readonly { readonly triggerId: number; readonly fields: readonly string[] }[]
  /* 🔴 由觸發器設定的欄位。呼叫端據此豁免**欄位級寫入權限**(見 `assertWritable`)。
     只列觸發器真的動過的欄位 —— 回傳整份 values 的話,豁免範圍會擴大到
     使用者自己送上來的欄位,那就是真的權限漏洞。 */
  readonly bypassFields: ReadonlySet<string>
  /* 🔴 因為引用的欄位已不存在而被跳過的觸發器(FMEA T2)。
     呼叫端**必須**據此寫執行紀錄 —— 靜默跳過等於「不動而沒人知道為什麼」。 */
  readonly skipped: readonly { readonly triggerId: number; readonly missingFields: string[] }[]
}

@Injectable()
export class TriggerSyncService {
  private readonly logger = new Logger(TriggerSyncService.name)

  constructor(@Inject(TriggersRepository) private readonly repo: TriggersRepository) {}

  /* 🔴 把「因為欄位不見了而跳過」寫成執行紀錄。

     **在交易外、事後寫**:它不能拖垮存檔,也不該因為存檔 rollback 就消失
     (那反而是最需要留痕的時候 —— 使用者正在納悶為什麼沒反應)。
     寫失敗只記 log:稽核不該反過來擋住業務。 */
  async recordSkips(
    tenantId: number,
    formId: number,
    recordId: number,
    actorId: number,
    result: SyncTriggerResult,
  ): Promise<void> {
    for (const sk of result.skipped) {
      try {
        await this.repo.recordRun({
          tenantId,
          triggerId: sk.triggerId,
          formId,
          recordId,
          actorId,
          outcome: "failed",
          detail: { reason: "引用的欄位已不存在", missingFields: sk.missingFields },
        })
      } catch (error) {
        this.logger.error(
          `trigger skip audit failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  /* `previous` 為 null 代表建立。回傳的 values 是**要寫進去的完整值**。 */
  async apply(
    tenantId: number,
    formId: number,
    incoming: RecordValues,
    previous: RecordValues | null,
    actorId: number,
    /* 🔴 表單**目前實際有的**欄位名。不能用 `Object.keys(values)` 代替 ——
       部分更新的 payload 不含所有欄位,那樣會把還在的欄位誤判為「不見了」。 */
    fieldNames: readonly string[] = [],
  ): Promise<SyncTriggerResult> {
    const triggers = await this.repo.listActiveSync(tenantId, formId, previous === null)
    if (triggers.length === 0) return noop(incoming)
    return this.run(triggers, incoming, previous, actorId, fieldNames)
  }

  /* 更新路徑專用:**前值只在真的有觸發器時才去讀**。

     🔴 不這樣做的話,每一次更新都要多一趟查詢去撈前值 —— 而絕大多數表單
     一條觸發器都沒有。把成本壓在「有設定的人」身上,不要讓所有人一起付。 */
  async applyUpdate(
    tenantId: number,
    formId: number,
    incoming: RecordValues,
    loadPrevious: () => Promise<RecordValues>,
    actorId: number,
    fieldNames: readonly string[] = [],
  ): Promise<SyncTriggerResult> {
    const triggers = await this.repo.listActiveSync(tenantId, formId, false)
    if (triggers.length === 0) return noop(incoming)
    return this.run(triggers, incoming, await loadPrevious(), actorId, fieldNames)
  }

  private run(
    triggers: readonly TriggerRow[],
    incoming: RecordValues,
    previous: RecordValues | null,
    actorId: number,
    fieldNames: readonly string[],
  ): SyncTriggerResult {
    const knownFields = new Set(fieldNames)
    const skipped: { triggerId: number; missingFields: string[] }[] = []
    const known = new Set(Object.keys({ ...previous, ...incoming }))
    let values: RecordValues = { ...previous, ...incoming }
    const ran: { triggerId: number; fields: string[] }[] = []

    for (const t of triggers) {
      if (!this.watchMatches(t, incoming, previous)) continue
      /* 🔴 條件對的是**已套用前面觸發器結果**的值,不是原始輸入。
         與條件式格式「由上而下、後者覆蓋」同一個心智模型 ——
         設計者按順序讀下來看到什麼,執行時就是什麼。 */
      if (t.conditions.length > 0 && !conditionsMatch(t.conditions, "and", values, known)) continue
      if (t.config.actionType !== "updateSelf") continue

      /* 🔴 FMEA T2|**引用的欄位不見了 → 跳過這一條,不要擋住存檔。**

         實測過的後果:掛了一條寫「狀態」的觸發器,之後把「狀態」欄下架
         (設計器那顆按鈕逐字「即時,不可復原」),該表**所有新增回 422
         `unknown field: 狀態`** —— 而訊息完全不提觸發器。一鍵把表寫死。

         這裡是**降級**那一層:一條壞掉的觸發器不該讓整張表存不了。
         另一層是在下架欄位時擋下並指名(好的體驗),但那只掛在刪除端點上,
         而繞過那一層的路徑會靜靜地沒有 —— 本 repo 已為同一形狀踩過索引與事件兩次。
         **保證要放在這裡。**

         ⚠️ 代價誠實記:跳過是**靜默**的。呼叫端拿到 `missingFields` 後寫執行紀錄,
         否則就變成「觸發器不動而沒有人知道為什麼」,那和擋住一樣糟。 */
      const missing = Object.keys(t.config.setFields).filter((f) => !knownFields.has(f))
      if (missing.length > 0) {
        skipped.push({ triggerId: t.id, missingFields: missing })
        continue
      }

      const patch = compileValues(t.config.setFields, values, actorId)
      values = { ...values, ...patch }
      ran.push({ triggerId: t.id, fields: Object.keys(patch) })
    }

    /* 只回**這次真的要寫**的欄位:把 `previous` 整包回傳的話,
       等於每次存檔都把所有欄位重寫一次,修改紀錄會變成滿江紅。 */
    const out: RecordValues = { ...incoming }
    const bypassFields = new Set<string>()
    for (const r of ran)
      for (const f of r.fields) {
        out[f] = values[f]
        bypassFields.add(f)
      }
    return { values: out, ran, bypassFields, skipped }
  }

  /* 「更新時」限定欄位(OQ-ET-5)。空 = 任何更新。

     🔴 用 `previous` 逐欄比對而不是「有沒有出現在 incoming 裡」——
     使用者按了存檔但那一欄沒真的改變時,`incoming` 仍然含有它。
     不比對的話「金額改變時」會在每次存檔都成立,那條件就白設了。 */
  private watchMatches(
    t: TriggerRow,
    incoming: RecordValues,
    previous: RecordValues | null,
  ): boolean {
    if (previous === null) return true
    if (t.watchFields.length === 0) return true
    return t.watchFields.some(
      (f) => f in incoming && !Object.is(normalize(incoming[f]), normalize(previous[f])),
    )
  }
}

/* 值比較的正規化。`null` 與 `undefined` 與空字串在表單語意上都是「沒填」,
   不當成同一件事的話,「清空一個本來就空的欄位」會被判定成變更。 */
function normalize(v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") return String(v)
  /* 🔴 `numeric` 讀回來是字串(`"50.0000000000"`)而寫進去是數字 ——
     本 repo 已因這件事讓批次還原靜默跳過整批儲存格。此處統一成字串再比,
     但**不能只做 String()**:`"50"` 與 `"50.0000000000"` 仍不相等 →
     兩邊都能轉成數字時比數值。 */
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return String(Number(v))
  return v
}
