import type { Meta, StoryObj } from "@storybook/react-vite"
import { StatusChip } from "./status-chip"

const meta = {
  title: "元件/StatusChip 狀態章",
  component: StatusChip,
  args: { children: "已核准", tone: "ok" },
  argTypes: {
    tone: { control: "inline-radio", options: ["ok", "warn", "error", "neutral"] },
  },
} satisfies Meta<typeof StatusChip>

export default meta
type Story = StoryObj<typeof meta>

export const Ok: Story = { args: { tone: "ok", children: "已核准" } }
export const Warn: Story = { args: { tone: "warn", children: "待審核" } }
export const ErrorTone: Story = { args: { tone: "error", children: "退回" } }
export const Neutral: Story = { args: { tone: "neutral", children: "已收貨" } }

export const All: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <StatusChip tone="ok">已核准</StatusChip>
      <StatusChip tone="warn">待審核</StatusChip>
      <StatusChip tone="error">退回</StatusChip>
      <StatusChip tone="neutral">已收貨</StatusChip>
    </div>
  ),
}
