import type { Meta, StoryObj } from "@storybook/react"
import { expect, fn, userEvent, within } from "@storybook/test"
import { Plus } from "lucide-react"
import { Button } from "./button"

const meta = {
  title: "元件/Button 按鈕",
  component: Button,
  args: { children: "建立記錄", onClick: fn() },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["primary", "secondary", "ghost", "danger"],
    },
    size: { control: "inline-radio", options: ["md", "sm"] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: "primary" } }
export const Secondary: Story = { args: { variant: "secondary", children: "篩選" } }
export const Ghost: Story = { args: { variant: "ghost", children: "取消" } }
export const Danger: Story = { args: { variant: "danger", children: "刪除" } }
export const Small: Story = { args: { size: "sm", children: "小按鈕" } }

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Plus className="size-3" strokeWidth={2} />
        建立記錄
      </>
    ),
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Plus className="size-3" strokeWidth={2} />
        建立記錄
      </Button>
      <Button variant="secondary">篩選</Button>
      <Button variant="ghost">取消</Button>
      <Button variant="danger">刪除</Button>
      <Button size="sm">小按鈕</Button>
    </div>
  ),
}

export const ClickInteraction: Story = {
  args: { variant: "primary" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole("button", { name: "建立記錄" })
    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}
