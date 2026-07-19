import type { Preview } from "@storybook/react-vite"
import "./preview.css"

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      options: {
        surface: { name: "surface", value: "#E8EAED" },
        card: { name: "card", value: "#FFFFFF" },
      },
    },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
  initialGlobals: {
    backgrounds: { value: "surface" },
  },
}

export default preview
