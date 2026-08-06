import { Inject, Injectable } from "@nestjs/common"

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
   不是「有處理」。這也是 Salesforce before-save flow 與 after-save flow 分開的理由。

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

export interface SyncTriggerResult {
  readonly values: RecordValues
  /* 跑過的觸發器,供呼叫端寫執行紀錄 —— 本支不自己寫,因為它拿不到交易 */
  readonly ran: readonly { readonly triggerId: number; readonly fields: readonly string[] }[]
  /* 🔴 由觸發器設定的欄位。呼叫端據此豁免**欄位級寫入權限**(見 `assertWritable`)。
     只列觸發器真的動過的欄位 —— 回傳整份 values 的話,豁免範圍會擴大到
     使用者自己送上來的欄位,那就是真的權限漏洞。 */
  readonly bypassFields: ReadonlySet<string>
}

@Injectable()
export class TriggerSyncService {
  constructor(@Inject(TriggersRepository) private readonly repo: TriggersRepository) {}

  /* `previous` 為 null 代表建立。回傳的 values 是**要寫進去的完整值**。 */
  async apply(
    tenantId: number,
    formId: number,
    incoming: RecordValues,
    previous: RecordValues | null,
    actorId: number,
  ): Promise<SyncTriggerResult> {
    const triggers = await this.repo.listActiveSync(tenantId, formId, previous === null)
    if (triggers.length === 0) return { values: incoming, ran: [], bypassFields: EMPTY }
    return this.run(triggers, incoming, previous, actorId)
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
  ): Promise<SyncTriggerResult> {
    const triggers = await this.repo.listActiveSync(tenantId, formId, false)
    if (triggers.length === 0) return { values: incoming, ran: [], bypassFields: EMPTY }
    return this.run(triggers, incoming, await loadPrevious(), actorId)
  }

  private run(
    triggers: readonly TriggerRow[],
    incoming: RecordValues,
    previous: RecordValues | null,
    actorId: number,
  ): SyncTriggerResult {
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
    return { values: out, ran, bypassFields }
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
