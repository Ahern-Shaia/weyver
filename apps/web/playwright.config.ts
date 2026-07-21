import { defineConfig } from "@playwright/test"

/* UI golden path 固化(對 dev api + 真 PG)。前置:docker compose up -d postgres。
   webServer 自動起 api(:3001)+ web(:3000);本機已跑則沿用(reuseExistingServer)。
   E2E_BASE_URL 可覆寫 web port(如 :3000 被他專案占用時指到已跑的 :3002)。 */
const WEB_BASE = process.env["E2E_BASE_URL"] ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: WEB_BASE,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @weyver/api dev",
      env: { PORT: "3001" },
      url: "http://localhost:3001/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @weyver/web dev",
      url: `${WEB_BASE}/app/builder`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
