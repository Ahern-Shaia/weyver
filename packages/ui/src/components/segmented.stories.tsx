import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { Segmented } from "./segmented"

const meta = {
  title: "元件/Segmented 分段控制",
  component: Segmented,
  args: {
    value: "today",
    onValueChange: () => undefined,
    options: [
      { label: "今日", value: "today" },
      { label: "本週", value: "week" },
      { label: "本月", value: "month" },
    ],
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof Segmented>

export default meta
type Story = StoryObj<typeof meta>

export const Period: Story = {
  render: () => {
    const [value, setValue] = useState("today")
    return (
      <Segmented
        ariaLabel="時段"
        value={value}
        onValueChange={setValue}
        options={[
          { label: "今日", value: "today" },
          { label: "本週", value: "week" },
          { label: "本月", value: "month" },
        ]}
      />
    )
  },
}

export const View: Story = {
  render: () => {
    const [value, setValue] = useState("table")
    return (
      <Segmented
        ariaLabel="檢視"
        value={value}
        onValueChange={setValue}
        options={[
          { label: "表格", value: "table" },
          { label: "看板", value: "kanban" },
          { label: "日曆", value: "calendar" },
        ]}
      />
    )
  },
}
