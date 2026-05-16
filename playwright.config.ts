import { defineConfig, devices } from "@playwright/test";

const frontendHost = process.env.PLAYWRIGHT_FRONTEND_HOST || "127.0.0.1";
const frontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT || 4173);
const frontendBaseUrl = process.env.PLAYWRIGHT_FRONTEND_URL || `http://${frontendHost}:${frontendPort}`;
const reuseFrontendServer = String(process.env.PLAYWRIGHT_REUSE_FRONTEND_SERVER || "").toLowerCase() === "true";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /.*\.live\.spec\.ts/,
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: frontendBaseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npm run dev --workspace frontend -- --host ${frontendHost} --port ${frontendPort}`,
    url: frontendBaseUrl,
    reuseExistingServer: reuseFrontendServer,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
