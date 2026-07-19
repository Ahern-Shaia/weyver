import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { Button } from "./button"

const meta = {
  title: "元件/Button 帶框按鈕",
  component: Button,
  args: { children: "儲存", onClick: fn() },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "default", "danger"] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: "primary", children: "核准並過帳" } }
export const Default: Story = { args: { children: "儲存" } }
export const Danger: Story = { args: { variant: "danger", children: "作廢" } }

export const ToolbarRow: Story = {
  render: () => (
    <div className="flex items-center gap-1.5">
      <Button variant="primary">核准並過帳</Button>
      <Button>儲存</Button>
      <Button>新增</Button>
      <Button>列印 ▾</Button>
      <Button variant="danger">作廢</Button>
    </div>
  ),
}

export const ClickInteraction: Story = {
  args: { variant: "primary", children: "核准並過帳" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "核准並過帳" }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}
