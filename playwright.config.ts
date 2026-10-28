import { defineConfig, devices } from "@playwright/test";
const integration = process.env.TEST_ALLOW_WRITES === "true";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    timeout: 120_000,
    reuseExistingServer: !integration,
    env: integration
      ? {
          NEXT_PUBLIC_SUPABASE_URL: process.env.TEST_SUPABASE_URL || "",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            process.env.TEST_SUPABASE_KEY || "",
        }
      : {
          RELAY_TEST_EDITOR: "1",
          NEXT_PUBLIC_SUPABASE_URL: "",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        },
  },
});
