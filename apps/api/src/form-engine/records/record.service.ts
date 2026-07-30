import { Inject, Injectable, Optional } from "@nestjs/common"
import { Decimal } from "@weyver/formula"
import type { Knex } from "knex"
import { z } from "zod"
import type { FieldAccessPolicy } from "../../authz/authz-effective.js"
import { APP_KNEX } from "../../db/db.module.js"
import { FilesService } from "../../files/files.service.js"
import { QuotaService } from "../../reliability/quota.service.js"
import {
  BulkRowError,
  BulkTooLargeError,
  BulkValidationError,
  DomainError,
  FieldForbiddenError,
  FieldValueError,
  FormNotReadyError,
  InvalidFilterError,
  RecordNotFoundError,
  RequiredFieldError,
  SystemManagedFieldError,
  UnknownFieldError,
  VersionConflictError,
} from "../errors.js"
import {
  type CellValueType,
  fieldType,
  isSnapshotLookup,
} from "../field-types/field-type-registry.js"
import { FormulaService } from "../formula/formula.service.js"
import { DATA_SCHEMA, physicalColumnName, physicalTableName, sequenceName } from "../identifiers.js"
import { defaultNeedsUserName, resolveDefaultValue } from "../layout/default-value.js"
import { type Layout, layoutSchema } from "../layout/layout-specs.js"
import {
  type FieldDefRow,
  type FormWithFields,
  MetadataService,
} from "../metadata/metadata.service.js"
import { type AggregateFn, aggregate, toFormulaValue } from "../relations/rollup-agg.js"
import { applyKeyset, decodeCursor, encodeCursor, type SortKey } from "./keyset.js"
import { GROUP_DATE_UNITS } from "./record-specs.js"
import type { CalendarQuery, GroupAggregateFn, PivotQuery } from "./record-specs.js"
import type { GroupBy, LineInput, ListQuery, RecordRow, RecordValues } from "./record-specs.js"

interface ResolvedField {
  readonly row: FieldDefRow
  readonly column: string
  readonly type: CellValueType
  readonly virtual: boolean
}

const SYSTEM_FIELD_TYPES: ReadonlySet<CellValueType> = new Set([
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
])

/* lookup 的來源記錄已被刪除時的標記值。回 null 會讓「沒填」與「來源不見了」
   在單據上長得一模一樣 —— 後者是資料遺失,必須看得出來。 */
export const SOURCE_DELETED = "__source_deleted__"

/* 🔴 帶入來源無權檢視時的標記值(FMEA D3)。與 SOURCE_DELETED 分開:
   「你不能看」和「資料不見了」對使用者是完全不同的兩件事,合成一個會讓真正的資料遺失被當成權限問題忽略。
   受記錄範圍限制時,「查不到」在應用層無法與「已刪除」區分 → 一律回本標記(不揭露存在性)。 */
export const SOURCE_RESTRICTED = "__source_restricted__"

/* 分組時「空值」那一組的鍵值(前端傳回折疊狀態時用)。
   以字面值表示而非 null —— 折疊清單是字串陣列,null 無法在其中表達。 */
export const GROUP_EMPTY = "__empty__"

/* 群數上限(OQ-VG-8=A,對齊 Baserow 2000)。高基數欄位分組會產生數萬群、直接打死瀏覽器。
   超過時**明示截斷**而非靜默丟棄(承 views-list 匯出之誠實訊息慣例)。 */
const MAX_GROUPS = 2000

export interface GroupStatsRow {
  readonly keys: readonly (string | null)[]
  readonly depth: number
  readonly count: number
  readonly aggregates: Record<string, unknown>
}

/* pivot 的一格。長表:呼叫端以 (rowKeys, colKeys) 為鍵轉置成密集矩陣。 */
export interface PivotCell {
  readonly rowKeys: readonly (string | null)[]
  readonly colKeys: readonly (string | null)[]
  readonly count: number
  readonly measures: Record<string, unknown>
}

export interface PivotResult {
  readonly cells: readonly PivotCell[]
  readonly rowHeaders: readonly (readonly string[])[]
  readonly colHeaders: readonly (readonly string[])[]
  readonly truncated: boolean
}

/* 欄軸 distinct 上限(OQ-PC-4=A):超過走 top-N + 明示截斷。
   Google Sheets 的 PivotGroupLimit 即此形態;Superset #35981 實證 20k×10 即凍瀏覽器。 */
const MAX_PIVOT_COLS = 100
const MAX_PIVOT_CELLS = 20_000

export interface GroupStatsResult {
  readonly groups: readonly GroupStatsRow[]
  readonly truncated: boolean
}

/* link/bigint 值經 pg 回傳為字串 → 統一轉數值 id(lookup 用) */
function toId(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v)
  return undefined
}

function systemFieldValue(type: CellValueType, rec: RecordRow): unknown {
  switch (type) {
    case "createdAt":
      return rec.createdAt instanceof Date ? rec.createdAt.toISOString() : rec.createdAt
    case "updatedAt":
      return rec.updatedAt instanceof Date ? rec.updatedAt.toISOString() : rec.updatedAt
    case "createdBy":
      return rec.createdBy
    case "updatedBy":
      return rec.updatedBy
    default:
      return null
  }
}

interface AutoNumberOptions {
  readonly prefix?: string
  readonly width?: number
  readonly dateFormat?: "yyyy" | "yyyyMM" | "yyyyMMdd"
  readonly resetScope?: "none" | "daily" | "monthly" | "yearly" | "field"
  readonly resetField?: string
}

/* 🔴 單據的「日期分界」必須用**租戶時區**,不能用 UTC(#105 P1-7)。
   台灣是 UTC+8:1/1 08:00 之前開的單,UTC 還在去年 → 年度序號續用去年的桶、
   單號日期段也印成去年。憑證一旦列印出去就收不回來。
   formatToParts 而非 format:不倚賴任何 locale 的輸出格式。 */
function tenantDateParts(d: Date, timeZone: string): { y: string; m: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d)
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? ""
  return { y: pick("year"), m: pick("month"), day: pick("day") }
}

function formatDatePart(fmt: "yyyy" | "yyyyMM" | "yyyyMMdd", d: Date, timeZone: string): string {
  const { y, m, day } = tenantDateParts(d, timeZone)
  if (fmt === "yyyy") return y
  if (fmt === "yyyyMM") return y + m
  return y + m + day
}

/* reset_key:counter 依此分桶(空=全域)。日期段依租戶時區,見 tenantDateParts。 */
function computeResetKey(
  options: AutoNumberOptions,
  values: RecordValues,
  now: Date,
  timeZone: string,
): string {
  switch (options.resetScope ?? "none") {
    case "yearly":
      return `y${formatDatePart("yyyy", now, timeZone)}`
    case "monthly":
      return `m${formatDatePart("yyyyMM", now, timeZone)}`
    case "daily":
      return `d${formatDatePart("yyyyMMdd", now, timeZone)}`
    case "field":
      return `f${options.resetField ? String(values[options.resetField] ?? "") : ""}`
    default:
      return ""
  }
}

interface ResolvedForm {
  readonly table: string
  readonly byName: ReadonlyMap<string, ResolvedField>
  readonly fields: readonly ResolvedField[]
  readonly isSubtable: boolean
  readonly layout: Layout | null
}

/* 🔴 「沒填」在使用者眼中只有一種,JSON 卻可以傳三種:`null` / `""` / `[]`。
   不在**寫入端**收斂成 NULL,會有兩個都很難查的後果:
   (a) required 只擋 null → 空字串直通,必填形同虛設
   (b) isEmpty 篩選是 `IS NULL` → 存成 `""` 的列查不到,使用者以為資料齊全
   順帶修好一個既有 UX 缺陷:optional 的 email / url 欄原本無法用 `""` 清空
   (zod 會判 `""` 不是合法 email 而擋下)。
   不動的:`false` / `0` 是真值,不在此列;非空字串也**不 trim**,免得改動使用者資料。 */
function normalizeEmpty(raw: unknown): unknown {
  if (typeof raw === "string" && raw.trim() === "") return null
  if (Array.isArray(raw) && raw.length === 0) return null
  return raw
}

const BULK_MAX_ROWS = 5000

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/* A4|記錄 DML(app 車道 APP_KNEX;prod = weyver_app 無 DDL / 無 BYPASSRLS):
   identifier 一律出自 catalog(查無即拒),值一律參數綁定(鐵則 1);
   每個操作跑在 inTenantTx(set_config app.tenant_id, tx 範圍)→ RLS 執法 +
   app 層 WHERE tenant_id 雙防線(鐵則 3);soft delete 預設過濾(OQ-FEC-5)。 */
@Injectable()
export class RecordService {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    // 讀時算公式注入(P0-3 M6);optional 使既有測試 new RecordService(knex, metadata) 不受影響
    @Optional() @Inject(FormulaService) private readonly formula?: FormulaService,
    // F-5 M3 兩階段綁定;optional 使既有單元測 new RecordService(knex, metadata) 不受影響
    @Optional() @Inject(FilesService) private readonly files?: FilesService,
    // F-6 M2 記錄配額(只在 bulk 路徑檢核:單筆做全表 count 於大表為 seq scan)
    @Optional() @Inject(QuotaService) private readonly quota?: QuotaService,
  ) {}

  /* 讀時公式注入:formula 欄之值不儲存,讀取時以其他欄計算後併入(docs OQ-FML-8 之讀時算模式)。
     非公式表零額外查詢(hasFormula 短路);公式表每列一次 computeRecord(N+1 為已知優化點,見 FMEA)。 */
  private async withFormulas(
    tenantId: number,
    formId: number,
    resolved: ResolvedForm,
    records: readonly RecordRow[],
  ): Promise<RecordRow[]> {
    const hasFormula = resolved.fields.some((f) => f.type === "formula")
    if (this.formula === undefined || !hasFormula || records.length === 0) return [...records]
    const out: RecordRow[] = []
    for (const record of records) {
      const computed = await this.formula.computeRecord(tenantId, formId, record.values)
      const values: RecordValues = { ...record.values }
      for (const [name, value] of Object.entries(computed)) {
        values[name] = value instanceof Decimal ? value.toString() : value
      }
      out.push({ ...record, values })
    }
    return out
  }

  /* R1·UP-4 讀時計算虛擬欄注入(系統欄投影 / lookup / rollup)。順序在 withFormulas 之前 →
     公式可引用其結果。全 systemManaged(值不儲存);越權讀 target(lookup)由呼叫端 policy 遮罩兜底。 */
  private async withComputed(
    tenantId: number,
    formId: number,
    resolved: ResolvedForm,
    records: readonly RecordRow[],
    policy?: FieldAccessPolicy,
    actorId?: number,
  ): Promise<RecordRow[]> {
    const systemFields = resolved.fields.filter((f) => SYSTEM_FIELD_TYPES.has(f.type))
    const lookupFields = resolved.fields.filter((f) => f.type === "lookup")
    const rollupFields = resolved.fields.filter((f) => f.type === "rollup")
    if (systemFields.length === 0 && lookupFields.length === 0 && rollupFields.length === 0) {
      return [...records]
    }
    const out = records.map((r) => ({ ...r, values: { ...r.values } }))

    // 系統欄:投影 RecordRow 信封之 audit 值
    for (const rec of out) {
      for (const sf of systemFields) {
        rec.values[sf.row.name] = systemFieldValue(sf.type, rec)
      }
    }

    // lookup:批次拉 target 記錄(raw,無巢狀計算)之指定欄
    for (const lf of lookupFields) {
      const opts = lf.row.options as { linkFieldName?: string; targetFieldName?: string }
      const linkField = opts.linkFieldName ? resolved.byName.get(opts.linkFieldName) : undefined
      const targetFormId = (linkField?.row.options as { targetFormId?: number } | undefined)
        ?.targetFormId
      if (
        opts.linkFieldName === undefined ||
        opts.targetFieldName === undefined ||
        targetFormId === undefined
      ) {
        for (const rec of out) rec.values[lf.row.name] = null
        continue
      }
      const linkName = opts.linkFieldName
      const targetName = opts.targetFieldName

      /* 🔴 帶入欄是「另一張表的資料出現在這張表上」,權限必須依**來源表**判斷 ——
         否則沒有客戶主檔權限的人可經由訂單上的帶入欄把客戶資料整批讀出來(FMEA D3)。
         表單級閘為粗網:完全無權時 defaultFieldVisibility 已回 hidden,下面的欄位級閘
         就會擋下;留著是為了「目標欄名解不出來」時仍 fail-closed,並省一次 resolveForm。 */
      if (policy?.canRead !== undefined && !policy.canRead(targetFormId)) {
        for (const rec of out) rec.values[lf.row.name] = SOURCE_RESTRICTED
        continue
      }
      /* 欄位級閘:來源表上被隱藏的欄不得經由帶入繞出來(#100 同一破口類型)。 */
      const targetForm = await this.resolveForm(tenantId, targetFormId)
      const targetField = targetForm.byName.get(targetName)
      if (
        targetField !== undefined &&
        policy?.fieldVisibility(targetField.row.id, targetFormId) === "hidden"
      ) {
        for (const rec of out) rec.values[lf.row.name] = SOURCE_RESTRICTED
        continue
      }
      // 記錄級閘:來源表檢視受 own 限制時,帶入也只能帶自己看得到的記錄
      const targetScoped = policy?.isScopedToOwn?.(targetFormId, "view") === true

      /* 🔴 快照模式:值已在物理欄裡,讀取時**不得**用即時值蓋掉(那就等於 live)。
         值為 NULL 才回退即時計算 —— 對應 lazy backfill:剛從 live 切成 snapshot 的既有記錄
         還沒有值,先照舊顯示,下次寫入或明確重整才落值(§0-ter A-8)。 */
      const snapshot = isSnapshotLookup(lf.row.options)
      const pending = snapshot
        ? out.filter((r) => r.values[lf.row.name] === null || r.values[lf.row.name] === undefined)
        : out
      if (pending.length === 0) continue

      const ids = [
        ...new Set(
          pending.map((r) => toId(r.values[linkName])).filter((v): v is number => v !== undefined),
        ),
      ]
      const targets = await this.getRecordsByIds(tenantId, targetFormId, ids, {
        actorId: actorId ?? null,
        own: targetScoped,
      })
      for (const rec of pending) {
        const linkedId = toId(rec.values[linkName])
        const target = linkedId !== undefined ? targets.get(linkedId) : undefined
        /* 🔴 區分「沒連結」與「連結的來源已不存在」(#113)。
           兩者原本都是 null —— 單據上看起來就是「這欄空的」,而實際是資料遺失。
           已凍結的記錄不受影響:快照值會在最後覆蓋回來,這正是 snapshot 的價值。 */
        if (linkedId !== undefined && target === undefined) {
          // 受範圍限制時「查不到」可能只是看不到 → 標記為無權而非資料遺失
          rec.values[lf.row.name] = targetScoped ? SOURCE_RESTRICTED : SOURCE_DELETED
          continue
        }
        rec.values[lf.row.name] = target?.values[targetName] ?? null
      }
    }

    // rollup:listByParents(N+1 safe)+ 純函式聚合
    const parentIds = out.map((r) => r.id)
    for (const rf of rollupFields) {
      const opts = rf.row.options as {
        childFormId?: number
        childFieldName?: string
        fn?: AggregateFn
        condition?: { field: string; equals: unknown }
      }
      if (
        opts.childFormId === undefined ||
        opts.childFieldName === undefined ||
        opts.fn === undefined
      ) {
        for (const rec of out) rec.values[rf.row.name] = null
        continue
      }
      const childField = opts.childFieldName
      const condition = opts.condition
      const fn = opts.fn
      const children = await this.listByParents(tenantId, opts.childFormId, parentIds)
      const byParent = new Map<number, RecordRow[]>()
      for (const c of children) {
        if (c.parentId === null) continue
        const list = byParent.get(c.parentId) ?? []
        list.push(c)
        byParent.set(c.parentId, list)
      }
      for (const rec of out) {
        const rows = (byParent.get(rec.id) ?? []).filter((r) =>
          condition === undefined ? true : r.values[condition.field] === condition.equals,
        )
        const val = aggregate(
          fn,
          rows.map((r) => toFormulaValue(r.values[childField])),
        )
        rec.values[rf.row.name] = val instanceof Decimal ? val.toString() : val
      }
    }

    /* 🔴 已凍結的記錄:用快照值覆蓋剛算出來的即時值(#113)。
       放在**最後**覆蓋而非「凍結就跳過計算」—— 計算本來就是整批做的,
       少算幾筆省不了 round trip,但少一條分支就少一種不一致的可能。 */
    if (lookupFields.length > 0 || rollupFields.length > 0) {
      await this.applySnapshots(tenantId, formId, out)
    }
    return out
  }

  /* 讀取凍結值並覆蓋。只查一次(以 record id 批次),非凍結表零成本(命不中即無事發生)。
     🔴 **必須同時綁 form_id**:記錄 id 是每張動態表各自的序列,都從 1 開始 ——
     只用 record_id 過濾會讓 A 表凍結的值蓋到 B 表同 id 的記錄上(實作時踩到,由測試抓出)。 */
  private async applySnapshots(
    tenantId: number,
    formId: number,
    records: RecordRow[],
  ): Promise<void> {
    if (records.length === 0) return
    const rows = await this.inTenantTx(tenantId, (trx) =>
      trx("record_snapshot")
        .select("record_id", "values")
        .where({ tenant_id: tenantId, form_id: formId })
        .whereIn(
          "record_id",
          records.map((r) => r.id),
        ),
    )
    if (rows.length === 0) return
    const byId = new Map(
      (rows as { record_id: string | number; values: RecordValues }[]).map((r) => [
        Number(r.record_id),
        r.values,
      ]),
    )
    for (const rec of records) {
      const frozen = byId.get(rec.id)
      if (frozen === undefined) continue
      for (const [name, value] of Object.entries(frozen)) rec.values[name] = value
    }
  }

  /* 🔴 固化:把當下的 lookup / rollup 值寫成快照,此後不再隨主檔變動(#113)。
     目前由簽核完成觸發 —— 單據一旦定案,其顯示內容就不該再被第三方(主檔維護者)改寫。

     **once frozen, stays frozen**:ON CONFLICT DO NOTHING。
     重複凍結會用「現在的主檔值」蓋掉「定案當下的值」,正好是本機制要防的事。 */
  async freezeComputed(tenantId: number, formId: number, recordId: number, reason: string): Promise<void> {
    const resolved = await this.resolveForm(tenantId, formId)
    const computedFields = resolved.fields.filter((f) => f.type === "lookup" || f.type === "rollup")
    if (computedFields.length === 0) return

    const record = await this.getRecord(tenantId, formId, recordId)
    const frozen: RecordValues = {}
    for (const field of computedFields) frozen[field.row.name] = record.values[field.row.name] ?? null

    await this.inTenantTx(tenantId, (trx) =>
      trx.raw(
        `INSERT INTO record_snapshot (tenant_id, form_id, record_id, values, frozen_reason)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [tenantId, formId, recordId, JSON.stringify(frozen), reason],
      ),
    )
  }

  /* 批次依 id 取記錄(lookup target 用;raw 值,無 withComputed/withFormulas 避遞迴) */
  private async getRecordsByIds(
    tenantId: number,
    formId: number,
    ids: readonly number[],
    scope?: { actorId: number | null; own: boolean },
  ): Promise<Map<number, RecordRow>> {
    if (ids.length === 0) return new Map()
    const resolved = await this.resolveForm(tenantId, formId)
    return this.inTenantTx(
      tenantId,
      async (trx) => {
        const rows = (await this.baseQuery(trx, tenantId, resolved).whereIn(
          `${resolved.table}.id`,
          [...ids],
        )) as Record<string, unknown>[]
        const map = new Map<number, RecordRow>()
        for (const row of rows) {
          const rec = this.toRecord(resolved, row)
          map.set(rec.id, rec)
        }
        return map
      },
      scope,
    )
  }

  /* 🔴 F-1 M4 行事曆:區間重疊查詢。
     **與 group-by 不同**:一筆記錄可橫跨多天(佔多格),故不能用分組那套「一筆屬一組」。

     重疊條件:`start < to AND coalesce(end, start) >= from`
     —— `to` 排他(半開區間,RFC 5545 之 DTEND 語意);無結束欄時視為單日事件。

     `date` 欄無時區(floating),直接以 date 比較,任何路徑禁 timestamptz cast;
     `dateTime` 欄先轉租戶時區再取日期,否則同一筆在不同人畫面上會落在不同天。 */
  async calendarRange(
    tenantId: number,
    formId: number,
    q: CalendarQuery,
    policy?: FieldAccessPolicy,
    actorId: number | null = null,
  ): Promise<{ records: RecordRow[]; truncated: boolean }> {
    const resolved = await this.resolveForm(tenantId, formId)
    const start = resolved.byName.get(q.startField)
    if (start === undefined) throw new UnknownFieldError(q.startField)
    this.assertReadable(resolved, formId, q.startField, policy)
    if (start.type !== "date" && start.type !== "dateTime") {
      throw new UnknownFieldError(q.startField)
    }
    const end = q.endField === undefined ? undefined : resolved.byName.get(q.endField)
    if (q.endField !== undefined) {
      if (end === undefined) throw new UnknownFieldError(q.endField)
      this.assertReadable(resolved, formId, q.endField, policy)
    }

    const asDate = (f: ResolvedField): string =>
      f.type === "date"
        ? `"${f.column}"`
        : `("${f.column}" at time zone coalesce(nullif(current_setting('app.tenant_tz', true), ''), 'UTC'))::date`
    const startExpr = asDate(start)
    const endExpr = end === undefined ? startExpr : `coalesce(${asDate(end)}, ${startExpr})`

    const result = await this.inTenantTx(
      tenantId,
      async (trx) => {
        let builder = this.baseQuery(trx, tenantId, resolved)
        builder = this.applyQueryPredicates(
          builder,
          resolved,
          formId,
          { ...q, sort: [], limit: q.limit } as unknown as ListQuery,
          policy,
        )
        builder = builder
          .whereRaw(`${startExpr} < ?::date`, [q.to])
          .whereRaw(`${endExpr} >= ?::date`, [q.from])
          .orderByRaw(`${startExpr} asc nulls last`)
          .orderBy(`${resolved.table}.id`, "asc")
        const rows = (await builder.limit(q.limit + 1)) as Record<string, unknown>[]
        const truncated = rows.length > q.limit
        return {
          records: (truncated ? rows.slice(0, q.limit) : rows).map((r) => this.toRecord(resolved, r)),
          truncated,
        }
      },
      { actorId, own: policy?.isScopedToOwn?.(formId, "view") === true },
    )
    const enriched = await this.withComputed(
      tenantId,
      formId,
      resolved,
      result.records,
      policy,
      actorId ?? undefined,
    )
    const computed = await this.withFormulas(tenantId, formId, resolved, enriched)
    return { records: this.maskRead(resolved, formId, computed, policy), truncated: result.truncated }
  }

  /* filter + 快速搜尋的共用述詞(列表 / 分組統計同源)。 */
  private applyQueryPredicates(
    builder: Knex.QueryBuilder,
    resolved: ResolvedForm,
    formId: number,
    query: ListQuery,
    policy?: FieldAccessPolicy,
  ): Knex.QueryBuilder {
    let out = builder
    // filters 包在自身 group(關鍵:combinator=or 不得洩到 tenant/deleted_at 之 AND 邊界)
    if (query.filters.length > 0) {
      const combinator = query.combinator ?? "and"
      out = out.where((group: Knex.QueryBuilder) => {
        query.filters.forEach((filter, i) => {
          const joiner: "where" | "orWhere" = i === 0 || combinator === "and" ? "where" : "orWhere"
          /* 隱藏欄不得作為篩選條件 —— 否則可由回傳筆數反推其值 */
          this.assertReadable(resolved, formId, filter.field, policy)
          group[joiner]((sub: Knex.QueryBuilder) => {
            this.applyFilter(sub, resolved, filter)
          })
        })
      })
    }
    // 快速搜尋:AND 一個「跨 textual 欄 OR ILIKE」子群(白名單 = dbFieldType text)
    const term = query.q?.trim()
    if (term !== undefined && term !== "") {
      const pattern = `%${escapeLike(term)}%`
      /* 快速搜尋**跳過**隱藏欄(而非報錯)—— 搜尋是便利功能非指名查詢,
         報錯會讓使用者無從得知該打什麼;但掃進隱藏欄即可測知值是否存在。 */
      const textColumns = resolved.fields
        .filter(
          (f) =>
            fieldType(f.type).dbFieldType === "text" &&
            (policy === undefined || policy.fieldVisibility(f.row.id, formId) !== "hidden"),
        )
        .map((f) => f.column)
      if (textColumns.length > 0) {
        out = out.where((group: Knex.QueryBuilder) => {
          textColumns.forEach((col, i) => {
            if (i === 0) group.where(col, "ilike", pattern)
            else group.orWhere(col, "ilike", pattern)
          })
        })
      }
    }
    return out
  }

  /* 🔴 F-1 分組統計(§4.2)。**與列表跑在同一 RLS role / 同一交易** ——
     這是唯一會真洩漏的路徑:若改用特權連線算 count,使用者只看得到 3 筆卻會看到
     「共 47 筆」,等於洩漏他無權存取之資料的存在與數量。
     Ragic 官方自承「報表快照以系統管理員權限產生,可能包含檢視者無權存取的資料」即此形狀。
     PG 官方明載 policy 先於 user query 的 conditions/functions 求值 → COUNT/SUM 天然只算可見列。

     多層小計以 **GROUPING SETS 一次查完**,不逐層發查詢。 */
  async groupStats(
    tenantId: number,
    formId: number,
    query: ListQuery,
    aggregates: readonly { field: string; fn: GroupAggregateFn }[],
    policy?: FieldAccessPolicy,
    actorId: number | null = null,
  ): Promise<GroupStatsResult> {
    const resolved = await this.resolveForm(tenantId, formId)
    const groups = query.groupBy ?? []
    if (groups.length === 0) throw new UnknownFieldError("groupBy")

    const exprs: string[] = []
    for (const g of groups) {
      const field = resolved.byName.get(g.field)
      if (field === undefined) throw new UnknownFieldError(g.field)
      this.assertReadable(resolved, formId, g.field, policy)
      exprs.push(this.groupExpression(field, g))
    }

    const aggSelects: string[] = []
    for (const [i, a] of aggregates.entries()) {
      const field = resolved.byName.get(a.field)
      if (field === undefined) throw new UnknownFieldError(a.field)
      /* 隱藏欄不得被聚合 —— 小計同樣會洩漏其分佈 */
      this.assertReadable(resolved, formId, a.field, policy)
      aggSelects.push(`${this.aggregateExpression(field, a.fn)} AS a${String(i)}`)
    }

    return this.inTenantTx(
      tenantId,
      async (trx) => {
        let builder = this.baseQuery(trx, tenantId, resolved).clearSelect().clearOrder()
        builder = this.applyQueryPredicates(builder, resolved, formId, query, policy)

        const setList = groups.map((_, i) => `(${exprs.slice(0, i + 1).join(", ")})`).join(", ")
        const selects = [
          ...exprs.map((e, i) => `${e} AS g${String(i)}`),
          "count(*)::bigint AS n",
          ...aggSelects,
        ]
        const rows = (await builder
          .select(trx.raw(selects.join(", ")))
          .groupByRaw(`GROUPING SETS (${setList})`)) as Record<string, unknown>[]

        const out: GroupStatsRow[] = rows.map((r) => {
          const keys: (string | null)[] = []
          for (let i = 0; i < groups.length; i++) {
            const v = r[`g${String(i)}`]
            keys.push(v === null || v === undefined ? null : String(v))
          }
          /* GROUPING SETS 的較淺層級在深層欄位為 NULL —— 以「第一個 null 之前」界定深度。
             注意這與「值本身是 NULL」不可混淆,故 depth 由 set 結構決定而非值。 */
          let depth = groups.length
          for (let i = groups.length - 1; i >= 0; i--) {
            if (r[`g${String(i)}`] === null || r[`g${String(i)}`] === undefined) depth = i
            else break
          }
          const agg: Record<string, unknown> = {}
          for (const [i, a] of aggregates.entries()) {
            agg[`${a.fn}:${a.field}`] = r[`a${String(i)}`] ?? null
          }
          return { keys: keys.slice(0, Math.max(depth, 1)), depth: Math.max(depth, 1), count: Number(r.n), aggregates: agg }
        })
        const truncated = out.length > MAX_GROUPS
        return { groups: truncated ? out.slice(0, MAX_GROUPS) : out, truncated }
      },
      { actorId, own: policy?.isScopedToOwn?.(formId, "view") === true },
    )
  }

  /* 🔴 F-2 樞紐分析。**引擎層與 group-stats 共用,只有 grouping set 的產生規則不同**:
     group-stats 是「前綴 rollup」(g1)(g1,g2)(g1,g2,g3);
     pivot 是「**兩組前綴的笛卡兒積**」(列軸前綴 × 欄軸前綴)——
     這正是 Metabase 的 breakout-combination 定義。**不用 `CUBE`**:CUBE(n) 是 2ⁿ 組,
     3 列軸 + 1 欄軸時 16 組 vs 明列 8 組。

     **輸出長表**(OQ-PC-1=A):業界無一家回動態寬表(Metabase / Superset / Cube 皆前端轉置),
     且 PG result set 上限 1,664 欄是硬天花板;寬表的 JSON key 會變成使用者資料。

     🔴 **欄標頭只從這條查詢導出** —— 禁從單選欄的選項定義 / metadata / 快取取值。
     CVE-2024-55951(Metabase filter values 被跨 sandbox 使用者快取共用)洩漏的正是維度值清單。 */
  async pivot(
    tenantId: number,
    formId: number,
    q: PivotQuery,
    policy?: FieldAccessPolicy,
    actorId: number | null = null,
  ): Promise<PivotResult> {
    const resolved = await this.resolveForm(tenantId, formId)
    const axes = [...q.rowGroupBy, ...q.colGroupBy]
    const exprs: string[] = []
    for (const g of axes) {
      const field = resolved.byName.get(g.field)
      if (field === undefined) throw new UnknownFieldError(g.field)
      /* 隱藏欄不得當軸 —— 欄標頭的值本身即是資料(FMEA P2) */
      this.assertReadable(resolved, formId, g.field, policy)
      exprs.push(this.groupExpression(field, g))
    }
    const aggSelects: string[] = []
    for (const [i, a] of q.aggregates.entries()) {
      const field = resolved.byName.get(a.field)
      if (field === undefined) throw new UnknownFieldError(a.field)
      this.assertReadable(resolved, formId, a.field, policy)
      aggSelects.push(`${this.aggregateExpression(field, a.fn)} AS a${String(i)}`)
    }

    const rowCount = q.rowGroupBy.length
    const colCount = q.colGroupBy.length
    /* 笛卡兒積:列軸前綴(含空)× 欄軸前綴(含空),去掉全空那一組 */
    const sets: string[] = []
    for (let r = 0; r <= rowCount; r++) {
      for (let c = 0; c <= colCount; c++) {
        if (r === 0 && c === 0) continue
        const cols = [
          ...Array.from({ length: r }, (_, i) => `d${String(i)}`),
          ...Array.from({ length: c }, (_, i) => `d${String(rowCount + i)}`),
        ]
        sets.push(`(${cols.join(", ")})`)
      }
    }

    return this.inTenantTx(
      tenantId,
      async (trx) => {
        let inner = this.baseQuery(trx, tenantId, resolved).clearSelect().clearOrder()
        inner = this.applyQueryPredicates(inner, resolved, formId, { ...q, sort: [], limit: 1 } as unknown as ListQuery, policy)
        /* 🔴 §0.3 陷阱 1:breakout 若是**表達式**(本專案的日期分組正是 date_trunc),
           在 GROUPING SETS 與 GROUPING() 中各自出現時 planner 視為不同運算式而拒絕 query。
           故先在內層 subquery **物化成具名欄** d0..dN 再聚合。 */
        const innerSelects = [
          ...exprs.map((e, i) => `${e} AS d${String(i)}`),
          ...q.aggregates.map((a) => {
            const f = resolved.byName.get(a.field)
            return `"${f?.column ?? ""}" AS m${String(q.aggregates.indexOf(a))}`
          }),
        ]
        inner = inner.select(trx.raw(innerSelects.join(", ")))

        const outerAgg = q.aggregates.map(
          (a, i) => `${this.aggregateOnAlias(`m${String(i)}`, a.fn)} AS a${String(i)}`,
        )
        const selects = [
          ...axes.map((_, i) => `d${String(i)}`),
          "count(*)::bigint AS n",
          ...outerAgg,
          `GROUPING(${axes.map((_, i) => `d${String(i)}`).join(", ")}) AS gmask`,
        ]
        void aggSelects

        const sql = trx
          .select(trx.raw(selects.join(", ")))
          .from(inner.as("src"))
          .groupByRaw(`GROUPING SETS (${sets.join(", ")})`)
        const rows = (await sql) as Record<string, unknown>[]

        const cells: PivotCell[] = rows.map((r) => {
          const mask = Number(r.gmask ?? 0)
          const total = axes.length
          /* GROUPING() 的 bit:1 = 該欄未參與此 grouping set(即小計層) */
          const present = (i: number): boolean => ((mask >> (total - 1 - i)) & 1) === 0
          const rowKeys: (string | null)[] = []
          for (let i = 0; i < rowCount; i++) {
            if (!present(i)) break
            const v = r[`d${String(i)}`]
            rowKeys.push(v === null || v === undefined ? null : String(v))
          }
          const colKeys: (string | null)[] = []
          for (let i = 0; i < colCount; i++) {
            if (!present(rowCount + i)) break
            const v = r[`d${String(rowCount + i)}`]
            colKeys.push(v === null || v === undefined ? null : String(v))
          }
          const measures: Record<string, unknown> = {}
          for (const [i, a] of q.aggregates.entries()) {
            measures[`${a.fn}:${a.field}`] = r[`a${String(i)}`] ?? null
          }
          return { rowKeys, colKeys, count: Number(r.n), measures }
        })

        /* 欄標頭:只從本查詢的結果導出(禁從選項定義 / metadata / 快取)。
           top-N:欄軸高基數會凍瀏覽器(Superset #35981 實證 20k×10 即凍)。 */
        const colTotals = new Map<string, number>()
        for (const c of cells) {
          if (c.rowKeys.length > 0 || c.colKeys.length !== colCount || colCount === 0) continue
          colTotals.set(c.colKeys.map((k) => k ?? GROUP_EMPTY).join(" "), c.count)
        }
        const sortedCols = [...colTotals.entries()].sort((a, b) => b[1] - a[1])
        const colHeaders = sortedCols.slice(0, MAX_PIVOT_COLS).map(([k]) => k.split(" "))
        const colsTruncated = sortedCols.length > MAX_PIVOT_COLS

        const rowHeaderSet = new Set<string>()
        for (const c of cells) {
          if (c.rowKeys.length !== rowCount || c.colKeys.length > 0) continue
          rowHeaderSet.add(c.rowKeys.map((k) => k ?? GROUP_EMPTY).join(" "))
        }
        const rowHeaders = [...rowHeaderSet].slice(0, MAX_GROUPS).map((k) => k.split(" "))

        return {
          cells: cells.slice(0, MAX_PIVOT_CELLS),
          rowHeaders,
          colHeaders,
          truncated:
            cells.length > MAX_PIVOT_CELLS || colsTruncated || rowHeaderSet.size > MAX_GROUPS,
        }
      },
      { actorId, own: policy?.isScopedToOwn?.(formId, "view") === true },
    )
  }

  /* 對已物化的別名做聚合(pivot 的外層) */
  private aggregateOnAlias(alias: string, fn: GroupAggregateFn): string {
    switch (fn) {
      case "count":
      case "filled":
        return `count(${alias})::bigint`
      case "empty":
        return `count(*) FILTER (WHERE ${alias} IS NULL)::bigint`
      case "sum":
        return `sum(${alias})::text`
      case "avg":
        return `avg(${alias})::text`
      case "min":
        return `min(${alias})::text`
      case "max":
        return `max(${alias})::text`
      default:
        return `count(*)::bigint`
    }
  }

  /* 聚合運算式。fn 為受控白名單;identifier 由 metadata 解析。 */
  private aggregateExpression(field: ResolvedField, fn: GroupAggregateFn): string {
    const col = `"${field.column}"`
    switch (fn) {
      case "count":
        return `count(${col})::bigint`
      case "empty":
        return `count(*) FILTER (WHERE ${col} IS NULL)::bigint`
      case "filled":
        return `count(${col})::bigint`
      case "sum":
        return `sum(${col})::text`
      case "avg":
        return `avg(${col})::text`
      case "min":
        return `min(${col})::text`
      case "max":
        return `max(${col})::text`
      default:
        return `count(*)::bigint`
    }
  }

  /* 分組鍵的 SQL 運算式。
     🔴 **identifier 全數來自 metadata catalog 解析後的物理欄名**(generated column),非使用者輸入;
     日期粒度為受控白名單(GROUP_DATE_UNITS),不接受任意字串。承 AGENTS 鐵則 1。
     日期分桶依**租戶時區**而非瀏覽器 —— 否則同一筆記錄在不同人畫面上會落在不同天(F-1 §4.5)。 */
  private groupExpression(field: ResolvedField, group: GroupBy): string {
    const col = `"${field.column}"`
    if (group.unit === undefined) return col
    if (!GROUP_DATE_UNITS.includes(group.unit)) return col
    if (field.type === "date") {
      // date 欄無時區(RFC 5545 floating);直接 truncate,任何路徑禁 timestamptz cast
      return `date_trunc('${group.unit}', ${col})::date`
    }
    if (field.type === "dateTime") {
      /* timestamptz → 先轉租戶時區再 truncate。`app.tenant_tz` 由 inTenantTx 設定;
         用 GUC 而非字串內插,時區值才不會有機會進到 SQL 文本裡。 */
      return `date_trunc('${group.unit}', ${col} at time zone coalesce(nullif(current_setting('app.tenant_tz', true), ''), 'UTC'))::date`
    }
    return col
  }

  /* SET LOCAL 不可參數綁定 → set_config(..., true) 交易範圍等價(M1 spike S3) */
  /* 🔴 E-1 記錄範圍(#96):scope 與 actor 以 GUC 傳給 RESTRICTIVE policy。
     強制點在 DB 不在這裡 —— 這裡只負責把「我是誰、範圍是什麼」講清楚。
     未給 scope 時明確設 'all':**GUC 是連線層狀態**,不重設會沿用同一連線上一個
     交易的值(連線池會重用),那正是「A 的限制套到 B 身上」這種最難查的洩漏。 */
  private async inTenantTx<T>(
    tenantId: number,
    fn: (trx: Knex.Transaction) => Promise<T>,
    scope?: { actorId: number | null; own: boolean },
  ): Promise<T> {
    return this.knex.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
      await trx.raw(`SELECT set_config('app.record_scope', ?, true)`, [
        scope?.own === true ? "own" : "all",
      ])
      await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [
        scope?.actorId === undefined || scope.actorId === null ? "" : String(scope.actorId),
      ])
      /* F-1:日期分組依租戶時區分桶(不是瀏覽器時區)。以 GUC 傳遞,
         時區值不進 SQL 文本。未設時 groupExpression 端 coalesce 成 UTC。 */
      const tz = await this.tenantTimeZone(trx, tenantId)
      await trx.raw(`SELECT set_config('app.tenant_tz', ?, true)`, [tz])
      return fn(trx)
    })
  }

  async createRecord(
    tenantId: number,
    formId: number,
    values: RecordValues,
    actorId: number,
    policy?: FieldAccessPolicy,
  ): Promise<RecordRow> {
    const resolved = await this.resolveForm(tenantId, formId)
    const withDefaults = await this.applyDefaults(resolved, values, actorId)
    this.assertWritable(resolved, formId, withDefaults, policy)
    const record = await this.inTenantTx(tenantId, (trx) =>
      this.insertOne(trx, tenantId, resolved, withDefaults, actorId, null, null),
    )
    await this.bindFiles(tenantId, formId, resolved, record.id, withDefaults)
    const [enriched] = await this.withComputed(
      tenantId,
      formId,
      resolved,
      [record],
      policy,
      actorId,
    )
    const [injected] = await this.withFormulas(tenantId, formId, resolved, [enriched ?? record])
    const [masked] = this.maskRead(resolved, formId, [injected ?? record], policy)
    return masked ?? injected ?? record
  }

  /* A1(P0-2)|bulk 建立:單一 tx 逐列 insert;任一列失敗 → 整批 rollback + 回失敗列 index。
     autoNumber 每列取號;繼承 validateValues(型別/必填/systemManaged)+ 參數綁定 + RLS。 */
  async createManyRecords(
    tenantId: number,
    formId: number,
    rows: readonly RecordValues[],
    actorId: number,
    policy?: FieldAccessPolicy,
  ): Promise<{ created: number }> {
    if (rows.length > BULK_MAX_ROWS) throw new BulkTooLargeError(BULK_MAX_ROWS)
    if (rows.length === 0) return { created: 0 }
    const resolved = await this.resolveForm(tenantId, formId)
    if (this.quota !== undefined) {
      const limit = await this.quota.maxRecordsFor(tenantId)
      const existing = await this.countRecords(tenantId, resolved)
      this.quota.assertRecordCount(existing, rows.length, limit)
    }
    return this.inTenantTx(tenantId, async (trx) => {
      /* 🔴 先全列預檢再寫入(追溯稽核)。

         原本第一列出錯即拋 → 5000 列有 30 個錯,使用者要來回試 30 次。
         業界(Salesforce Data Loader / Ragic)一律**一次回報全部問題列**。
         預檢在同一個交易內但**不插入**,故不會因 PG 交易中止而連鎖失敗。 */
      const failures: { rowIndex: number; reason: string }[] = []
      const prepared: RecordValues[] = []
      for (const [index, values] of rows.entries()) {
        try {
          const withDefaults = await this.applyDefaults(resolved, values, actorId)
          this.assertWritable(resolved, formId, withDefaults, policy)
          await this.validateValues(trx, tenantId, resolved, withDefaults, "create")
          prepared.push(withDefaults)
        } catch (error) {
          if (error instanceof DomainError) {
            failures.push({ rowIndex: index, reason: error.message })
            continue
          }
          throw error
        }
      }
      if (failures.length > 0) throw new BulkValidationError(failures)

      for (const [index, values] of prepared.entries()) {
        try {
          await this.insertOne(trx, tenantId, resolved, values, actorId, null, null)
        } catch (error) {
          /* 走到這裡多為 DB 層約束(如唯一鍵)—— 交易已中止,無法續驗其餘列 */
          if (error instanceof DomainError) throw new BulkRowError(index, error.message)
          throw error
        }
      }
      return { created: rows.length }
    })
  }

  /* F-6 M2 配額用:單次 count(僅 bulk 路徑呼叫,非每列)。
     🔴 **刻意不套記錄範圍**:配額是租戶層的量,不是使用者看得到多少 ——
     若在此套 own,受限使用者會以為額度沒用完而一路寫到爆。 */
  private async countRecords(tenantId: number, resolved: ResolvedForm): Promise<number> {
    return this.inTenantTx(tenantId, async (trx) => {
      const rows = (await trx
        .withSchema(DATA_SCHEMA)
        .table(resolved.table)
        .where({ tenant_id: tenantId })
        .whereNull("deleted_at")
        .count({ total: "id" })) as { total: string | number }[]
      const total = rows[0]?.total ?? 0
      return typeof total === "number" ? total : Number(total)
    })
  }

  /* 🔴 actorId 為記錄範圍所需(#96 sweep):單筆讀取原本沒帶範圍 → 受 own 限制的人
     照樣能用 id 直接讀到別人的記錄(列表擋住了,單筆沒擋)。 */
  async getRecord(
    tenantId: number,
    formId: number,
    recordId: number,
    policy?: FieldAccessPolicy,
    actorId: number | null = null,
  ): Promise<RecordRow> {
    const resolved = await this.resolveForm(tenantId, formId)
    const record = await this.inTenantTx(
      tenantId,
      async (trx) => {
        const row = await this.baseQuery(trx, tenantId, resolved)
          .where(`${resolved.table}.id`, recordId)
          .first()
        if (row === undefined) throw new RecordNotFoundError(recordId)
        return this.toRecord(resolved, row as Record<string, unknown>)
      },
      { actorId, own: policy?.isScopedToOwn?.(formId, "view") === true },
    )
    const enrichedList = await this.withComputed(
      tenantId,
      formId,
      resolved,
      [record],
      policy,
      actorId ?? undefined,
    )
    const [enriched] = enrichedList
    const [injected] = await this.withFormulas(tenantId, formId, resolved, [enriched ?? record])
    const [masked] = this.maskRead(resolved, formId, [injected ?? record], policy)
    return masked ?? injected ?? record
  }

  /* 子表批次取數(Rollup 之 N+1 防護):一次 whereIn parent_id 撈全部子列,呼叫端在 app 層分組聚合。 */
  async listByParents(
    tenantId: number,
    childFormId: number,
    parentIds: readonly number[],
  ): Promise<RecordRow[]> {
    if (parentIds.length === 0) return []
    const resolved = await this.resolveForm(tenantId, childFormId)
    return this.inTenantTx(tenantId, async (trx) => {
      const rows = (await this.baseQuery(trx, tenantId, resolved)
        .whereIn(`${resolved.table}.parent_id`, [...parentIds])
        .orderBy(`${resolved.table}.parent_id`, "asc")
        .orderBy(`${resolved.table}.line_no`, "asc")) as Record<string, unknown>[]
      return rows.map((row) => this.toRecord(resolved, row))
    })
  }

  async listRecords(
    tenantId: number,
    formId: number,
    query: ListQuery,
    policy?: FieldAccessPolicy,
    actorId: number | null = null,
  ): Promise<{ records: RecordRow[]; nextCursor: string | null }> {
    const resolved = await this.resolveForm(tenantId, formId)
    const result = await this.inTenantTx(
      tenantId,
      async (trx) => {
      let builder = this.baseQuery(trx, tenantId, resolved)
      /* 🔴 filter / 快速搜尋抽為共用述詞 —— **列表與分組統計必須用同一份**,
         否則小計的母體與列表看到的不是同一批,數字對不上且錯得安靜(F-1 §4.2)。 */
      builder = this.applyQueryPredicates(builder, resolved, formId, query, policy)
      const sortKeys: SortKey[] = []
      /* 🔴 F-1:分組鍵**前置**於使用者排序鍵(§4.1)。
         分組不是聚合查詢,是排序的變形 —— ORDER BY g1,g2,g3, <排序鍵>, id,
         cursor 一併涵蓋 group key,故「第 2 頁」是扁平序列的下一段、不會跨組錯位。
         這正是 AG Grid 的 paginateChildRows 語意;改用 offset 等於放棄 #95 修好的複合 cursor。 */
      for (const group of query.groupBy ?? []) {
        const field = resolved.byName.get(group.field)
        if (field === undefined) throw new UnknownFieldError(group.field)
        /* 隱藏欄不得分組 —— **group header 的值本身即是資料**,比小計更早洩漏(FMEA G2) */
        this.assertReadable(resolved, formId, group.field, policy)
        const expr = this.groupExpression(field, group)
        builder = builder.orderByRaw(
          `${expr} ${group.dir === "desc" ? "desc" : "asc"} nulls last`,
        )
        sortKeys.push({ column: field.column, dir: group.dir, raw: expr })
      }
      for (const sort of query.sort) {
        const field = resolved.byName.get(sort.field)
        if (field === undefined) throw new UnknownFieldError(sort.field)
        /* 隱藏欄不得作為排序鍵 —— 否則可由列序推出大小關係 */
        this.assertReadable(resolved, formId, sort.field, policy)
        // 空值一律沉底(PG DESC 預設 NULLS FIRST,對使用者不直覺)
        builder = builder.orderBy(field.column, sort.dir, "last")
        sortKeys.push({ column: field.column, dir: sort.dir })
      }
      /* 折疊的群組:從查詢排除(而非前端隱藏)。否則折疊後仍吃掉 page size,
         使用者會看到「明明折疊了卻出現空白頁」(承 Teable collapsedGroupIds)。 */
      const collapsed = query.collapsed ?? []
      if (collapsed.length > 0 && (query.groupBy ?? []).length > 0) {
        const groups = query.groupBy ?? []
        for (const combo of collapsed) {
          builder = builder.whereNot((g: Knex.QueryBuilder) => {
            combo.forEach((value, i) => {
              const gb = groups[i]
              if (gb === undefined) return
              const field = resolved.byName.get(gb.field)
              if (field === undefined) return
              const expr = this.groupExpression(field, gb)
              if (value === GROUP_EMPTY) g.whereRaw(`${expr} is null`)
              else g.whereRaw(`${expr} = ?`, [value])
            })
          })
        }
      }

      const idColumn = `${resolved.table}.id`
      builder = builder.orderBy(idColumn, "asc")

      /* 🔴 續頁條件必須與排序鍵一致(#95)。原本恆為 `id > cursor`,
         排序欄非 id 時會整頁跳過 —— 且使用者看不出少了東西。 */
      if (query.cursor !== undefined) {
        const decoded = decodeCursor(query.cursor)
        if (decoded !== null) builder = applyKeyset(builder, sortKeys, decoded, idColumn)
      }
      const rows = (await builder.limit(query.limit + 1)) as Record<string, unknown>[]

      const hasMore = rows.length > query.limit
      const page = hasMore ? rows.slice(0, query.limit) : rows
      const records = page.map((row) => this.toRecord(resolved, row))
      const lastRow = page[page.length - 1]
      const last = records[records.length - 1]
      const nextCursor =
        hasMore && last !== undefined && lastRow !== undefined
          ? encodeCursor({
              v: sortKeys.map((k) => lastRow[k.column.split(".").pop() ?? k.column] ?? null),
              id: last.id,
            })
          : null
      return { records, nextCursor }
      },
      /* 🔴 E-1:view 受 own 限制時,DB 端的 RESTRICTIVE policy 會把別人的記錄濾掉。
         這裡只是把身分與範圍講清楚 —— 就算這行漏了,policy 仍是 fail-closed。 */
      { actorId, own: policy?.isScopedToOwn?.(formId, "view") === true },
    )
    const enriched = await this.withComputed(
      tenantId,
      formId,
      resolved,
      result.records,
      policy,
      actorId ?? undefined,
    )
    const computed = await this.withFormulas(tenantId, formId, resolved, enriched)
    return {
      records: this.maskRead(resolved, formId, computed, policy),
      nextCursor: result.nextCursor,
    }
  }

  async updateRecord(
    tenantId: number,
    formId: number,
    recordId: number,
    expectedVersion: number,
    values: RecordValues,
    actorId: number,
    policy?: FieldAccessPolicy,
  ): Promise<RecordRow> {
    const resolved = await this.resolveForm(tenantId, formId)
    this.assertWritable(resolved, formId, values, policy)
    await this.inTenantTx(
      tenantId,
      async (trx) => {
        await this.updateOne(trx, tenantId, resolved, recordId, expectedVersion, values, actorId)
      },
      /* 範圍受限時只能改自己的:RESTRICTIVE policy 的 USING 同樣管 UPDATE 的選列 */
      { actorId, own: policy?.isScopedToOwn?.(formId, "edit") === true },
    )
    await this.bindFiles(tenantId, formId, resolved, recordId, values)
    return this.getRecord(tenantId, formId, recordId, policy, actorId)
  }

  async softDeleteRecord(
    tenantId: number,
    formId: number,
    recordId: number,
    actorId: number,
    policy?: FieldAccessPolicy,
  ): Promise<void> {
    const resolved = await this.resolveForm(tenantId, formId)
    await this.inTenantTx(
      tenantId,
      async (trx) => {
        const count = await trx
          .withSchema(DATA_SCHEMA)
          .table(resolved.table)
          .where({ tenant_id: tenantId, id: recordId })
          .whereNull("deleted_at")
          .update({ deleted_at: trx.fn.now(), updated_by: actorId })
        if (count === 0) throw new RecordNotFoundError(recordId)
      },
      { actorId, own: policy?.isScopedToOwn?.(formId, "delete") === true },
    )
  }

  /* A5|header + lines 單一 transaction(ERP 單據骨架):
     全量 diff — 未帶 id 的 line 新增、帶 id 的更新、缺席的 soft-delete;line_no 依序重排。 */
  async saveWithLines(
    tenantId: number,
    parentFormId: number,
    childFormId: number,
    header: {
      id?: number | undefined
      expectedVersion?: number | undefined
      values: RecordValues
    },
    lines: readonly LineInput[],
    actorId: number,
    policy?: FieldAccessPolicy,
  ): Promise<{ header: RecordRow; lines: RecordRow[] }> {
    const parent = await this.resolveForm(tenantId, parentFormId)
    const child = await this.resolveForm(tenantId, childFormId)

    // 欄位級寫白名單:header 依 parentForm、每 line 依 childForm 各自檢查
    this.assertWritable(parent, parentFormId, header.values, policy)
    for (const line of lines) this.assertWritable(child, childFormId, line.values, policy)

    // F-5 M3:tx 內收集各 line 的 id,commit 後統一綁定附件(header + lines)
    const savedLines: { id: number; values: RecordValues }[] = []
    const headerId = await this.inTenantTx(tenantId, async (trx) => {
      let id: number
      if (header.id === undefined) {
        const created = await this.insertOne(
          trx,
          tenantId,
          parent,
          header.values,
          actorId,
          null,
          null,
        )
        id = created.id
      } else {
        id = header.id
        await this.updateOne(
          trx,
          tenantId,
          parent,
          id,
          header.expectedVersion ?? 1,
          header.values,
          actorId,
        )
      }

      // pg 回傳 bigint 為字串 → 一律 Number 正規化再比對
      const existingRows = (await trx
        .withSchema(DATA_SCHEMA)
        .table(child.table)
        .select("id")
        .where({ tenant_id: tenantId, parent_id: id })
        .whereNull("deleted_at")) as { id: number | string }[]
      const existing = existingRows.map((e) => Number(e.id))
      const keptIds = new Set(lines.filter((l) => l.id !== undefined).map((l) => Number(l.id)))
      const removed = existing.filter((e) => !keptIds.has(e))
      if (removed.length > 0) {
        await trx
          .withSchema(DATA_SCHEMA)
          .table(child.table)
          .whereIn("id", removed)
          .where({ tenant_id: tenantId })
          .update({ deleted_at: trx.fn.now(), updated_by: actorId })
      }

      for (const [index, line] of lines.entries()) {
        const lineNo = index + 1
        if (line.id === undefined) {
          const created = await this.insertOne(
            trx,
            tenantId,
            child,
            line.values,
            actorId,
            id,
            lineNo,
          )
          savedLines.push({ id: created.id, values: line.values })
        } else {
          await this.updateOne(trx, tenantId, child, line.id, null, line.values, actorId, lineNo)
          savedLines.push({ id: line.id, values: line.values })
        }
      }
      return id
    })

    await this.bindFiles(tenantId, parentFormId, parent, headerId, header.values)
    for (const line of savedLines) {
      await this.bindFiles(tenantId, childFormId, child, line.id, line.values)
    }

    const headerRecord = await this.getRecord(tenantId, parentFormId, headerId, policy)
    const lineRecords = await this.listRecords(
      tenantId,
      childFormId,
      { filters: [], sort: [], limit: 200 },
      policy,
    )
    return {
      header: headerRecord,
      lines: lineRecords.records
        .filter((r) => r.parentId === headerId)
        .sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0)),
    }
  }

  // ---- internal ----

  /* F-5 M3|記錄存檔後把附件欄的 key 由 pending 轉 bound(已移除者轉 orphaned)。
     刻意於 tx 外呼叫:綁定失敗不回滾已存檔記錄(檔案退回孤兒回收,file-storage §12 S6)。 */
  private async bindFiles(
    tenantId: number,
    formId: number,
    resolved: ResolvedForm,
    recordId: number,
    values: RecordValues,
  ): Promise<void> {
    if (this.files === undefined) return
    const attachmentFields = resolved.fields.filter((f) => f.type === "attachment")
    if (attachmentFields.length === 0) return
    const keys: string[] = []
    for (const field of attachmentFields) {
      const raw = values[field.row.name]
      if (!Array.isArray(raw)) continue
      for (const item of raw) {
        if (typeof item === "object" && item !== null && "key" in item) {
          const key = (item as { key: unknown }).key
          if (typeof key === "string") keys.push(key)
        }
      }
    }
    await this.files.bindToRecord(tenantId, formId, recordId, keys)
  }

  private async resolveForm(tenantId: number, formId: number): Promise<ResolvedForm> {
    const loaded: FormWithFields = await this.metadata.getForm(tenantId, formId)
    if (loaded.form.provisionState !== "ready") {
      throw new FormNotReadyError(formId, loaded.form.provisionState)
    }
    const fields = loaded.fields.map((row) => {
      const type = row.cellValueType as CellValueType
      return {
        row,
        column: physicalColumnName(row.id),
        type,
        /* 🔴 snapshot 模式的 lookup 有物理欄(#113)→ 不是虛擬欄:
           baseQuery 要 select 它,值才讀得到。虛擬與否是**逐欄**的,不是逐型別的。 */
        virtual: fieldType(type).virtual === true && !isSnapshotLookup(row.options),
      }
    })
    // layout 讀時 parse 兜底(DB 竄改/舊版 → 忽略,走無預設)
    const layoutParsed =
      loaded.form.layout === null ? null : layoutSchema.safeParse(loaded.form.layout)
    return {
      table: physicalTableName(loaded.form.id),
      byName: new Map(fields.map((f) => [f.row.name, f])),
      fields,
      isSubtable: loaded.form.parentFormId !== null,
      layout: layoutParsed?.success ? layoutParsed.data : null,
    }
  }

  /* R1·UP-3 套用 layout 之 create-time 預設值:未給值且非 systemManaged 之欄,依 defaultValue 填。
     只在 create 呼叫(不覆蓋使用者提供的值);$USERNAME 需查 users(lazy)。 */
  private async applyDefaults(
    resolved: ResolvedForm,
    values: RecordValues,
    actorId: number,
  ): Promise<RecordValues> {
    const layout = resolved.layout
    if (layout === null) return values
    const entries = Object.entries(layout.fields).filter(([, fl]) => fl.defaultValue !== undefined)
    if (entries.length === 0) return values
    const needsUser = entries.some(
      ([, fl]) => fl.defaultValue !== undefined && defaultNeedsUserName(fl.defaultValue),
    )
    const userName = needsUser ? await this.metadata.getUserName(actorId) : null
    const ctx = { actorId, userName, now: new Date() }
    const out: RecordValues = { ...values }
    for (const [fieldIdStr, fl] of entries) {
      if (fl.defaultValue === undefined) continue
      const fieldId = Number(fieldIdStr)
      const field = resolved.fields.find((f) => f.row.id === fieldId)
      if (field === undefined || fieldType(field.type).systemManaged) continue
      if (out[field.row.name] !== undefined) continue // 使用者已提供 → 不套預設
      const resolvedVal = resolveDefaultValue(fl.defaultValue, ctx)
      if (resolvedVal !== undefined) out[field.row.name] = resolvedVal
    }
    return out
  }

  private baseQuery(db: Knex, tenantId: number, resolved: ResolvedForm): Knex.QueryBuilder {
    return db
      .withSchema(DATA_SCHEMA)
      .table(resolved.table)
      .select([
        `${resolved.table}.id`,
        `${resolved.table}.version`,
        `${resolved.table}.created_at`,
        `${resolved.table}.created_by`,
        `${resolved.table}.updated_at`,
        `${resolved.table}.updated_by`,
        ...(resolved.isSubtable
          ? [`${resolved.table}.parent_id`, `${resolved.table}.line_no`]
          : []),
        // 虛擬欄(系統欄/lookup/rollup)無物理欄 → 不 select(值於 withComputed 讀時注入)
        ...resolved.fields.filter((f) => !f.virtual).map((f) => `${resolved.table}.${f.column}`),
      ])
      .where(`${resolved.table}.tenant_id`, tenantId)
      .whereNull(`${resolved.table}.deleted_at`)
  }

  private async insertOne(
    trx: Knex.Transaction,
    tenantId: number,
    resolved: ResolvedForm,
    values: RecordValues,
    actorId: number,
    parentId: number | null,
    lineNo: number | null,
  ): Promise<RecordRow> {
    const columns = await this.validateValues(trx, tenantId, resolved, values, "create")
    const insert: Record<string, unknown> = {
      tenant_id: tenantId,
      created_by: actorId,
      updated_by: actorId,
      ...columns,
    }
    if (parentId !== null) {
      insert.parent_id = parentId
      insert.line_no = lineNo
    }
    const rows = (await trx
      .withSchema(DATA_SCHEMA)
      .table(resolved.table)
      .insert(insert)
      .returning("*")) as Record<string, unknown>[]
    const row = rows[0]
    if (row === undefined) throw new Error("insert returned no row")
    return this.toRecord(resolved, row)
  }

  private async updateOne(
    trx: Knex.Transaction,
    tenantId: number,
    resolved: ResolvedForm,
    recordId: number,
    expectedVersion: number | null,
    values: RecordValues,
    actorId: number,
    lineNo?: number,
  ): Promise<void> {
    const columns = await this.validateValues(trx, tenantId, resolved, values, "update")
    let builder = trx
      .withSchema(DATA_SCHEMA)
      .table(resolved.table)
      .where({ tenant_id: tenantId, id: recordId })
      .whereNull("deleted_at")
    if (expectedVersion !== null) builder = builder.where("version", expectedVersion)
    const update: Record<string, unknown> = {
      ...columns,
      version: trx.raw("version + 1"),
      updated_at: trx.fn.now(),
      updated_by: actorId,
    }
    if (lineNo !== undefined) update.line_no = lineNo
    const count = await builder.update(update)
    if (count === 0) {
      const exists = await trx
        .withSchema(DATA_SCHEMA)
        .table(resolved.table)
        .where({ tenant_id: tenantId, id: recordId })
        .whereNull("deleted_at")
        .first()
      if (exists === undefined) throw new RecordNotFoundError(recordId)
      throw new VersionConflictError(recordId, expectedVersion ?? -1)
    }
  }

  /* 值驗證:name whitelist → systemManaged 拒寫 → 空值正規化 → required → 型別 Zod → DB 值轉換 */
  private async validateValues(
    trx: Knex.Transaction,
    tenantId: number,
    resolved: ResolvedForm,
    values: RecordValues,
    mode: "create" | "update",
  ): Promise<Record<string, unknown>> {
    const columns: Record<string, unknown> = {}
    for (const [name, raw] of Object.entries(values)) {
      const field = resolved.byName.get(name)
      if (field === undefined) throw new UnknownFieldError(name)
      const definition = fieldType(field.type)
      if (definition.systemManaged) throw new SystemManagedFieldError(name)
      const value = normalizeEmpty(raw)
      if (value === null) {
        if (field.row.required) throw new RequiredFieldError(name)
        columns[field.column] = null
        continue
      }
      const parsed = definition
        .valueSchema(field.row.options as Record<string, unknown>)
        .safeParse(value)
      if (!parsed.success) {
        throw new FieldValueError(name, z.prettifyError(parsed.error))
      }
      columns[field.column] = this.toDbValue(field.type, parsed.data)
    }

    /* 🔴 #113 快照帶入:link 欄本次被寫到時,把來源當下的值固化進本表的物理欄。
       之後主檔怎麼改都不動這張單據 —— 這是 Ragic / FileMaker / Dataverse 的預設語意,
       理由是失敗不對稱:live 出錯會**靜默改寫歷史單據且不可回復**,snapshot 出錯只是看到舊值,
       按一下重整就好(field-types-parity.md §0-ter A-5)。 */
    const snapshotLookups = resolved.fields.filter(
      (f) => f.type === "lookup" && isSnapshotLookup(f.row.options),
    )
    for (const lf of snapshotLookups) {
      const opts = lf.row.options as { linkFieldName?: string; targetFieldName?: string }
      const linkField = opts.linkFieldName ? resolved.byName.get(opts.linkFieldName) : undefined
      if (linkField === undefined || opts.targetFieldName === undefined) continue
      // 只在 link 欄本次有被寫到時重取 —— 否則每次存檔都會把快照刷成最新,等同 live
      if (!(linkField.column in columns)) continue
      const linkedId = toId(columns[linkField.column])
      if (linkedId === undefined) {
        columns[lf.column] = null
        continue
      }
      const targetFormId = (linkField.row.options as { targetFormId?: number }).targetFormId
      if (targetFormId === undefined) continue
      const targets = await this.getRecordsByIds(tenantId, targetFormId, [linkedId])
      const value = targets.get(linkedId)?.values[opts.targetFieldName]
      columns[lf.column] = value === undefined || value === null ? null : String(value)
    }

    /* 🔴 E-1 指派同步(#96):勾了 grantsAccess 的 member 欄 → 系統欄 assignees。
       **單一同步點** —— RLS policy 只讀 assignees,若各處各自維護必然漂移。
       欄位被清空時 assignees 也要跟著清,否則權限會留在被移除的人身上。 */
    const grantFields = resolved.fields.filter(
      (f) =>
        f.type === "member" &&
        (f.row.options as { grantsAccess?: boolean }).grantsAccess === true,
    )
    if (grantFields.length > 0) {
      const ids = grantFields
        .map((f) => columns[f.column])
        .filter((v): v is number => typeof v === "number")
      /* 只在本次有動到任一指派欄時才寫 —— 否則部分更新會把既有指派清掉 */
      const touched = grantFields.some((f) => f.column in columns)
      if (touched) columns.assignees = ids.length > 0 ? ids : null
    }

    if (mode === "create") {
      for (const field of resolved.fields) {
        const definition = fieldType(field.type)
        if (
          field.row.required &&
          !definition.systemManaged &&
          columns[field.column] === undefined
        ) {
          throw new RequiredFieldError(field.row.name)
        }
        if (field.type === "autoNumber") {
          columns[field.column] = await this.nextAutoNumber(trx, tenantId, field, values)
        }
      }
    }
    return columns
  }

  /* autoNumber:無 dateFormat 且 resetScope=none → 全域 PG sequence(向後相容);
     否則走 counter table(依 reset_key,支援日期段 + 群組重設,R1·UP-4 M2)。 */
  private async nextAutoNumber(
    trx: Knex.Transaction,
    tenantId: number,
    field: ResolvedField,
    values: RecordValues,
  ): Promise<string> {
    const options = field.row.options as AutoNumberOptions
    const width = options.width ?? 4
    const prefix = options.prefix ?? ""
    const patterned = options.dateFormat !== undefined || (options.resetScope ?? "none") !== "none"

    if (!patterned) {
      const seq = sequenceName(field.row.id)
      const result = (await trx.raw("SELECT nextval(?) AS n", [`${DATA_SCHEMA}.${seq}`])) as {
        rows: { n: string }[]
      }
      const n = result.rows[0]?.n ?? "0"
      return `${prefix}${n.padStart(width, "0")}`
    }

    const now = new Date()
    const timeZone = await this.tenantTimeZone(trx, tenantId)
    const resetKey = computeResetKey(options, values, now, timeZone)
    const res = (await trx.raw(
      `INSERT INTO public.autonumber_counter (field_id, tenant_id, reset_key, value)
       VALUES (?, ?, ?, 1)
       ON CONFLICT (field_id, reset_key) DO UPDATE SET value = autonumber_counter.value + 1
       RETURNING value`,
      [field.row.id, tenantId, resetKey],
    )) as { rows: { value: string }[] }
    const seq = Number(res.rows[0]?.value ?? "0")
    const datePart =
      options.dateFormat === undefined ? "" : formatDatePart(options.dateFormat, now, timeZone)
    return `${prefix}${datePart}${String(seq).padStart(width, "0")}`
  }

  /* 只在有「帶日期段/會歸零」的 autoNumber 欄時才查(一般記錄寫入不付這個成本)。
     weyver_app 對 tenants 有 SELECT(0003_app_role_grants)。 */
  private async tenantTimeZone(trx: Knex.Transaction, tenantId: number): Promise<string> {
    const res = (await trx.raw("SELECT timezone FROM public.tenants WHERE id = ?", [tenantId])) as {
      rows: { timezone: string }[]
    }
    return res.rows[0]?.timezone ?? "Asia/Taipei"
  }

  /* jsonb 欄需顯式序列化(pg driver 不會把 JS 陣列當 JSON 送)。
     以 dbFieldType 判定而非列舉型別名 —— 日後新增 jsonb 欄型自動涵蓋
     (R1·UP-4b 之 image/signature 即因原本硬編 "attachment" 而漏,已由此修正)。 */
  private toDbValue(type: CellValueType, value: unknown): unknown {
    return fieldType(type).dbFieldType === "jsonb" ? JSON.stringify(value) : value
  }

  private applyFilter(
    builder: Knex.QueryBuilder,
    resolved: ResolvedForm,
    filter: { field: string; op: string; value?: unknown },
  ): Knex.QueryBuilder {
    const field = resolved.byName.get(filter.field)
    if (field === undefined) throw new UnknownFieldError(filter.field)
    const definition = fieldType(field.type)
    if (!definition.filterOperators.includes(filter.op as never)) {
      throw new InvalidFilterError(`operator ${filter.op} not allowed for type ${field.type}`)
    }
    const column = field.column

    switch (filter.op) {
      case "isEmpty":
        return builder.whereNull(column)
      case "isNotEmpty":
        return builder.whereNotNull(column)
      case "contains": {
        if (typeof filter.value !== "string") {
          throw new InvalidFilterError("contains requires a string value")
        }
        return builder.whereILike(column, `%${escapeLike(filter.value)}%`)
      }
      case "anyOf": {
        if (!Array.isArray(filter.value) || filter.value.length === 0) {
          throw new InvalidFilterError("anyOf requires a non-empty array value")
        }
        if (field.type === "multiSelect") {
          // text[] overlap;值經參數綁定
          return builder.whereRaw("?? && ?::text[]", [column, filter.value])
        }
        return builder.whereIn(column, filter.value as string[])
      }
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const parsed = definition
          .valueSchema(field.row.options as Record<string, unknown>)
          .safeParse(filter.value)
        if (!parsed.success) {
          throw new InvalidFilterError(`value does not match field type ${field.type}`)
        }
        const op = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.op]
        return builder.where(column, op, parsed.data as string)
      }
      default:
        throw new InvalidFilterError(`unsupported operator ${filter.op}`)
    }
  }

  private toRecord(resolved: ResolvedForm, row: Record<string, unknown>): RecordRow {
    const values: RecordValues = {}
    for (const field of resolved.fields) {
      values[field.row.name] = row[field.column] ?? null
    }
    return {
      id: Number(row.id),
      version: Number(row.version),
      createdAt: row.created_at as Date,
      createdBy: Number(row.created_by),
      updatedAt: row.updated_at as Date,
      updatedBy: Number(row.updated_by),
      parentId:
        row.parent_id === undefined || row.parent_id === null ? null : Number(row.parent_id),
      lineNo: row.line_no === undefined || row.line_no === null ? null : Number(row.line_no),
      values,
    }
  }

  /* 🔴 追溯稽核:**隱藏欄不得出現在 WHERE / ORDER BY / 搜尋**。

     「查完再遮」只擋得住**回傳值**,擋不住**用查詢反推值**:
     - 篩選 `金額 > 100000` → 由回傳筆數即可二分逼近他人薪資
     - 排序 `ORDER BY 金額` → 由列序推出大小關係
     - 快速搜尋跨全部 text 欄 → 輸入值即可測知該值是否存在於隱藏欄

     此為業界重複發生的一整類漏洞:Salesforce `WITH SECURITY_ENFORCED` 官方明載
     **只檢查 SELECT/FROM,不含 WHERE 與 ORDER BY**;Odoo 亦有多個相關 CVE。
     正解是**在 query builder 層就拒絕**,而非查完才遮。 */
  private assertReadable(
    resolved: ResolvedForm,
    formId: number,
    fieldName: string,
    policy?: FieldAccessPolicy,
  ): void {
    if (policy === undefined) return
    const field = resolved.byName.get(fieldName)
    if (field === undefined) return
    if (policy.fieldVisibility(field.row.id, formId) === "hidden") {
      throw new FieldForbiddenError(fieldName)
    }
  }

  /* P0-4a M4|欄位級讀遮罩:移除該角色不可見(hidden)欄 → 回應不含其值(後端不回,非前端隱藏)。
     policy 缺省(既有 service 呼叫 / dev 未帶)= 不遮罩。 */
  private maskRead(
    resolved: ResolvedForm,
    formId: number,
    records: readonly RecordRow[],
    policy?: FieldAccessPolicy,
  ): RecordRow[] {
    if (policy === undefined) return [...records]
    const hidden = resolved.fields
      .filter((f) => policy.fieldVisibility(f.row.id, formId) === "hidden")
      .map((f) => f.row.name)
    if (hidden.length === 0) return [...records]
    return records.map((record) => {
      const values = { ...record.values }
      for (const name of hidden) delete values[name]
      return { ...record, values }
    })
  }

  /* P0-4a M4|欄位級寫白名單:提供的欄若非 write 權 → FieldForbiddenError(擋每角色動態 mass-assignment)。
     未知欄不在此攔(交 validateValues 處理);policy 缺省 = 不檢查。 */
  private assertWritable(
    resolved: ResolvedForm,
    formId: number,
    values: RecordValues,
    policy?: FieldAccessPolicy,
  ): void {
    if (policy === undefined) return
    for (const name of Object.keys(values)) {
      const field = resolved.byName.get(name)
      if (field === undefined) continue
      if (policy.fieldVisibility(field.row.id, formId) !== "write") {
        throw new FieldForbiddenError(name)
      }
    }
  }
}
