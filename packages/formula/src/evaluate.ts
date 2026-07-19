import { AbstractParseTreeVisitor } from "antlr4ts/tree/AbstractParseTreeVisitor"
import { callFunction } from "./functions"
import { parseFormula } from "./parse"
import type { FormulaValue } from "./value"
import {
  compareValue,
  Decimal,
  equalsValue,
  FormulaEvalError,
  toBool,
  toDecimal,
  toText,
} from "./value"
import type {
  BinaryOpContext,
  BooleanLiteralContext,
  BracketsContext,
  DecimalLiteralContext,
  ExprContext,
  FieldReferenceCurlyContext,
  FunctionCallContext,
  IntegerLiteralContext,
  LeftWhitespaceOrCommentsContext,
  RightWhitespaceOrCommentsContext,
  RootContext,
  StringLiteralContext,
  UnaryOpContext,
} from "./vendor/teable/parser/Formula"
import type { FormulaVisitor } from "./vendor/teable/parser/FormulaVisitor"

/* 求值器:AST + 欄位解析器 → FormulaValue。純樹走訪,無 eval。金額走 Decimal。 */

export type FieldResolver = (fieldName: string) => FormulaValue

function unwrapCurly(text: string): string {
  return text.slice(1, -1) // {name} → name
}

function unquote(text: string): string {
  return text.slice(1, -1).replace(/\\(.)/g, "$1") // 去頭尾引號 + 反斜線轉義
}

function applyBinaryOp(op: string, l: FormulaValue, r: FormulaValue): FormulaValue {
  switch (op) {
    case "+":
      return toDecimal(l).plus(toDecimal(r))
    case "-":
      return toDecimal(l).minus(toDecimal(r))
    case "*":
      return toDecimal(l).times(toDecimal(r))
    case "/": {
      const d = toDecimal(r)
      if (d.isZero()) throw new FormulaEvalError("除以零")
      return toDecimal(l).div(d)
    }
    case "%":
      return toDecimal(l).mod(toDecimal(r))
    case "&":
      return toText(l) + toText(r)
    case "=":
      return equalsValue(l, r)
    case "!=":
      return !equalsValue(l, r)
    case ">":
      return compareValue(l, r) > 0
    case "<":
      return compareValue(l, r) < 0
    case ">=":
      return compareValue(l, r) >= 0
    case "<=":
      return compareValue(l, r) <= 0
    case "&&":
      return toBool(l) && toBool(r)
    case "||":
      return toBool(l) || toBool(r)
    default:
      throw new FormulaEvalError(`未支援運算子:${op}`)
  }
}

class Evaluator
  extends AbstractParseTreeVisitor<FormulaValue>
  implements FormulaVisitor<FormulaValue>
{
  constructor(private readonly resolve: FieldResolver) {
    super()
  }

  protected defaultResult(): FormulaValue {
    return null
  }

  visitRoot = (c: RootContext): FormulaValue => this.visit(c.expr())
  visitBrackets = (c: BracketsContext): FormulaValue => this.visit(c.expr())
  visitLeftWhitespaceOrComments = (c: LeftWhitespaceOrCommentsContext): FormulaValue =>
    this.visit(c.expr())
  visitRightWhitespaceOrComments = (c: RightWhitespaceOrCommentsContext): FormulaValue =>
    this.visit(c.expr())
  visitIntegerLiteral = (c: IntegerLiteralContext): FormulaValue => new Decimal(c.text)
  visitDecimalLiteral = (c: DecimalLiteralContext): FormulaValue => new Decimal(c.text)
  visitStringLiteral = (c: StringLiteralContext): FormulaValue => unquote(c.text)
  visitBooleanLiteral = (c: BooleanLiteralContext): FormulaValue => /^true$/i.test(c.text)
  visitFieldReferenceCurly = (c: FieldReferenceCurlyContext): FormulaValue =>
    this.resolve(unwrapCurly(c.field_reference_curly().text))
  visitUnaryOp = (c: UnaryOpContext): FormulaValue => toDecimal(this.visit(c.expr())).neg()
  visitBinaryOp = (c: BinaryOpContext): FormulaValue =>
    applyBinaryOp(c._op.text ?? "", this.visit(c.expr(0)), this.visit(c.expr(1)))
  visitFunctionCall = (c: FunctionCallContext): FormulaValue =>
    callFunction(
      c.func_name().text,
      c.expr().map((e: ExprContext): FormulaValue => this.visit(e)),
    )
}

export function evaluateAst(ast: RootContext, resolve: FieldResolver): FormulaValue {
  return new Evaluator(resolve).visit(ast)
}

export function evaluateFormula(expression: string, resolve: FieldResolver): FormulaValue {
  return evaluateAst(parseFormula(expression), resolve)
}
