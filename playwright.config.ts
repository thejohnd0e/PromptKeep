import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  use: {
    channel: "chromium",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "bundled-chromium-extension",
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
  ],
})
