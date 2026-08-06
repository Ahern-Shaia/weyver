import { Inject, Injectable } from "@nestjs/common"
import {
  type FormulaAst,
  type FormulaNode,
  FormulaSyntaxError,
  type FormulaType,
  type FormulaValue,
  collectAstReferences,
  detectCycle,
  evaluateFormula,
  evaluationOrder,
  inferAstType,
  parseFormula,
} from "@weyver/formula"
import { and, eq, sql } from "drizzle-orm"
import { TenantDb } from "../../db/db.module.js"
import { formulaDefs } from "../../db/schema.js"
import {
  FieldNotFoundError,
  FormulaCycleError,
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

/* 原始記錄值 → 公式值(布林保留;其餘轉字串,求值器再依運算子強制轉 Decimal 等)*/
function toFormulaValue(raw: unknown): FormulaValue {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "boolean") return raw
  return String(raw)
}

function parseDeps(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.filter((x): x is number => typeof x === "number") : []
}

export interface FormulaDefinition {
  readonly fieldId: number
  readonly resultType: FormulaType
  readonly dependsOn: readonly number[]
}

interface StoredDef {
  readonly fieldId: number
  readonly exprSource: string
  readonly dependsOn: number[]
}

/* 公式引擎(P0-3):定義(parse / 依賴解析 / 型別推斷 / 循環偵測)+ 讀時重算(拓樸序)。
   metadata 車道 DRIZZLE;依賴 depends_on 存 field id(穩定於改名)。物化 / 背景重算為後續優化(OQ-FML-8)。 */
@Injectable()
export class FormulaService {
  constructor(
    // F-6 M3:formula_def 為 RLS 表 → 走 app 車道 + tenant GUC
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(MetadataService) private readonly metadata: MetadataService,
  ) {}

  private async loadDefs(tenantId: number, formId: number): Promise<StoredDef[]> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(formulaDefs)
        .where(and(eq(formulaDefs.tenantId, tenantId), eq(formulaDefs.formId, formId))),
    )
    return rows.map((r) => ({
      fieldId: r.fieldId,
      exprSource: r.exprSource,
      dependsOn: parseDeps(r.dependsOn),
    }))
  }

  /* 🔴 公式欄的**污染傳遞**(authz 旁路清單第 4 項,對照 **CVE-2019-11780** ——
     Odoo 可經 non-stored computed field 繞過存取權)。

     問題形狀:讀取路徑是「先算公式,再遮罩隱藏欄」。遮罩刪掉的是**隱藏欄自己的值**,
     而公式欄是**另一個欄**,它不會被刪 —— 但它的值是用隱藏欄算出來的。
     例:`成本` 對業務隱藏,而 `毛利 = 售價 - 成本` 沒隱藏 →
     業務看得到毛利與售價,**兩個一減就得到成本**。遮了等於沒遮。

     ⚠️ **要傳遞閉包,不能只看一層**:`A = B * 2`、`B = 隱藏欄 + 1` ——
     A 沒有直接引用隱藏欄,但一樣洩漏。

     ⚠️ **不改成「把隱藏欄當 0 去算」** —— 那會讓使用者看到一個**看起來正常但錯的數字**,
     比看不到更糟(同 `pivot-and-charts` 的裁定:寧可具名不可用,不要靜默給錯的值)。 */
  async fieldsTaintedByHidden(
    tenantId: number,
    formId: number,
    hiddenFieldIds: ReadonlySet<number>,
  ): Promise<Set<number>> {
    const tainted = new Set<number>()
    if (hiddenFieldIds.size === 0) return tainted
    const defs = await this.loadDefs(tenantId, formId)
    if (defs.length === 0) return tainted

    /* 反覆掃到不動點 —— 公式數量是設計期常數(個位到數十),不值得為它建圖 */
    let changed = true
    while (changed) {
      changed = false
      for (const d of defs) {
        if (tainted.has(d.fieldId)) continue
        if (d.dependsOn.some((id) => hiddenFieldIds.has(id) || tainted.has(id))) {
          tainted.add(d.fieldId)
          changed = true
        }
      }
    }
    return tainted
  }

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

    // 循環偵測:既有定義(去掉本欄舊版)+ 本候選 → Tarjan SCC(HyperFormula 式)
    const existing = await this.loadDefs(tenantId, formId)
    const nodes: FormulaNode[] = existing
      .filter((d) => d.fieldId !== fieldId)
      .map((d) => ({ fieldId: d.fieldId, dependsOn: d.dependsOn }))
    nodes.push({ fieldId, dependsOn })
    const cycle = detectCycle(nodes)
    if (cycle !== null) {
      const idToName = new Map(fields.map((f) => [f.id, f.name]))
      throw new FormulaCycleError(cycle.map((id) => idToName.get(id) ?? `#${id}`))
    }

    const resultType = inferAstType(ast, (name) => {
      const f = byName.get(name)
      return f === undefined ? "unknown" : toFormulaType(f.cellValueType)
    })

    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .insert(formulaDefs)
        .values({ tenantId, formId, fieldId, exprSource, resultType, dependsOn })
        .onConflictDoUpdate({
          target: formulaDefs.fieldId,
          set: { exprSource, resultType, dependsOn, updatedAt: sql`now()` },
        }),
    )

    return { fieldId, resultType, dependsOn }
  }

  /* 讀時重算(M2 核心;讀時算模式):給一筆記錄原始值 → 依拓樸序算出所有公式欄值(鏈式正確)。
     回傳以「公式欄名 → 值」。物化 / 背景 / bulk 模式為後續優化。 */
  async computeRecord(
    tenantId: number,
    formId: number,
    rawValues: Record<string, unknown>,
  ): Promise<Record<string, FormulaValue>> {
    const { fields } = await this.metadata.getForm(tenantId, formId)
    const defs = await this.loadDefs(tenantId, formId)
    if (defs.length === 0) return {}

    const byName = new Map(fields.map((f) => [f.name, f]))
    const nameById = new Map(fields.map((f) => [f.id, f.name]))
    const defByField = new Map(defs.map((d) => [d.fieldId, d]))
    const order = evaluationOrder(defs.map((d) => ({ fieldId: d.fieldId, dependsOn: d.dependsOn })))

    const computed = new Map<number, FormulaValue>()
    const resolve = (name: string): FormulaValue => {
      const field = byName.get(name)
      if (field === undefined) return null
      const memo = computed.get(field.id)
      if (memo !== undefined) return memo
      return toFormulaValue(rawValues[name])
    }

    for (const fieldId of order) {
      const def = defByField.get(fieldId)
      if (def === undefined) continue
      computed.set(fieldId, evaluateFormula(def.exprSource, resolve))
    }

    const out: Record<string, FormulaValue> = {}
    for (const [fieldId, value] of computed) {
      const name = nameById.get(fieldId)
      if (name !== undefined) out[name] = value
    }
    return out
  }
}
