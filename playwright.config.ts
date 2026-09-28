import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.AUTH_URL ?? "http://localhost:3000";

/**
 * The two end-to-end flows the spec pins (§13). They run against a real
 * instance with real credentials — there is no mock transcription anywhere in
 * this project, including in its tests.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 15 * 60 * 1000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.LEXA_E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
