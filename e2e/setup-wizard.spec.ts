import { expect, test } from "@playwright/test";

import { SetupWizardPage } from "./page-objects/setup-wizard.page";
import { mockSetupApi, mockSetupApiWithOptions } from "./support/mock-setup-api";

test("codex success flow shows device login and confirms container auth", async ({ page }) => {
  const wizard = new SetupWizardPage(page);

  await test.step("Given the setup API is mocked for a Codex launch", async () => {
    await mockSetupApi(page, "codex");
  });

  await test.step("And the user has completed setup up to the run console", async () => {
    await wizard.advanceToRunStep("codex", {
      jiraReadySignal: "Authenticated as engineer@example.com",
      gitHubReadySignal: "Authenticated as pronto-user"
    });
  });

  await test.step("When PRonto is launched with Codex device login", async () => {
    await wizard.launchPronto();
  });

  await test.step("Then the user sees the Codex device login prompt and can confirm container auth", async () => {
    await wizard.expectDeviceLoginPanel("codex");
    await wizard.expectSignInLink("https://auth.openai.com/codex/device");
    await wizard.expectOneTimeCode("ABCD-12345");
    await wizard.testIntegrationLogin("codex");
    await wizard.expectIntegrationLoginConfirmed("codex");
  });
});

test("claude success flow accepts pasted auth code and confirms login", async ({ page }) => {
  const wizard = new SetupWizardPage(page);

  await test.step("Given the setup API is mocked for a Claude launch", async () => {
    await mockSetupApi(page, "claude");
  });

  await test.step("And the user has completed setup up to the run console", async () => {
    await wizard.advanceToRunStep("claude", {
      jiraReadySignal: "Authenticated as engineer@example.com",
      gitHubReadySignal: "Authenticated as pronto-user"
    });
  });

  await test.step("When PRonto is launched with Claude device login", async () => {
    await wizard.launchPronto();
  });

  await test.step("Then the user can paste the Claude code and the prompt clears after success", async () => {
    await wizard.expectDeviceLoginPanel("claude");
    await wizard.expectSignInLink("https://claude.example/device");
    await expect(page.getByText("Claude Code is logging in...")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Test Claude Code Login" })).toHaveCount(0);
    await wizard.fillClaudeAuthorizationCode("AUTH-CODE-1234");
    await wizard.submitClaudeAuthorizationCode();
    await expect(page.getByText("Claude Code is logging in...")).toBeVisible();
    await wizard.expectIntegrationLoginConfirmed("claude");
    await wizard.expectClaudeAuthorizationPromptCleared();
  });
});

test("claude login shows automatic loading when broker does not require code", async ({ page }) => {
  const wizard = new SetupWizardPage(page);

  await test.step("Given mocked Claude auth where code is not required", async () => {
    await mockSetupApiWithOptions(page, "claude", { claudeRequiresCode: false });
  });

  await test.step("And the user reaches the run console and launches PRonto", async () => {
    await wizard.advanceToRunStep("claude", {
      jiraReadySignal: "Authenticated as engineer@example.com",
      gitHubReadySignal: "Authenticated as pronto-user"
    });
    await wizard.launchPronto();
    await wizard.expectDeviceLoginPanel("claude");
  });

  await test.step("Then Claude login is checked automatically without a manual test button", async () => {
    await expect(page.getByText("Claude Code is logging in...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Test Claude Code Login" })).toHaveCount(0);
  });
});

test("claude code submission confirms login automatically when code is required", async ({ page }) => {
  const wizard = new SetupWizardPage(page);

  await test.step("Given mocked Claude auth where code is required", async () => {
    await mockSetupApiWithOptions(page, "claude", { claudeRequiresCode: true });
  });

  await test.step("And the user reaches the run console and launches PRonto", async () => {
    await wizard.advanceToRunStep("claude", {
      jiraReadySignal: "Authenticated as engineer@example.com",
      gitHubReadySignal: "Authenticated as pronto-user"
    });
    await wizard.launchPronto();
    await wizard.expectDeviceLoginPanel("claude");
  });

  await test.step("Then Claude login stays automatic and confirms after code submission", async () => {
    await expect(page.getByText("Claude Code is logging in...")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Test Claude Code Login" })).toHaveCount(0);
    await page.getByLabel("Claude Code authorization code").fill("AUTH-CODE-1234");
    await page.getByRole("button", { name: "Submit Code" }).click();
    await expect(page.getByText("Claude Code is logging in...")).toBeVisible();
    await wizard.expectIntegrationLoginConfirmed("claude");
  });
});
