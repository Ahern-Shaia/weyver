import {
  canManageForm,
  canReadForm,
  canWriteForm,
  clampFieldToForm,
  type FieldVisibility,
  type FormLevel,
  formLevelToDefaultFieldVisibility,
  maxFieldVisibility,
  maxFormLevel,
} from "./authz-model.js"
import type { FieldPermissionRow, FormPermissionRow } from "./authz.repository.js"

/* 欄位級授權策略(RecordService M4 依此遮罩讀 / 白名單寫;EffectivePermissions 結構相容)。
   解耦:form-engine 只依賴此窄介面,不綁整個 EffectivePermissions。 */
export interface FieldAccessPolicy {
  fieldVisibility(fieldId: number, formId: number): FieldVisibility
}

/* 一名 actor 對某租戶的有效權限(deny-by-default)。由角色閉包的原始權限列聚合而成(純函數 build)。
   admin 系統角色 → 全租戶 manage(OQ-5 特判,不查每表)。docs/modules/R1/authz.md §5.1。 */
export class EffectivePermissions {
  constructor(
    readonly isAdmin: boolean,
    private readonly forms: ReadonlyMap<number, FormLevel>,
    private readonly fields: ReadonlyMap<number, FieldVisibility>,
  ) {}

  formLevel(formId: number): FormLevel {
    if (this.isAdmin) return "manage"
    return this.forms.get(formId) ?? "none"
  }

  canRead(formId: number): boolean {
    return canReadForm(this.formLevel(formId))
  }
  canWrite(formId: number): boolean {
    return canWriteForm(this.formLevel(formId))
  }
  canManage(formId: number): boolean {
    return canManageForm(this.formLevel(formId))
  }

  /* 欄位有效可見性:欄位缺列 → 繼承表單級;有列 → 收斂於表單級(交集,較嚴者勝)。admin → 全 write。 */
  fieldVisibility(fieldId: number, formId: number): FieldVisibility {
    if (this.isAdmin) return "write"
    const form = this.formLevel(formId)
    const raw = this.fields.get(fieldId) ?? formLevelToDefaultFieldVisibility(form)
    return clampFieldToForm(raw, form)
  }

  /* 過濾一組表單 id,只留可讀者(list 端點用)。admin 全留。 */
  readableFormIds(candidateFormIds: readonly number[]): number[] {
    return candidateFormIds.filter((id) => this.canRead(id))
  }
}

/* 純聚合:角色閉包的原始權限列 → 有效權限。多角色/祖先取聯集(較寬鬆)。 */
export function buildEffectivePermissions(
  isAdmin: boolean,
  formRows: readonly FormPermissionRow[],
  fieldRows: readonly FieldPermissionRow[],
): EffectivePermissions {
  const forms = new Map<number, FormLevel>()
  for (const p of formRows) {
    forms.set(p.formId, maxFormLevel(forms.get(p.formId) ?? "none", p.level))
  }
  const fields = new Map<number, FieldVisibility>()
  for (const p of fieldRows) {
    fields.set(p.fieldId, maxFieldVisibility(fields.get(p.fieldId) ?? "hidden", p.visibility))
  }
  return new EffectivePermissions(isAdmin, forms, fields)
}
