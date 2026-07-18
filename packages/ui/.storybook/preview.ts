import type { Preview } from "@storybook/react-vite"
import "./preview.css"

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      options: {
        surface: { name: "surface", value: "#F4F6F8" },
        card: { name: "card", value: "#FFFFFF" },
        ink: { name: "ink", value: "#181E26" },
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
