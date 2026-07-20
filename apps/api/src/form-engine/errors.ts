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
