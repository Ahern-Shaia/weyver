import type { Meta, StoryObj } from "@storybook/react-vite"
import { Kpi } from "./kpi"

const meta = {
  title: "元件/KPI 卡",
  component: Kpi,
  args: { label: "本月銷售", value: "4.82", unit: "M" },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Kpi>

export default meta
type Story = StoryObj<typeof meta>

export const TrendUp: Story = {
  args: { trend: { direction: "up", label: "12.3%" } },
}

export const TrendDown: Story = {
  args: { label: "退貨率", value: "1.4", unit: "%", trend: { direction: "down", label: "0.6%" } },
}

export const MutedNote: Story = {
  args: { label: "整體 OEE", value: "87", unit: "%", note: { tone: "muted", label: "3 線運行" } },
}

export const DangerNote: Story = {
  args: { label: "待我處理", value: "8", note: { tone: "danger", label: "2 件今日到期" } },
}

export const Row: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Kpi label="本月銷售" value="4.82" unit="M" trend={{ direction: "up", label: "12.3%" }} />
      <Kpi label="整體 OEE" value="87" unit="%" note={{ tone: "muted", label: "3 線運行" }} />
      <Kpi label="待我處理" value="8" note={{ tone: "danger", label: "2 件今日到期" }} />
    </div>
  ),
}
