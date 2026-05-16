import { defineConfig, devices } from "@playwright/test";

const setupApiHost = process.env.PLAYWRIGHT_SETUP_API_HOST || "127.0.0.1";
const setupApiPort = Number(process.env.PLAYWRIGHT_SETUP_API_PORT || 3010);
const setupApiBaseUrl = process.env.PLAYWRIGHT_SETUP_API_URL || `http://${setupApiHost}:${setupApiPort}`;
const frontendHost = process.env.PLAYWRIGHT_FRONTEND_HOST || "127.0.0.1";
const frontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT || 5173);
const frontendBaseUrl = process.env.PLAYWRIGHT_FRONTEND_URL || `http://${frontendHost}:${frontendPort}`;
const setupApiCommand = process.env.PLAYWRIGHT_SETUP_API_COMMAND || `node setup-api/src/server.js`;
const frontendCommand = process.env.PLAYWRIGHT_FRONTEND_COMMAND || `npm run dev --workspace frontend -- --host ${frontendHost} --port ${frontendPort}`;
const reuseSetupApiServer = String(process.env.PLAYWRIGHT_REUSE_SETUP_API_SERVER || "true").toLowerCase() === "true";
const reuseFrontendServer = String(process.env.PLAYWRIGHT_REUSE_FRONTEND_SERVER || "true").toLowerCase() === "true";
const headless = String(process.env.PLAYWRIGHT_HEADLESS || "true").toLowerCase() !== "false";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.live\.spec\.ts/,
  timeout: 180_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  use: {
    baseURL: frontendBaseUrl,
    trace: "on-first-retry",
    headless
  },
  webServer: [
    {
      command: setupApiCommand,
      url: `${setupApiBaseUrl}/api/status`,
      reuseExistingServer: reuseSetupApiServer,
      timeout: 120_000
    },
    {
      command: frontendCommand,
      url: frontendBaseUrl,
      reuseExistingServer: reuseFrontendServer,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
