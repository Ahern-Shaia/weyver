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

export class InvalidTypeConversionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      `conversion ${from} -> ${to} is not in the safe whitelist; create a new field and migrate data instead`,
    )
  }
}
