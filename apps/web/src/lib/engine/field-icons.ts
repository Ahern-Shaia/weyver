import {
  AtSign,
  Barcode,
  Calculator,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  ChevronDownSquare,
  CircleUser,
  DollarSign,
  Hash,
  Image,
  Link2,
  ListChecks,
  type LucideIcon,
  Paperclip,
  Pencil,
  Percent,
  Phone,
  Search,
  Sigma,
  Star,
  Text,
  Type,
  Link as UrlIcon,
  Users,
} from "lucide-react"
import type { CellValueType } from "./schemas"

/* 🔴 R1·UP-3c M1|型別圖示。

   取代原本的 `mark` 自造字元(A / ¶ / № / ⛓ / **📎 emoji** / ✍),該欄位已刪。
   emoji 由作業系統彩色渲染,顏色不受 design token 管、各平台字形不一,
   而且它會混進 button 的可及名稱(e2e 得寫 `name: "№ 自動編號"` 才選得到)。
   docs/frontend-design-principles §A「真 Lucide,不用字元湊」。

   Record<CellValueType, …> 由 tsc 保證窮盡 —— 新增型別忘了配圖示會編譯失敗,不會安靜地掉圖。 */
const ICONS: Record<CellValueType, LucideIcon> = {
  text: Type,
  longText: Text,
  markdown: Hash,
  email: AtSign,
  url: UrlIcon,
  phone: Phone,
  number: Hash,
  money: DollarSign,
  percent: Percent,
  date: CalendarDays,
  dateTime: CalendarClock,
  singleSelect: ChevronDownSquare,
  multiSelect: ListChecks,
  checkbox: CheckSquare,
  rating: Star,
  autoNumber: Hash,
  member: CircleUser,
  group: Users,
  link: Link2,
  attachment: Paperclip,
  image: Image,
  signature: Pencil,
  formula: Calculator,
  barcode: Barcode,
  rollup: Sigma,
  lookup: Search,
  createdAt: CalendarClock,
  updatedAt: CalendarClock,
  createdBy: CircleUser,
  updatedBy: CircleUser,
}

export function fieldTypeIcon(type: CellValueType): LucideIcon {
  return ICONS[type]
}
