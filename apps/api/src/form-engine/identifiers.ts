/* OQ-FEC-1 = A:物理 identifier 全系統生成,使用者輸入永不進入 identifier 位置。
   DB 端另有 generated column('t'||id)為權威;此處為 app 端鏡像 + 斷言雙保險。 */

export const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/

export const DATA_SCHEMA = "data"

export class IdentifierError extends Error {}

function assertIdentifier(value: string): string {
  if (!IDENTIFIER_RE.test(value)) {
    throw new IdentifierError(`illegal identifier: ${JSON.stringify(value)}`)
  }
  return value
}

export function physicalTableName(formId: number): string {
  if (!Number.isSafeInteger(formId) || formId <= 0) {
    throw new IdentifierError(`illegal formId: ${String(formId)}`)
  }
  return assertIdentifier(`t${formId}`)
}

export function physicalColumnName(fieldId: number): string {
  if (!Number.isSafeInteger(fieldId) || fieldId <= 0) {
    throw new IdentifierError(`illegal fieldId: ${String(fieldId)}`)
  }
  return assertIdentifier(`f${fieldId}`)
}
