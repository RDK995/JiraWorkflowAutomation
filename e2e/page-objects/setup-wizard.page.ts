import { expect, type Page } from "@playwright/test";

import type { Agent } from "../support/types";

export class SetupWizardPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/");
  }

  async startOnboarding() {
    await this.page.getByRole("button", { name: "Get Started" }).click();
  }

  async completeDockerStep() {
    await this.page.getByRole("button", { name: "Run System Check" }).click();
    await this.page.getByRole("button", { name: "Next" }).click();
  }

  async completeJiraStep(expectedReadySignal: string) {
    await this.page.getByRole("button", { name: "Test Jira Connection" }).click();
    await expect(this.page.getByText(expectedReadySignal)).toBeVisible();
    await this.page.getByRole("button", { name: "Next" }).click();
  }

  async completeGitHubStep(expectedReadySignal: string) {
    await this.page.getByRole("button", { name: "Test GitHub Access" }).click();
    await expect(this.page.getByText(expectedReadySignal)).toBeVisible();
    await this.page.getByRole("button", { name: "Next" }).click();
  }

  async chooseAgent(agent: Agent) {
    await this.page.getByLabel(/AI integration/).selectOption(agent);
  }

  async choosePersistedLogin(agent: Agent) {
    const label = agent === "claude" ? /Claude authentication method/ : /Codex authentication method/;
    await this.page.getByLabel(label).selectOption("persisted");
  }

  async runIntegrationReadinessCheck(agent: Agent, expectedReadySignal?: string) {
    await this.page.getByRole("button", { name: new RegExp(`Test ${agent === "claude" ? "Claude Code" : "Codex"} Access`) }).click();
    if (expectedReadySignal) {
      await expect(this.page.getByText(expectedReadySignal)).toBeVisible();
    }
    await this.page.getByRole("button", { name: "Next" }).click();
  }

  async completeNgrokStep(expectedReadySignal?: string) {
    await this.page.getByRole("button", { name: "Test Public Access" }).click();
    if (expectedReadySignal) {
      await expect(this.page.getByText(expectedReadySignal)).toBeVisible();
    }
    await this.page.getByRole("button", { name: "Next" }).click();
  }

  async continueToRunStep() {
    await this.page.getByRole("button", { name: "Next" }).click();
    await this.page.getByRole("button", { name: "Next" }).click();
  }

  async advanceToRunStep(agent: Agent, options?: { usePersistedLogin?: boolean; jiraReadySignal?: string; gitHubReadySignal?: string; integrationReadySignal?: string; ngrokReadySignal?: string }) {
    await this.open();
    await this.startOnboarding();
    await this.completeDockerStep();
    await this.completeJiraStep(options?.jiraReadySignal || "✓ Jira ready");
    await this.completeGitHubStep(options?.gitHubReadySignal || "✓ GitHub ready");
    await this.chooseAgent(agent);
    if (options?.usePersistedLogin) {
      await this.choosePersistedLogin(agent);
    }
    await this.runIntegrationReadinessCheck(agent, options?.integrationReadySignal);
    await this.completeNgrokStep(options?.ngrokReadySignal);
    await this.continueToRunStep();
  }

  async launchPronto() {
    await this.page.getByRole("button", { name: "Launch PRonto" }).click();
  }

  async expectLaunchSequenceEntry(entry: string, timeout = 90_000) {
    await expect(this.page.getByText(entry)).toBeVisible({ timeout });
  }

  async expectDeviceLoginPanel(agent: Agent) {
    await expect(this.page.getByRole("heading", { name: `Connect ${agent === "claude" ? "Claude Code" : "Codex"}` })).toBeVisible();
  }

  signInLink() {
    return this.page.getByRole("link", { name: "Open Sign-In Page" });
  }

  async expectSignInLink(url: string) {
    await expect(this.signInLink()).toHaveAttribute("href", url);
  }

  async expectOneTimeCode(code: string) {
    await expect(this.page.locator(".guide-section code").filter({ hasText: code })).toBeVisible();
  }

  async testIntegrationLogin(agent: Agent) {
    await this.page.getByRole("button", { name: `Test ${agent === "claude" ? "Claude Code" : "Codex"} Login` }).click();
  }

  async expectIntegrationLoginConfirmed(agent: Agent) {
    await expect(this.page.getByText(`✓ ${agent === "claude" ? "Claude Code" : "Codex"} login confirmed`)).toBeVisible();
  }

  async fillClaudeAuthorizationCode(code: string) {
    await this.page.getByLabel("Claude Code authorization code").fill(code);
  }

  async submitClaudeAuthorizationCode() {
    await this.page.getByRole("button", { name: "Submit Code" }).click();
  }

  async expectClaudeAuthorizationPromptCleared() {
    await expect(this.page.getByLabel("Claude authorization code")).toHaveCount(0);
    await expect(this.signInLink()).toHaveCount(0);
  }
}
