import { randomUUID } from "node:crypto"
import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common"
import type { FastifyReply } from "fastify"
import { ZodError } from "zod"
import {
  BulkRowError,
  BulkTooLargeError,
  BulkValidationError,
  DomainError,
  FieldForbiddenError,
  FieldNotFoundError,
  FieldValueError,
  FormNotFoundError,
  FormNotPendingError,
  FormNotReadyError,
  InvalidFilterError,
  ImportBlockedError,
  ImportPlanStaleError,
  InvalidTypeConversionError,
  LayoutVersionConflictError,
  OptionInUseError,
  OptionRenameConflictError,
  RecordNotFoundError,
  RequiredFieldError,
  SystemManagedFieldError,
  UnknownFieldError,
  VersionConflictError,
} from "../form-engine/errors.js"
import { IdentifierError } from "../form-engine/identifiers.js"

interface ErrorEnvelope {
  readonly code: string
  readonly message: string
  readonly correlationId: string
  readonly timestamp: string
  /* 結構化細節。目前僅批次匯入預檢用(逐列失敗清單)——
     讓使用者一次看到全部問題列而非來回試。**不得放敏感資訊**。 */
  readonly details?: readonly { rowIndex: number; reason: string }[]
}

/* 匯出供冪等攔截器共用 —— 兩處若各自映射會漂移,導致「回放的錯誤碼」與
   「實際回應的錯誤碼」不一致。 */
export function mapDomainError(error: DomainError): { status: number; code: string } {
  if (error instanceof FormNotFoundError || error instanceof FieldNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, code: "FORM_NOT_FOUND" }
  }
  if (error instanceof RecordNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, code: "RECORD_NOT_FOUND" }
  }
  if (error instanceof VersionConflictError) {
    return { status: HttpStatus.CONFLICT, code: "VERSION_CONFLICT" }
  }
  if (error instanceof LayoutVersionConflictError) {
    return { status: HttpStatus.CONFLICT, code: "LAYOUT_VERSION_CONFLICT" }
  }
  if (error instanceof FieldForbiddenError) {
    return { status: HttpStatus.FORBIDDEN, code: "FORBIDDEN" }
  }
  if (error instanceof FormNotPendingError || error instanceof FormNotReadyError) {
    return { status: HttpStatus.CONFLICT, code: "FORM_STATE_CONFLICT" }
  }
  if (error instanceof InvalidTypeConversionError) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: "UNSAFE_TYPE_CONVERSION" }
  }
  if (error instanceof ImportPlanStaleError || error instanceof ImportBlockedError) {
    return { status: HttpStatus.CONFLICT, code: "IMPORT_BLOCKED" }
  }
  if (error instanceof OptionRenameConflictError) {
    return { status: HttpStatus.CONFLICT, code: "OPTION_RENAME_CONFLICT" }
  }
  if (error instanceof OptionInUseError) {
    return { status: HttpStatus.CONFLICT, code: "OPTION_IN_USE" }
  }
  if (
    error instanceof RequiredFieldError ||
    error instanceof FieldValueError ||
    error instanceof UnknownFieldError ||
    error instanceof SystemManagedFieldError ||
    error instanceof InvalidFilterError ||
    error instanceof BulkRowError
  ) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: "INVALID_FIELD_INPUT" }
  }
  if (error instanceof BulkValidationError) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: "BULK_VALIDATION_FAILED" }
  }
  if (error instanceof BulkTooLargeError) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: "BULK_TOO_LARGE" }
  }
  return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: "DOMAIN_ERROR" }
}

/* 統一錯誤信封(AGENTS 橫切鐵則):code / message / correlationId / timestamp;
   絕不回傳 stack trace / DB 錯誤原文(docs/22 禁令 8)。 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>()
    const correlationId = randomUUID()
    const timestamp = new Date().toISOString()

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR
    let code = "INTERNAL_ERROR"
    let message = "internal error"

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === "string") {
        message = body
      } else {
        const record = body as { code?: string; message?: string | string[] }
        code = record.code ?? exception.constructor.name.replace(/Exception$/, "").toUpperCase()
        message = Array.isArray(record.message)
          ? record.message.join("; ")
          : (record.message ?? exception.message)
      }
    } else if (exception instanceof IdentifierError || exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST
      code = "VALIDATION_FAILED"
      message = exception instanceof ZodError ? "invalid request shape" : "invalid identifier"
    } else if (exception instanceof DomainError) {
      const mapped = mapDomainError(exception)
      status = mapped.status
      code = mapped.code
      message = exception.message
    } else {
      // 未預期錯誤:log 全文(含 stack),對外只回 correlationId
      console.error(`[${correlationId}]`, exception)
    }

    const envelope: ErrorEnvelope = {
      code,
      message,
      correlationId,
      timestamp,
      ...(exception instanceof BulkValidationError ? { details: exception.failures } : {}),
    }
    void reply.status(status).send(envelope)
  }
}
