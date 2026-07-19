import { CharStreams, CommonTokenStream } from "antlr4ts"
import type { ANTLRErrorListener, Recognizer, Token } from "antlr4ts"
import type { ATNSimulator } from "antlr4ts/atn/ATNSimulator"
import { Formula } from "./vendor/teable/parser/Formula"
import type { RootContext } from "./vendor/teable/parser/Formula"
import { FormulaLexer } from "./vendor/teable/parser/FormulaLexer"

/* Weyver 公式解析入口(包 vendored Teable ANTLR parser;見 CLEANROOM.md)。
   解析成 AST 樹,不 eval;語法錯拋 typed FormulaSyntaxError。求值 / 型別推斷 / 依賴圖為後續 M。 */

export type FormulaAst = RootContext

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly column: number,
  ) {
    super(message)
    this.name = "FormulaSyntaxError"
  }
}

class CollectingErrorListener implements ANTLRErrorListener<Token> {
  readonly errors: FormulaSyntaxError[] = []

  syntaxError<T extends Token>(
    _recognizer: Recognizer<T, ATNSimulator>,
    _offendingSymbol: T | undefined,
    _line: number,
    charPositionInLine: number,
    msg: string,
  ): void {
    this.errors.push(new FormulaSyntaxError(msg, charPositionInLine))
  }
}

export function parseFormula(expression: string): FormulaAst {
  const listener = new CollectingErrorListener()
  const inputStream = CharStreams.fromString(expression)
  const lexer = new FormulaLexer(inputStream)
  lexer.removeErrorListeners()
  const tokenStream = new CommonTokenStream(lexer)
  const parser = new Formula(tokenStream)
  parser.removeErrorListeners()
  parser.addErrorListener(listener)

  const tree = parser.root()

  const first = listener.errors[0]
  if (first !== undefined) throw first
  return tree
}
