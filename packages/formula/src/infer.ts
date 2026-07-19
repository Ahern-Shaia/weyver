import { AbstractParseTreeVisitor } from "antlr4ts/tree/AbstractParseTreeVisitor"
import { functionReturnType } from "./functions"
import { parseFormula } from "./parse"
import type { FormulaType } from "./value"
import type {
  BinaryOpContext,
  BracketsContext,
  FieldReferenceCurlyContext,
  FunctionCallContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
  RootContext,
} from "./vendor/teable/parser/Formula"
import type { FormulaVisitor } from "./vendor/teable/parser/FormulaVisitor"

/* 靜態型別推斷:AST + 欄位型別解析器 → 結果型別。設計期即報型別,不待執行期。 */

export type FieldTypeResolver = (fieldName: string) => FormulaType

const ARITHMETIC = new Set(["+", "-", "*", "/", "%"])
const COMPARISON = new Set(["=", "!=", ">", "<", ">=", "<=", "&&", "||"])

function unwrapCurly(text: string): string {
  return text.slice(1, -1)
}

class TypeInferer
  extends AbstractParseTreeVisitor<FormulaType>
  implements FormulaVisitor<FormulaType>
{
  constructor(private readonly fieldType: FieldTypeResolver) {
    super()
  }

  protected defaultResult(): FormulaType {
    return "unknown"
  }

  visitRoot = (c: RootContext): FormulaType => this.visit(c.expr())
  visitBrackets = (c: BracketsContext): FormulaType => this.visit(c.expr())
  visitLeftWhitespaceOrComments = (c: LeftWhitespaceOrCommentsContext): FormulaType =>
    this.visit(c.expr())
  visitRightWhitespaceOrComments = (c: RightWhitespaceOrCommentsContext): FormulaType =>
    this.visit(c.expr())
  visitIntegerLiteral = (): FormulaType => "number"
  visitDecimalLiteral = (): FormulaType => "number"
  visitStringLiteral = (): FormulaType => "text"
  visitBooleanLiteral = (): FormulaType => "boolean"
  visitUnaryOp = (): FormulaType => "number"
  visitFieldReferenceCurly = (c: FieldReferenceCurlyContext): FormulaType =>
    this.fieldType(unwrapCurly(c.field_reference_curly().text))

  visitBinaryOp = (c: BinaryOpContext): FormulaType => {
    const op = c._op.text ?? ""
    if (op === "&") return "text"
    if (ARITHMETIC.has(op)) return "number"
    if (COMPARISON.has(op)) return "boolean"
    return "unknown"
  }

  visitFunctionCall = (c: FunctionCallContext): FormulaType => {
    const name = c.func_name().text
    // IF:回傳分支型別(取 then 支)
    if (name.toUpperCase() === "IF") {
      const then = c.expr(1)
      return then === undefined ? "unknown" : this.visit(then)
    }
    return functionReturnType(name) ?? "unknown"
  }
}

export function inferAstType(ast: RootContext, fieldType: FieldTypeResolver): FormulaType {
  return new TypeInferer(fieldType).visit(ast)
}

export function inferFormulaType(expression: string, fieldType: FieldTypeResolver): FormulaType {
  return inferAstType(parseFormula(expression), fieldType)
}
