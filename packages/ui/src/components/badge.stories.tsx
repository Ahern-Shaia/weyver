import type { Meta, StoryObj } from "@storybook/react-vite"
import { Badge } from "./badge"

const meta = {
  title: "元件/Badge 狀態標籤",
  component: Badge,
  args: { children: "已核准", variant: "success", dot: true },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["success", "warning", "danger", "info", "brand", "neutral"],
    },
    dot: { control: "boolean" },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Success: Story = { args: { variant: "success", children: "已核准" } }
export const Warning: Story = { args: { variant: "warning", children: "待審核" } }
export const Danger: Story = { args: { variant: "danger", children: "異常" } }
export const Info: Story = { args: { variant: "info", children: "已收貨" } }
export const Brand: Story = { args: { variant: "brand", children: "進行中" } }
export const Neutral: Story = { args: { variant: "neutral", children: "草稿" } }

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="success">已核准</Badge>
      <Badge variant="warning">待審核</Badge>
      <Badge variant="danger">異常</Badge>
      <Badge variant="info">已收貨</Badge>
      <Badge variant="brand">進行中</Badge>
      <Badge variant="neutral">草稿</Badge>
    </div>
  ),
}
