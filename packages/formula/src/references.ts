import { AbstractParseTreeVisitor } from "antlr4ts/tree/AbstractParseTreeVisitor"
import { parseFormula } from "./parse"
import type { FieldReferenceCurlyContext, RootContext } from "./vendor/teable/parser/Formula"
import type { FormulaVisitor } from "./vendor/teable/parser/FormulaVisitor"

/* 欄位參照收集器:抽出公式引用的所有 {欄名}(depends_on 之來源;M2 依賴圖用)。
   只覆寫 field-reference 節點,其餘走 AbstractParseTreeVisitor 預設遞迴(visitChildren)。 */

function unwrapCurly(text: string): string {
  return text.slice(1, -1)
}

class ReferenceCollector extends AbstractParseTreeVisitor<void> implements FormulaVisitor<void> {
  readonly names = new Set<string>()

  protected defaultResult(): void {
    // void 訪問器,無聚合結果
  }

  visitFieldReferenceCurly = (c: FieldReferenceCurlyContext): void => {
    this.names.add(unwrapCurly(c.field_reference_curly().text))
  }
}

/* 保序去重(依首次出現順序)*/
export function collectAstReferences(ast: RootContext): string[] {
  const collector = new ReferenceCollector()
  collector.visit(ast)
  return [...collector.names]
}

export function collectFormulaReferences(expression: string): string[] {
  return collectAstReferences(parseFormula(expression))
}
