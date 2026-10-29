import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pwa",
  fullyParallel: false,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-pwa-report", open: "never" }],
  ],
  outputDir: "test-results/pwa",
  use: {
    baseURL: "http://127.0.0.1:3011",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "edge-pwa",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
    },
  ],
  webServer: {
    command:
      "node scripts/prepare-standalone.mjs && node .next/standalone/server.js",
    url: "http://127.0.0.1:3011",
    reuseExistingServer: false,
    timeout: 60000,
    env: { HOSTNAME: "127.0.0.1", PORT: "3011", NODE_ENV: "production" },
  },
});
