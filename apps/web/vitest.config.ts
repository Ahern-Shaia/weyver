import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/* 🔴 `include` 一直寫著 `.test.tsx`,但 **JSX transform 從沒接上** ——
   於是 `apps/web` 裡任何元件測試都跑不起來(既有測試全是純邏輯的 `.ts`),
   而 AGENTS.md 的測試分層把「元件互動」列為**佔多數的快層**。

   根因是 tsconfig 的 `jsx: "preserve"`(Next.js 的慣例:JSX 留給 Next 自己轉),
   於是 vite 的 esbuild 原封不動地把 JSX 交給 parser。這裡明講要自動轉,
   **不必為此裝 `@vitejs/plugin-react`**。 */
export default defineConfig({
  /* Vite 8 走 oxc transform;JSX 的開關在這裡而不是 `esbuild` */
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
