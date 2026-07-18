import type { Preview } from "@storybook/react"
import "./preview.css"

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "surface",
      values: [
        { name: "surface", value: "#F4F6F8" },
        { name: "card", value: "#FFFFFF" },
        { name: "ink", value: "#181E26" },
      ],
    },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
}

export default preview
