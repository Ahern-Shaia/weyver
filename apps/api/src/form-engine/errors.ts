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
