import { expect, test } from "@playwright/test";

import { SetupWizardPage } from "./page-objects/setup-wizard.page";
import { apiGet, apiPost, claudeIsLoggedInFromStatus, expectPersistedIntegrationLoginToBeValid, getClaudeAuthStatusRaw, stopContainer, waitForClaudeLoginInContainer } from "./support/live-setup-api";
import type { ConfigMap } from "./support/types";

const LIVE_E2E_ENABLED = process.env.PRONTO_LIVE_E2E === "1";
const LIVE_CLAUDE_DEVICE_E2E_ENABLED = process.env.PRONTO_LIVE_CLAUDE_DEVICE_E2E === "1";
const LIVE_CLAUDE_MANUAL_ASSIST_ENABLED = process.env.PRONTO_LIVE_CLAUDE_MANUAL_ASSIST === "1";

let originalConfig: ConfigMap | null = null;

test.describe.configure({ mode: "serial" });

test.describe("setup wizard live integrations", () => {
  test.skip(!LIVE_E2E_ENABLED, "Set PRONTO_LIVE_E2E=1 to run live integration tests.");

  test.beforeAll(async ({ request }) => {
    const response = await apiGet<{ config: ConfigMap }>(request, "/api/config");
    originalConfig = response.config;
  });

  test.beforeEach(async ({ request }) => {
    await stopContainer(request);
  });

  test.afterAll(async ({ request }) => {
    if (!LIVE_E2E_ENABLED) {
      return;
    }

    await stopContainer(request);
    if (originalConfig) {
      await apiPost(request, "/api/config/save", { config: originalConfig });
    }
  });

  test("codex persisted login succeeds end to end against the real stack", async ({ page, request }) => {
    const wizard = new SetupWizardPage(page);

    await test.step("Given the live setup wizard is configured for Codex persisted login", async () => {
      await wizard.advanceToRunStep("codex", {
        usePersistedLogin: true,
        integrationReadySignal: "✓ Codex ready",
        ngrokReadySignal: "✓ ngrok ready"
      });
    });

    await test.step("When PRonto is launched against the real stack", async () => {
      await wizard.launchPronto();
      await wizard.expectLaunchSequenceEntry("Container started");
    });

    await test.step("Then the live backend confirms the persisted Codex login inside the container", async () => {
      await expectPersistedIntegrationLoginToBeValid(request, "codex");
    });
  });

  test("claude persisted login succeeds end to end against the real stack", async ({ page, request }) => {
    const wizard = new SetupWizardPage(page);

    await test.step("Given the live setup wizard is configured for Claude persisted login", async () => {
      await wizard.advanceToRunStep("claude", {
        usePersistedLogin: true,
        integrationReadySignal: "✓ Claude Code ready",
        ngrokReadySignal: "✓ ngrok ready"
      });
    });

    await test.step("When PRonto is launched against the real stack", async () => {
      await wizard.launchPronto();
      await wizard.expectLaunchSequenceEntry("Container started");
    });

    await test.step("Then the live backend confirms the persisted Claude login inside the container", async () => {
      await expectPersistedIntegrationLoginToBeValid(request, "claude");
    });
  });

  test("claude device login completes end to end with live docker verification", async ({ page, request }) => {
    test.skip(!LIVE_CLAUDE_DEVICE_E2E_ENABLED, "Set PRONTO_LIVE_CLAUDE_DEVICE_E2E=1 to run live Claude device-auth verification.");
    const wizard = new SetupWizardPage(page);

    await test.step("Given Claude device login mode is selected in the live wizard", async () => {
      await wizard.advanceToRunStep("claude", {
        usePersistedLogin: false,
        integrationReadySignal: "✓ Claude Code ready",
        ngrokReadySignal: "✓ ngrok ready"
      });
    });

    await test.step("When PRonto is launched and Claude auth panel is ready", async () => {
      await wizard.launchPronto();
      await wizard.expectLaunchSequenceEntry("Container started");
      await wizard.expectDeviceLoginPanel("claude");
    });

    await test.step("And the container reports Claude is not logged in before auth", async () => {
      const preStatus = getClaudeAuthStatusRaw();
      expect(claudeIsLoggedInFromStatus(preStatus)).toBeFalsy();
    });

    await test.step("And the automatic Claude login opens the browser sign-in page", async () => {
      const signInLink = page.getByRole("link", { name: "Open Sign-In Page" });
      await expect(signInLink).toHaveAttribute(
        "href",
        /claude\.com\/cai\/oauth\/authorize/i
      );
      await signInLink.click();
      if (LIVE_CLAUDE_MANUAL_ASSIST_ENABLED) {
        console.log("[claude-live-auth] Manual assist mode enabled. Complete Claude browser sign-in now; test will continue polling Docker auth status.");
      }
    });

    await test.step("Then Claude auth eventually becomes active in docker (complete browser flow if prompted)", async () => {
      const result = await waitForClaudeLoginInContainer({
        timeoutMs: LIVE_CLAUDE_MANUAL_ASSIST_ENABLED ? 900_000 : 300_000,
        pollMs: 5_000,
        onPoll: async ({ elapsedMs, status }) => {
          const minutes = Math.floor(elapsedMs / 60_000);
          const seconds = Math.floor((elapsedMs % 60_000) / 1000);
          const sessionId = (await apiGet<{ ok: boolean; session: { id: string } | null }>(request, "/api/auth/sessions/session-1").catch(() => ({ ok: false, session: null } as const)))?.session?.id;
          const sessionSnapshot = sessionId
            ? await apiGet<{ ok: boolean; session: Record<string, unknown> | null }>(request, `/api/auth/sessions/${sessionId}`).catch(() => ({ ok: false, session: null } as const))
            : { ok: false, session: null as Record<string, unknown> | null };

          const autoLoginVisible = await page
            .getByText("Claude Code is logging in...")
            .isVisible()
            .catch(() => false);

          console.log(
            `[claude-live-auth][${minutes}m${String(seconds).padStart(2, "0")}s] ` +
              `autoLoginVisible=${autoLoginVisible} ` +
              `sessionState=${String((sessionSnapshot.session as { state?: string } | null)?.state || "unknown")} ` +
              `requiresCode=${String((sessionSnapshot.session as { requiresCode?: boolean } | null)?.requiresCode ?? "unknown")} ` +
              `status=${JSON.stringify(status).slice(0, 220)}`
          );
        }
      });
      expect(result.ok, `Expected Claude login to complete in container. Last status:\n${result.status}`).toBeTruthy();
    });

    await test.step("And integration-container-auth passes through setup-api", async () => {
      const authCheck = await apiPost<{ ok: boolean; checks: Array<{ command: string; ok: boolean; output: string }> }>(
        request,
        "/api/checks/integration-container-auth",
        { config: { AI_AGENT: "claude", CLAUDE_BOOTSTRAP_LOGIN: "true", CLAUDE_DEVICE_LOGIN_ON_START: "true" } }
      );
      expect(authCheck.ok, JSON.stringify(authCheck, null, 2)).toBeTruthy();
      expect(authCheck.checks.some((check) => check.command.includes("claude login") && check.ok)).toBeTruthy();
    });
  });
});
