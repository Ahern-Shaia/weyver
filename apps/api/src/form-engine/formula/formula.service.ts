import {
  collectAstReferences,
  type FormulaAst,
  FormulaSyntaxError,
  type FormulaType,
  inferAstType,
  parseFormula,
} from "@weyver/formula"
import { Inject, Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../../db/db.module.js"
import { formulaDefs } from "../../db/schema.js"
import {
  FieldNotFoundError,
  FormulaDefinitionError,
  FormulaReferenceError,
  FormulaSelfReferenceError,
} from "../errors.js"
import { MetadataService } from "../metadata/metadata.service.js"

/* cellValueType(語意軸)→ 公式結果型別。未列者(link/attachment/formula/member/multiSelect)= unknown。 */
const NUMBER_TYPES = new Set(["number", "money", "percent", "rating"])
const TEXT_TYPES = new Set([
  "text",
  "longText",
  "email",
  "url",
  "phone",
  "singleSelect",
  "autoNumber",
])

function toFormulaType(cellValueType: string): FormulaType {
  if (NUMBER_TYPES.has(cellValueType)) return "number"
  if (cellValueType === "date" || cellValueType === "dateTime") return "date"
  if (cellValueType === "checkbox") return "boolean"
  if (TEXT_TYPES.has(cellValueType)) return "text"
  return "unknown"
}

export interface FormulaDefinition {
  readonly fieldId: number
  readonly resultType: FormulaType
  readonly dependsOn: readonly number[]
}

/* A1|公式定義(metadata 車道 DRIZZLE):parse → 收集參照 → 名稱解析成 field id(穩定於改名)
   → 型別推斷 → 存 formula_def。unknown 參照 / 自我參照 / 語法錯 皆設計期擋。依賴圖重算為 M2。 */
@Injectable()
export class FormulaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  async defineFormula(
    tenantId: number,
    formId: number,
    fieldId: number,
    exprSource: string,
  ): Promise<FormulaDefinition> {
    const { fields } = await this.metadata.getForm(tenantId, formId)
    if (!fields.some((f) => f.id === fieldId)) throw new FieldNotFoundError(fieldId)

    let ast: FormulaAst
    try {
      ast = parseFormula(exprSource)
    } catch (error) {
      if (error instanceof FormulaSyntaxError) throw new FormulaDefinitionError(error.message)
      throw error
    }

    const byName = new Map(fields.map((f) => [f.name, f]))
    const dependsOn: number[] = []
    for (const name of collectAstReferences(ast)) {
      const ref = byName.get(name)
      if (ref === undefined) throw new FormulaReferenceError(name)
      if (ref.id === fieldId) throw new FormulaSelfReferenceError(name)
      dependsOn.push(ref.id)
    }

    const resultType = inferAstType(ast, (name) => {
      const f = byName.get(name)
      return f === undefined ? "unknown" : toFormulaType(f.cellValueType)
    })

    await this.db
      .insert(formulaDefs)
      .values({ tenantId, formId, fieldId, exprSource, resultType, dependsOn })
      .onConflictDoUpdate({
        target: formulaDefs.fieldId,
        set: { exprSource, resultType, dependsOn, updatedAt: sql`now()` },
      })

    return { fieldId, resultType, dependsOn }
  }
}
