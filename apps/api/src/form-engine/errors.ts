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

export class InvalidTypeConversionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      `conversion ${from} -> ${to} is not in the safe whitelist; create a new field and migrate data instead`,
    )
  }
}
