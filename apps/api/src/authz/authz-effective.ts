import {
  DATA_ACTIONS,
  FORM_ACTIONS,
  type FieldVisibility,
  type FormAction,
  clampFieldToForm,
  defaultFieldVisibility,
  maxFieldVisibility,
} from "./authz-model.js"
import type {
  CategoryPermissionRow,
  FieldPermissionRow,
  FormMetaRow,
  FormPermissionRow,
} from "./authz.repository.js"

/* 欄位級授權策略(RecordService M4 依此遮罩讀 / 白名單寫;EffectivePermissions 結構相容)。 */
export interface FieldAccessPolicy {
  fieldVisibility(fieldId: number, formId: number): FieldVisibility
  /* E-1 記錄範圍(#96)。optional —— 既有以純 FieldAccessPolicy 呼叫的測試不受影響。 */
  isScopedToOwn?(formId: number, action: FormAction): boolean
  /* 🔴 lookup 越權(FMEA D3):帶入值來自**另一張表**,必須以讀取者對該表的權限判斷,
     否則沒有客戶主檔權限的人可以透過訂單上的帶入欄把客戶資料整批讀出來。 */
  canRead?(formId: number): boolean
}

/* 清單三態(OQ-ARI-8=折衷):可讀完整 / 非敏感無權=鎖定 stub(顯示+申請)/ 敏感無權=隱藏(不入任一)。 */
export interface ListableForms {
  readonly readable: number[]
  readonly locked: number[]
}

/* 一名 actor 對某租戶的有效權限(deny-by-default;P0-4a·uplift 資源軸繼承)。
   非 admin 之表單有效動作於 build 時分層解析完成(owner → 覆寫 → 分類繼承 → 預設 profile),
   本物件僅做查表。admin → 全動作特判。docs/modules/R1/authz-resource-inheritance.md §5.1。 */
export class EffectivePermissions {
  private readonly allActions: ReadonlySet<FormAction> = new Set(FORM_ACTIONS)

  constructor(
    readonly isAdmin: boolean,
    private readonly forms: ReadonlyMap<number, ReadonlySet<FormAction>>,
    private readonly fields: ReadonlyMap<number, FieldVisibility>,
    private readonly sensitiveForms: ReadonlySet<number>,
    /* 🔴 E-1 記錄範圍(#96):受 own 限制的動作集(表單 × 動作)。
       範圍是**動作的正交維度**,故與 forms 分開存,不併進 actions 集合。 */
    private readonly scoped: ReadonlyMap<number, ReadonlySet<FormAction>> = new Map(),
  ) {}

  /* 這個動作在這張表上是否只限「自己的」記錄。
     admin 恆為 all —— 管理員看不到全部的話,沒有人能稽核。
     多角色時**取寬**:任一角色給了 all 就是 all(deny-by-default 只適用於「有沒有這個動作」,
     範圍是已授予動作的修飾,不該因為多一個受限角色而被收緊)。 */
  isScopedToOwn(formId: number, action: FormAction): boolean {
    if (this.isAdmin) return false
    return this.scoped.get(formId)?.has(action) ?? false
  }

  formActions(formId: number): ReadonlySet<FormAction> {
    if (this.isAdmin) return this.allActions
    return this.forms.get(formId) ?? EMPTY_ACTIONS
  }

  hasAction(formId: number, action: FormAction): boolean {
    return this.formActions(formId).has(action)
  }

  /* 🔴 給 `/api/authz/me` 序列化用。**admin 回空物件**(而非把全租戶表單展開)——
     admin 的 `isAdmin: true` 已經表達了一切,展開只會讓回應大小隨表單數線性成長,
     且會把「這個租戶有哪些表」洩漏在一個不需要那份資訊的端點裡。 */
  toFormActionMap(): Record<string, FormAction[]> {
    if (this.isAdmin) return {}
    const out: Record<string, FormAction[]> = {}
    for (const [formId, actions] of this.forms) out[String(formId)] = [...actions]
    return out
  }

  canRead(formId: number): boolean {
    return this.hasAction(formId, "view")
  }
  canManage(formId: number): boolean {
    return this.hasAction(formId, "design")
  }

  /* 欄位有效可見性:欄位缺列 → 繼承表單動作集預設;有列 → 收斂於表單動作集。admin → 全 write。 */
  fieldVisibility(fieldId: number, formId: number): FieldVisibility {
    if (this.isAdmin) return "write"
    const actions = this.formActions(formId)
    const raw = this.fields.get(fieldId) ?? defaultFieldVisibility(actions)
    return clampFieldToForm(raw, actions)
  }

  /* 過濾一組表單 id,只留可讀(有 view)者(舊 list 端點用)。admin 全留。 */
  readableFormIds(candidateFormIds: readonly number[]): number[] {
    return candidateFormIds.filter((id) => this.canRead(id))
  }

  /* 清單三態(OQ-ARI-8):可讀 / 鎖定(非敏感無權)/ 隱藏(敏感無權,不回傳)。admin 全可讀。 */
  listableForms(candidateFormIds: readonly number[]): ListableForms {
    const readable: number[] = []
    const locked: number[] = []
    for (const id of candidateFormIds) {
      if (this.canRead(id)) readable.push(id)
      else if (!this.sensitiveForms.has(id)) locked.push(id)
      // 敏感且無權 → 隱藏(不洩漏存在,守 authz.md G4)
    }
    return { readable, locked }
  }
}

const EMPTY_ACTIONS: ReadonlySet<FormAction> = new Set()

/* admin 有效權限(全動作特判;不需 formMeta)。superadmin(dev)與系統 admin 共用。 */
export function adminPermissions(): EffectivePermissions {
  return new EffectivePermissions(true, new Map(), new Map(), new Set())
}

export interface EffectivePermissionsInput {
  readonly isAdmin: boolean
  readonly actorId: number | null
  readonly roleIds: readonly number[]
  /* 覆寫層(角色 × 表單,絕對集) */
  readonly formRows: readonly FormPermissionRow[]
  /* 繼承層(角色 × 分類) */
  readonly categoryRows: readonly CategoryPermissionRow[]
  readonly fieldRows: readonly FieldPermissionRow[]
  /* 全租戶表單 metadata(分類 / 敏感 / owner);解析所有候選表單需之 */
  readonly formMeta: readonly FormMetaRow[]
  /* 租戶預設 profile(未分類/無授權之非敏感表 baseline;可空) */
  readonly defaultActions: readonly FormAction[]
}

/* 分層解析(owner → 覆寫 → 分類繼承 → 預設):每角色各自解析其層級來源,再跨角色聯集(較寬鬆勝)。
   owner 短路(actor 級)得資料動作,design 除外(OQ-4=B);敏感表跳過繼承與預設(OQ-5)。 */
export function buildEffectivePermissions(input: EffectivePermissionsInput): EffectivePermissions {
  if (input.isAdmin) return adminPermissions()

  const overrideIdx = indexByFormRole(input.formRows)
  const categoryIdx = indexByCategoryRole(input.categoryRows)
  const defaults = new Set(input.defaultActions)

  const forms = new Map<number, Set<FormAction>>()
  const sensitiveForms = new Set<number>()

  for (const meta of input.formMeta) {
    if (meta.isSensitive) sensitiveForms.add(meta.formId)

    const resolved = new Set<FormAction>()
    if (input.actorId !== null && meta.createdBy === input.actorId) {
      // 層 1 owner 短路:資料動作,design 除外
      for (const a of DATA_ACTIONS) resolved.add(a)
    } else {
      const overrideByRole = overrideIdx.get(meta.formId)
      const catByRole =
        !meta.isSensitive && meta.categoryId !== null ? categoryIdx.get(meta.categoryId) : undefined
      for (const roleId of input.roleIds) {
        const override = overrideByRole?.get(roleId)
        if (override && override.size > 0) {
          for (const a of override) resolved.add(a) // 層 2 覆寫(絕對集)優先於繼承
          continue
        }
        const inherited = catByRole?.get(roleId) // 層 3 分類繼承
        if (inherited) for (const a of inherited) resolved.add(a)
      }
      if (resolved.size === 0 && !meta.isSensitive) {
        for (const a of defaults) resolved.add(a) // 層 4 預設 profile(非敏感)
      }
    }
    if (resolved.size > 0) forms.set(meta.formId, resolved)
  }

  const fields = new Map<number, FieldVisibility>()
  for (const row of input.fieldRows) {
    fields.set(row.fieldId, maxFieldVisibility(fields.get(row.fieldId) ?? "hidden", row.visibility))
  }

  /* 🔴 E-1 記錄範圍(#96)。**取交集不是聯集**:某動作要受 own 限制,
     必須**所有**給了該動作的角色都標記它受限 —— 只要有一個角色給了 all,
     就是 all。範圍是已授予動作的修飾,不該因為多一個受限角色而被收緊。
     owner 短路(層 1)給的動作恆為 all,不受此限。 */
  const scoped = new Map<number, Set<FormAction>>()
  for (const row of input.formRows) {
    const granting = input.formRows.filter(
      (r) => r.formId === row.formId && input.roleIds.includes(r.roleId),
    )
    const set = new Set<FormAction>()
    for (const action of row.scopedActions) {
      const allScoped = granting
        .filter((r) => r.actions.includes(action))
        .every((r) => r.scopedActions.includes(action))
      if (allScoped) set.add(action)
    }
    if (set.size > 0) scoped.set(row.formId, set)
  }

  return new EffectivePermissions(false, forms, fields, sensitiveForms, scoped)
}

function indexByFormRole(
  rows: readonly FormPermissionRow[],
): Map<number, Map<number, Set<FormAction>>> {
  const idx = new Map<number, Map<number, Set<FormAction>>>()
  for (const row of rows) {
    let byRole = idx.get(row.formId)
    if (!byRole) {
      byRole = new Map()
      idx.set(row.formId, byRole)
    }
    byRole.set(row.roleId, new Set(row.actions))
  }
  return idx
}

function indexByCategoryRole(
  rows: readonly CategoryPermissionRow[],
): Map<number, Map<number, Set<FormAction>>> {
  const idx = new Map<number, Map<number, Set<FormAction>>>()
  for (const row of rows) {
    let byRole = idx.get(row.categoryId)
    if (!byRole) {
      byRole = new Map()
      idx.set(row.categoryId, byRole)
    }
    byRole.set(row.roleId, new Set(row.actions))
  }
  return idx
}
