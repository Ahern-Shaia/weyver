import { z } from "zod"

/* F-2 M4 小圖表的請求 / 回應形狀。圖表型別與 chart-view 同一組,不另立。 */
export const WIDGET_CHART_TYPES = ["bar", "line", "pie"] as const
export const WIDGET_PLACEMENTS = ["list", "form"] as const

export const createWidgetBodySchema = z.object({
  name: z.string().min(1).max(60),
  chartType: z.enum(WIDGET_CHART_TYPES).default("bar"),
  dimension: z.string().min(1).max(100),
  measure: z
    .object({ fn: z.string().max(20), field: z.string().max(100) })
    .nullable()
    .default(null),
  /* widget 自身的篩選 —— 列表頁是**最低**優先(OQ-PC-10),不是唯一來源 */
  ownFilter: z.array(z.unknown()).max(20).default([]),
  placement: z.enum(WIDGET_PLACEMENTS).default("list"),
  position: z.number().int().min(0).max(99).default(0),
  /* 空 = 依來源表單權限(Ragic 語意)。非空者一律由 service 過候選 —— 前端過濾只是可用性 */
  visibleRoleIds: z.array(z.number().int().positive()).max(50).default([]),
})
export type CreateWidgetBody = z.infer<typeof createWidgetBodySchema>

export interface WidgetDto {
  readonly id: number
  readonly name: string
  readonly chartType: (typeof WIDGET_CHART_TYPES)[number]
  readonly dimension: string
  readonly measure: { fn: string; field: string } | null
  readonly ownFilter: readonly unknown[]
  readonly placement: (typeof WIDGET_PLACEMENTS)[number]
  readonly visibleRoleIds: readonly number[]
  /* 🔴 執行期 fail-closed 的**具名**理由(OQ-PC-11)。
     null = 可顯示。非 null 時前端顯示原因而不是空白圖 —— 空白圖會被當成「沒資料」。 */
  readonly unavailableReason: string | null
}
