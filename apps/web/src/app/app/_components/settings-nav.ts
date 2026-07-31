import {
  BellRing,
  Building2,
  KeyRound,
  ShieldCheck,
  Share2,
  Trash2,
  UserRound,
  Webhook,
  type LucideIcon,
} from "lucide-react"

/* R1·UX-1 M2|設定中心(S22)之單一定義。

   三處消費:左側導覽(單一「設定」入口)· `/app/settings` hub 頁 · ⌘K 命令面板。
   分散列舉會讓 ⌘K 漏項 —— 收斂前 ⌘K 只涵蓋「權限」一項,其餘五項搜不到;
   若當時就把六項收進 hub,那五項會同時失去「一次點擊」與「鍵盤可達」兩條路徑。 */

/* 🔴 `scope` 是加進「個人設定」時**必須**引入的:
   hub 原本的副標寫「租戶層級的管理項目」,個人設定一進來那句就不成立了。
   把公司與個人混在同一份平鋪清單裡,使用者無從判斷改一個值會不會影響同事 ——
   這正是租戶/個人切分研究(settings-center.md §0.2)要解決的問題。 */
export type SettingsScope = "tenant" | "personal"

export interface SettingsNavItem {
  readonly href: string
  readonly label: string
  readonly desc: string
  readonly icon: LucideIcon
  readonly scope: SettingsScope
}

export const SETTINGS_NAV: readonly SettingsNavItem[] = [
  {
    href: "/app/settings/company",
    label: "公司設定",
    desc: "公司資料、統編、時區與地區預設",
    icon: Building2,
    scope: "tenant",
  },
  {
    href: "/app/settings/permissions",
    label: "權限",
    desc: "角色、成員、表單與欄位的存取控制",
    icon: KeyRound,
    scope: "tenant",
  },
  {
    href: "/app/settings/notifications",
    label: "通知設定",
    desc: "通知規則與發送通道",
    icon: BellRing,
    scope: "personal",
  },
  {
    href: "/app/settings/public-forms",
    label: "公開表單",
    desc: "對外開放填寫的表單與待審資料",
    icon: Share2,
    scope: "tenant",
  },
  {
    href: "/app/settings/integrations",
    label: "整合",
    desc: "Webhook 訂閱與 API 金鑰",
    icon: Webhook,
    scope: "tenant",
  },
  {
    href: "/app/settings/trash",
    label: "資源回收桶",
    desc: "已刪除的表單與記錄,可還原",
    icon: Trash2,
    scope: "tenant",
  },
  {
    href: "/app/settings/security",
    label: "帳號安全",
    desc: "密碼與雙因素驗證",
    icon: ShieldCheck,
    scope: "personal",
  },
  {
    href: "/app/settings/profile",
    label: "個人設定",
    desc: "介面語言與顯示時區(僅影響你自己)",
    icon: UserRound,
    scope: "personal",
  },
]
