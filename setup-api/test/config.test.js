import test from "node:test";
import assert from "node:assert/strict";

import { parseEnvFile, serializeEnv, validateConfig } from "../src/config.js";

test("validateConfig requires Jira fields", () => {
  const result = validateConfig({});
  assert.equal(result.isValid, false);
  assert.ok(result.errors.JIRA_BASE_URL);
  assert.ok(result.errors.JIRA_USER_EMAIL);
  assert.ok(result.errors.JIRA_API_TOKEN);
});

test("validateConfig allows API key auth path", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token",
    NGROK_ENABLE: "false"
  });
  assert.equal(result.isValid, true);
});

test("validateConfig allows persisted Codex login when bootstrap login is disabled", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_BOOTSTRAP_LOGIN: "false",
    NGROK_ENABLE: "false"
  });

  assert.equal(result.isValid, true);
});

test("validateConfig requires Claude device login when Claude bootstrap is enabled", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    AI_AGENT: "claude",
    CLAUDE_BOOTSTRAP_LOGIN: "true",
    CLAUDE_DEVICE_LOGIN_ON_START: "false"
  });

  assert.equal(result.isValid, false);
  assert.equal(result.errors.CLAUDE_DEVICE_LOGIN_ON_START, "Enable Claude device login on start, or disable bootstrap login to use persisted login.");
});

test("validateConfig allows persisted Claude login when Claude bootstrap is disabled", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    AI_AGENT: "claude",
    CLAUDE_BOOTSTRAP_LOGIN: "false",
    CLAUDE_DEVICE_LOGIN_ON_START: "false",
    NGROK_ENABLE: "false"
  });

  assert.equal(result.isValid, true);
});

test("validateConfig requires ngrok authtoken when ngrok is enabled", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token",
    NGROK_ENABLE: "true"
  });

  assert.equal(result.isValid, false);
  assert.equal(result.errors.NGROK_AUTHTOKEN, "ngrok authtoken is required when ngrok is enabled.");
});

test("validateConfig allows setup when ngrok is disabled", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token",
    NGROK_ENABLE: "false"
  });

  assert.equal(result.isValid, true);
  assert.equal(result.errors.NGROK_AUTHTOKEN, undefined);
});

test("serializeEnv round-trips core values", () => {
  const envText = serializeEnv({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token",
    NGROK_ENABLE: "true",
    NGROK_AUTHTOKEN: "ngrok-token"
  });

  const parsed = parseEnvFile(envText);
  assert.equal(parsed.JIRA_BASE_URL, "https://example.atlassian.net");
  assert.equal(parsed.GITHUB_TOKEN, "ghp_token");
  assert.equal(parsed.NGROK_ENABLE, "true");
});

test("parseEnvFile strips surrounding quotes from values", () => {
  const parsed = parseEnvFile('READY_STATUS="To Do"\nCODEX_EXEC_ARGS="--full-auto"\n');
  assert.equal(parsed.READY_STATUS, "To Do");
  assert.equal(parsed.CODEX_EXEC_ARGS, "--full-auto");
});

test("serializeEnv uses the Docker-safe Codex exec default", () => {
  const envText = serializeEnv({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token",
    NGROK_ENABLE: "false"
  });

  assert.match(envText, /CODEX_EXEC_ARGS=--dangerously-bypass-approvals-and-sandbox/);
});

test("serializeEnv uses the Docker-safe Claude permission default", () => {
  const envText = serializeEnv({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    AI_AGENT: "claude",
    NGROK_ENABLE: "false"
  });

  assert.match(envText, /CLAUDE_EXEC_ARGS="--permission-mode auto --allowedTools Bash,Read,Edit,Write"/);
});

test("serializeEnv preserves disabled ngrok state", () => {
  const envText = serializeEnv({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token",
    NGROK_ENABLE: "false"
  });

  assert.match(envText, /NGROK_ENABLE=false/);
});

test("parseEnvFile preserves explicit legacy Codex exec args for existing environments", () => {
  const parsed = parseEnvFile("CODEX_EXEC_ARGS=--full-auto\n");
  assert.equal(parsed.CODEX_EXEC_ARGS, "--full-auto");
});

test("parseEnvFile migrates legacy Claude allowedTools args", () => {
  const parsed = parseEnvFile('CLAUDE_EXEC_ARGS="--allowedTools Bash,Edit,Write,Read"\n');
  assert.equal(parsed.CLAUDE_EXEC_ARGS, "--permission-mode auto --allowedTools Bash,Read,Edit,Write");
});

test("parseEnvFile migrates root-blocked Claude bypassPermissions args", () => {
  const parsed = parseEnvFile('CLAUDE_EXEC_ARGS="--permission-mode bypassPermissions"\n');
  assert.equal(parsed.CLAUDE_EXEC_ARGS, "--permission-mode auto --allowedTools Bash,Read,Edit,Write");
});

test("validateConfig rejects unsafe Codex exec args", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token",
    NGROK_ENABLE: "false",
    CODEX_EXEC_ARGS: '--sandbox "workspace-write"'
  });

  assert.equal(result.isValid, false);
  assert.match(result.errors.CODEX_EXEC_ARGS, /plain space-separated Codex flags/i);
});

test("validateConfig rejects unsafe Claude exec args", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    AI_AGENT: "claude",
    CLAUDE_BOOTSTRAP_LOGIN: "false",
    CLAUDE_DEVICE_LOGIN_ON_START: "false",
    NGROK_ENABLE: "false",
    CLAUDE_EXEC_ARGS: "--allowedTools Bash;rm"
  });

  assert.equal(result.isValid, false);
  assert.match(result.errors.CLAUDE_EXEC_ARGS, /plain space-separated Claude flags/i);
});
