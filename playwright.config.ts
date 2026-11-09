import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  },
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://localhost:3100/opportunities",
    timeout: 120_000,
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
