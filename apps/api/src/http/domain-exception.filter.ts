import { randomUUID } from "node:crypto"
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common"
import type { FastifyReply } from "fastify"
import { ZodError } from "zod"
import {
  BulkRowError,
  BulkTooLargeError,
  BulkValidationError,
  DeliveryContentPrunedError,
  DeliveryNotFoundError,
  DomainError,
  FieldBudgetExhaustedError,
  FieldForbiddenError,
  FieldNotFoundError,
  FieldValueError,
  FormNotFoundError,
  FormNotPendingError,
  FormNotReadyError,
  ImportBlockedError,
  ImportPlanStaleError,
  InvalidFilterError,
  InvalidTypeConversionError,
  LayoutVersionConflictError,
  OptionInUseError,
  OptionRenameConflictError,
  RecordApprovalLockedError,
  RecordNotFoundError,
  RequiredFieldError,
  SaveNeedsConfirmationError,
  SearchTimeoutError,
  SystemManagedFieldError,
  UnknownFieldError,
  VersionConflictError,
} from "../form-engine/errors.js"
import { IdentifierError } from "../form-engine/identifiers.js"
import { SsrfBlockedError } from "./ssrf-guard.js"

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
  if (error instanceof DeliveryNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, code: "DELIVERY_NOT_FOUND" }
  }
  /* 內容已過保留期被清除 —— 這不是請求錯,是資源的狀態不允許這個動作 */
  if (error instanceof DeliveryContentPrunedError) {
    return { status: HttpStatus.GONE, code: "DELIVERY_CONTENT_PRUNED" }
  }
  if (error instanceof SsrfBlockedError) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: "TARGET_NOT_ALLOWED" }
  }
  if (error instanceof RecordApprovalLockedError) {
    return { status: HttpStatus.CONFLICT, code: "APPROVAL_LOCKED" }
  }
  /* 🔴 C-6 A|需要確認不是「你錯了」,是「狀態需要人看一眼」→ 409 而非 422 */
  if (error instanceof SaveNeedsConfirmationError) {
    return { status: HttpStatus.CONFLICT, code: "NEEDS_CONFIRMATION" }
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
  /* 逾時不是伺服器壞掉(服務仍在),也不是請求格式錯 —— 是這句查詢對現在的資料量
     太貴。使用者做得了的事是「把關鍵字更具體」,故走「語意上處理不了」這一類。 */
  if (error instanceof SearchTimeoutError) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: "SEARCH_TIMEOUT" }
  }
  if (error instanceof FieldBudgetExhaustedError) {
    return { status: HttpStatus.CONFLICT, code: "FIELD_BUDGET_EXHAUSTED" }
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
