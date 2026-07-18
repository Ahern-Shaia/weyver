import type { Meta, StoryObj } from "@storybook/react"
import { Boxes, FileText } from "lucide-react"
import { ModuleCard } from "./module-card"

const meta = {
  title: "元件/Module 模組卡",
  component: ModuleCard,
  args: {
    icon: <FileText strokeWidth={1.5} />,
    name: "表單引擎",
    meta: "247 張表單 · 1.2 萬筆",
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof ModuleCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithMetric: Story = {
  args: {
    icon: <Boxes strokeWidth={1.5} />,
    name: "MES 現場",
    meta: "3 線運行",
    value: "87%",
  },
}
