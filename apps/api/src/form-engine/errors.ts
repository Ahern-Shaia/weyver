/* domain error 階層(AGENTS:只 throw Error 子類;預期失敗由 filter 映射 HTTP) */

export class DomainError extends Error {}

export class FormNotFoundError extends DomainError {
  constructor(formId: number) {
    super(`form ${formId} not found`)
  }
}

export class FieldNotFoundError extends DomainError {
  constructor(fieldId: number) {
    super(`field ${fieldId} not found`)
  }
}

export class FormNotPendingError extends DomainError {
  constructor(formId: number, state: string) {
    super(`form ${formId} is ${state}, expected pending`)
  }
}

export class FormNotReadyError extends DomainError {
  constructor(formId: number, state: string) {
    super(`form ${formId} is ${state}, expected ready`)
  }
}

export class RecordNotFoundError extends DomainError {
  constructor(recordId: number) {
    super(`record ${recordId} not found`)
  }
}

export class VersionConflictError extends DomainError {
  constructor(recordId: number, expected: number) {
    super(`record ${recordId} version conflict (expected ${expected}); reload and retry`)
  }
}

export class UnknownFieldError extends DomainError {
  constructor(name: string) {
    super(`unknown field: ${name}`)
  }
}

export class SystemManagedFieldError extends DomainError {
  constructor(name: string) {
    super(`field ${name} is system managed and cannot be written`)
  }
}

/* P0-4a M4|欄位級授權:寫入無 write 權的欄(擋每角色動態 mass-assignment)→ 映射 403 */
export class FieldForbiddenError extends DomainError {
  constructor(name: string) {
    super(`field ${name} is not writable by this role`)
  }
}

export class RequiredFieldError extends DomainError {
  constructor(name: string) {
    super(`field ${name} is required`)
  }
}

export class FieldValueError extends DomainError {
  constructor(name: string, detail: string) {
    super(`invalid value for field ${name}: ${detail}`)
  }
}

export class InvalidFilterError extends DomainError {
  constructor(detail: string) {
    super(`invalid filter: ${detail}`)
  }
}

/* bulk 匯入:某列失敗 → 整批 rollback,回失敗列 index(0-based)+ 原因 */
/* 🔴 批次匯入預檢:**一次回報全部問題列**。

   原本第一列出錯即拋,使用者匯 5000 列有 30 個錯就要來回試 30 次 ——
   業界(Salesforce Data Loader 產 success/error 兩份 CSV、Ragic 逐列處理可跳過)
   一律一次回報完整清單。 */
export class BulkValidationError extends DomainError {
  constructor(readonly failures: readonly { rowIndex: number; reason: string }[]) {
    super(`${failures.length} 列未通過檢查`)
  }
}

export class BulkRowError extends DomainError {
  constructor(
    readonly rowIndex: number,
    readonly reason: string,
  ) {
    super(`row ${rowIndex}: ${reason}`)
  }
}

/* 🔴 R1·FTP v1.7|把遮罩值寫回去 = 用一串點蓋掉真值。拒絕,並講清楚要重新輸入。 */
export class MaskedValueWriteError extends DomainError {
  constructor(fieldName: string) {
    super(`「${fieldName}」是遮罩欄位,顯示的不是真值。要修改請重新輸入完整內容`)
  }
}

/* 🔴 R1·C-6 A|軟性驗證:條件成立 → **退回一次並附警告**,確認後再送才過。

   ⚠️ 這**不是驗證失敗**,是「請先看一眼」。故:
   - 錯誤要**帶得出警告內容**(不然前端只能顯示「儲存失敗」,使用者完全不知道要確認什麼)
   - 狀態碼用 **409 Conflict** 而不是 422 —— 422 的語意是「你送的東西有問題」,
     而這裡送的東西沒問題,只是**狀態需要人確認**。同 `VersionConflictError` 的用法。 */
export class SaveNeedsConfirmationError extends DomainError {
  constructor(readonly warnings: readonly string[]) {
    super(warnings.join(" / "))
  }
}

/* R1·H-4 v1.2|批次還原(`docs/modules/R1/record-revisions.md` §7) */
export class BatchNotFoundError extends DomainError {
  constructor(batchId: number) {
    super(`找不到批次 #${String(batchId)}`)
  }
}

/* 訊息由呼叫端給 —— 不能還原的理由有好幾種(已還原過 / 是還原動作本身),
   而使用者要看的是哪一種,不是一句共用的「不能還原」。 */
export class BatchNotUndoableError extends DomainError {}

export class BulkTooLargeError extends DomainError {
  constructor(limit: number) {
    super(`too many rows in one request; max ${limit}`)
  }
}

/* 改名目標撞到本次未被改名的既有選項 = 合併語意。默默合併會讓兩組資料再也分不開,
   故要求呼叫端明示,不自作主張。 */
export class OptionRenameConflictError extends DomainError {
  constructor(from: string, to: string) {
    super(`選項「${from}」不能改名為「${to}」:已有同名選項。若要合併請改用取代刪除`)
  }
}

export class OptionInUseError extends DomainError {
  constructor(name: string, count: number) {
    super(`選項「${name}」仍有 ${String(count)} 筆記錄使用中,需指定停用 / 取代 / 清空`)
  }
}

/* 🔴 PG 的 1600 欄是**一張表一生的加總上限**,不是同時存在的上限 ——
   attnum 永不回收(本機實測:30 次 add/drop 後 `VACUUM FULL`,`max(attnum)` 仍是 31;
   PG 核心開發者於 pgsql-hackers 明言「We just never recycle attnums」)。

   既有的 `maxFieldsPerForm` 配額只數**活著的**欄位,所以一張反覆加欄刪欄的表
   可以永遠通過配額,卻在某一天撞上 PG 的硬牆 —— 而那時使用者看到的會是
   「tables can have at most 1600 columns」這種對他毫無意義的訊息。
   在還有餘裕時先擋下來,並講清楚出路。 */
export class FieldBudgetExhaustedError extends DomainError {
  constructor(used: number, limit: number) {
    super(
      `這張表單一生可新增的欄位數即將用盡(已用 ${String(used)} / ${String(limit)})。資料庫不會因為刪除欄位而回收這個額度,所以需要以「複製到新表單」的方式重建才能繼續加欄。`,
    )
  }
}

export class DeliveryNotFoundError extends DomainError {
  constructor(id: number) {
    super(`找不到投遞紀錄 #${String(id)}`)
  }
}

/* 保留期到了之後,載荷內容會被清掉但列留著(內控要答得出「有沒有送出去」)。
   此時重送會送出一份空載荷且回 200 —— 對消費端就是一筆內容突然變空的事件。
   明白地擋下來,比讓它「成功」好。 */
export class DeliveryContentPrunedError extends DomainError {
  constructor(id: number) {
    super(
      `投遞紀錄 #${String(id)} 的內容已超過保留期被清除,無法重送。若仍需送出,請重新觸發該筆資料的變更。`,
    )
  }
}

/* 搜尋逾時。這不是壞掉,是這句查詢對現在的資料量太貴了 ——
   所以訊息要給使用者做得了的事,而不是「請稍後再試」(再試一次還是一樣慢)。 */
export class SearchTimeoutError extends DomainError {
  constructor() {
    super("搜尋花的時間太長了,請把關鍵字打長一點或更具體一些。")
  }
}

export class InvalidTypeConversionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      `conversion ${from} -> ${to} is not in the safe whitelist; create a new field and migrate data instead`,
    )
  }
}

/* P0-3 公式定義期錯誤 */
export class FormulaDefinitionError extends DomainError {
  constructor(detail: string) {
    super(`公式語法錯誤:${detail}`)
  }
}

export class FormulaReferenceError extends DomainError {
  constructor(name: string) {
    super(`公式參照不存在的欄位:${name}`)
  }
}

export class FormulaSelfReferenceError extends DomainError {
  constructor(name: string) {
    super(`公式不可參照自身:${name}`)
  }
}

export class FormulaCycleError extends DomainError {
  constructor(names: readonly string[]) {
    super(`公式循環依賴:${names.join(" → ")}`)
  }
}

/* P0-3 Link&Load */
export class NotALinkFieldError extends DomainError {
  constructor(name: string) {
    super(`欄位 ${name} 不是關聯(link)欄位`)
  }
}

/* 匯入的 plan 與 commit 之間,檔案或設定被改過 —— 使用者看到的預覽與即將執行的
   不是同一件事。這是「所見即所得」的最後一道保險。 */
export class ImportPlanStaleError extends DomainError {
  constructor() {
    super("匯入設定或檔案已變更,請重新預覽後再提交")
  }
}

export class ImportBlockedError extends DomainError {
  constructor(reason: string) {
    super(`匯入被擋下:${reason}`)
  }
}

/* 版面是整表覆寫,兩人同改後寫者會蓋掉整張版面。錯誤要帶出「目前是第幾版」,
   否則前端只能叫使用者重整,無法說明「你看到的已經不是最新的」。 */
export class LayoutVersionConflictError extends DomainError {
  constructor(
    readonly expected: number,
    readonly current: number,
  ) {
    super(
      `版面已被其他人修改(你的版本 ${String(expected)},目前 ${String(current)}),請重新載入後再存`,
    )
  }
}

/* 簽核中 / 已核准的記錄不得硬刪(AGENTS 鐵則 4:過帳後不可刪改)。
   保留期到期的排程 purge 也走同一條線 —— 逾期不是硬刪已核准單據的理由。 */
export class RecordApprovalLockedError extends DomainError {
  constructor(readonly recordId: number) {
    super(`記錄 ${String(recordId)} 有簽核紀錄,不得永久刪除`)
  }
}
