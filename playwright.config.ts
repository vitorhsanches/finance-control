import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-local",
      testMatch: /local\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4273" },
    },
    {
      name: "chromium-remote",
      testMatch: /remote\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4274" },
    },
    {
      name: "mobile-chromium",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:4273" },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4273",
      url: "http://127.0.0.1:4273",
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
        VITE_SUPABASE_ANON_KEY: "e2e-disabled-key",
      },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4274",
      url: "http://127.0.0.1:4274",
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "http://127.0.0.1:4274/__supabase",
        VITE_SUPABASE_ANON_KEY: "e2e-public-anon-key",
      },
    },
  ],
});
