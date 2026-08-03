import type { FormAction } from "./authz"

/* 🔴 authz 0-bis 項 7|**動作集是對的底層,錯在直接曝露給行政人員**。

   一手依據(該節逐字)|SharePoint 是兩者並用的教科書:33 個細粒度 permission,
   組成 `View Only < Read < Contribute < Edit < Design < Full Control` 的**有序預設**;
   Jira 按受眾複雜度分流(team-managed 固定三角色,company-managed 才細粒度);
   Salesforce 分層並用(物件層動作集、記錄層有序)。

   我方客戶是**行政兼職**,理解成本才是瓶頸 —— 七個獨立勾選框要求他自己推導
   「填單者需不需要 view」這種問題,而那個推導本來就不該外包給他。

   ⚠️ 這裡**不新增權限模型**,只是動作集的具名組合。
   底層仍是 `FORM_ACTIONS` 的集合,「自訂」隨時可展開逐項勾。 */

export interface PermissionPreset {
  readonly key: string
  readonly name: string
  readonly actions: readonly FormAction[]
}

/* 由窄到寬排序(SharePoint 形態的有序預設)。
   `design` 刻意只在「設計者」出現 —— 用資料 ≠ 改結構(OQ-ARI-4=B 同一條原則)。 */
export const PERMISSION_PRESETS: readonly PermissionPreset[] = [
  { key: "viewer", name: "檢視者", actions: ["view"] },
  /* 填單者能新增但**不能改別人已建的**;edit 要另外給,這是最常被誤設的一格 */
  { key: "submitter", name: "填單者", actions: ["view", "create"] },
  { key: "editor", name: "編輯者", actions: ["view", "create", "edit", "export"] },
  { key: "approver", name: "核准者", actions: ["view", "create", "edit", "export", "approve"] },
  {
    key: "designer",
    name: "設計者",
    actions: ["view", "create", "edit", "delete", "export", "approve", "design"],
  },
]

function sameSet(a: readonly FormAction[], b: ReadonlySet<FormAction>): boolean {
  return a.length === b.size && a.every((x) => b.has(x))
}

/* 目前這組動作剛好等於哪個具名預設?不等於任何一個 → `null`(UI 顯示「自訂」)。
 **不做「最接近」的模糊比對** —— 把「檢視者 + 匯出」講成「檢視者」是謊報權限。 */
export function presetOf(actions: ReadonlySet<FormAction>): PermissionPreset | null {
  return PERMISSION_PRESETS.find((p) => sameSet(p.actions, actions)) ?? null
}
