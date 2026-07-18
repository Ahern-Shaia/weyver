import type { Meta, StoryObj } from "@storybook/react-vite"
import { Search } from "lucide-react"
import { Input } from "./input"

const meta = {
  title: "元件/Input 輸入",
  component: Input,
  args: { placeholder: "搜尋單據…" },
  parameters: { layout: "padded" },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="w-60">
      <Input {...args} />
    </div>
  ),
}

export const WithIcon: Story = {
  render: (args) => (
    <div className="w-60">
      <Input {...args} icon={<Search strokeWidth={1.4} />} />
    </div>
  ),
}
