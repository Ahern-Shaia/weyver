import tailwindcss from "@tailwindcss/vite"
import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) => {
    viteConfig.plugins = viteConfig.plugins ?? []
    viteConfig.plugins.push(tailwindcss())
    return viteConfig
  },
}

export default config
