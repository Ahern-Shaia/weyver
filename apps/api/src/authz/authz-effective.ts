import {
  clampFieldToForm,
  defaultFieldVisibility,
  type FieldVisibility,
  type FormAction,
  FORM_ACTIONS,
  maxFieldVisibility,
} from "./authz-model.js"
import type { FieldPermissionRow, FormPermissionRow } from "./authz.repository.js"

/* 欄位級授權策略(RecordService M4 依此遮罩讀 / 白名單寫;EffectivePermissions 結構相容)。 */
export interface FieldAccessPolicy {
  fieldVisibility(fieldId: number, formId: number): FieldVisibility
}

/* 一名 actor 對某租戶的有效權限(deny-by-default)。表單存取=動作集(M7)。
   admin 系統角色 → 全動作(OQ-5 特判,不查每表)。docs/modules/R1/authz.md §5.1。 */
export class EffectivePermissions {
  private readonly allActions: ReadonlySet<FormAction> = new Set(FORM_ACTIONS)

  constructor(
    readonly isAdmin: boolean,
    private readonly forms: ReadonlyMap<number, ReadonlySet<FormAction>>,
    private readonly fields: ReadonlyMap<number, FieldVisibility>,
  ) {}

  formActions(formId: number): ReadonlySet<FormAction> {
    if (this.isAdmin) return this.allActions
    return this.forms.get(formId) ?? EMPTY_ACTIONS
  }

  hasAction(formId: number, action: FormAction): boolean {
    return this.formActions(formId).has(action)
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

  /* 過濾一組表單 id,只留可讀(有 view)者(list 端點用)。admin 全留。 */
  readableFormIds(candidateFormIds: readonly number[]): number[] {
    return candidateFormIds.filter((id) => this.canRead(id))
  }
}

const EMPTY_ACTIONS: ReadonlySet<FormAction> = new Set()

/* 純聚合:角色閉包的原始權限列 → 有效權限。表單動作取聯集、欄位可見性取聯集(皆較寬鬆)。 */
export function buildEffectivePermissions(
  isAdmin: boolean,
  formRows: readonly FormPermissionRow[],
  fieldRows: readonly FieldPermissionRow[],
): EffectivePermissions {
  const forms = new Map<number, Set<FormAction>>()
  for (const row of formRows) {
    const set = forms.get(row.formId) ?? new Set<FormAction>()
    for (const action of row.actions) set.add(action)
    forms.set(row.formId, set)
  }
  const fields = new Map<number, FieldVisibility>()
  for (const row of fieldRows) {
    fields.set(row.fieldId, maxFieldVisibility(fields.get(row.fieldId) ?? "hidden", row.visibility))
  }
  return new EffectivePermissions(isAdmin, forms, fields)
}
