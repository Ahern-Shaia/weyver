/* P0-4a authz 純邏輯(無 I/O,單元可測)。M7:表單存取由單一級別 → 動作集(更細粒度)。
   欄位級仍為 hidden/read/write,但收斂於表單「動作集」(有無 view/edit)。docs/modules/R1/authz.md §4/§5。 */

/* 表單動作(每角色 × 每表單授予一組)。view 為基礎;design=可改表單結構(原 4 級之 manage)。
   approve/export 為前瞻旗標(對應端點於後續 workflow/報表模組落地時 enforce)。 */
export const FORM_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
  "design",
] as const
export type FormAction = (typeof FORM_ACTIONS)[number]

/* owner 短路授予之動作(OQ-ARI-4=B):全部資料動作,design(改結構)除外 —— 用資料 ≠ 改結構。 */
export const DATA_ACTIONS: readonly FormAction[] = FORM_ACTIONS.filter((a) => a !== "design")

export const FIELD_VISIBILITIES = ["hidden", "read", "write"] as const
export type FieldVisibility = (typeof FIELD_VISIBILITIES)[number]

const FIELD_VIS_RANK: Record<FieldVisibility, number> = { hidden: 0, read: 1, write: 2 }

export function isFormAction(value: string): value is FormAction {
  return (FORM_ACTIONS as readonly string[]).includes(value)
}

/* 多角色 / 祖先繼承 → 動作集聯集(較寬鬆) */
export function unionActions(a: Iterable<FormAction>, b: Iterable<FormAction>): Set<FormAction> {
  return new Set<FormAction>([...a, ...b])
}

/* 欄位級可見性聯集(較寬鬆) */
export function maxFieldVisibility(a: FieldVisibility, b: FieldVisibility): FieldVisibility {
  return FIELD_VIS_RANK[a] >= FIELD_VIS_RANK[b] ? a : b
}

/* 表單動作集 → 該表欄位預設可見性(欄位缺列時繼承):
   無 view → hidden;有 edit/create → write(可寫);僅 view → read。 */
export function defaultFieldVisibility(actions: ReadonlySet<FormAction>): FieldVisibility {
  if (!actions.has("view")) return "hidden"
  return actions.has("edit") || actions.has("create") ? "write" : "read"
}

/* 欄位級收斂於表單動作集(交集,較嚴者勝):表單無寫動作 → 欄位頂多 read;無 view → hidden。 */
export function clampFieldToForm(
  vis: FieldVisibility,
  actions: ReadonlySet<FormAction>,
): FieldVisibility {
  const ceiling = defaultFieldVisibility(actions)
  return FIELD_VIS_RANK[vis] <= FIELD_VIS_RANK[ceiling] ? vis : ceiling
}

/* HTTP 方法 → 該路由所需動作(decorator 未覆寫時的預設)。
   GET/HEAD=view;POST=create;PATCH=edit;DELETE=delete。設計器/核准/匯出由 decorator 明指。 */
export function requiredActionForMethod(method: string): FormAction {
  switch (method) {
    case "POST":
      return "create"
    case "PATCH":
    case "PUT":
      return "edit"
    case "DELETE":
      return "delete"
    default:
      return "view"
  }
}
