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
    CODEX_API_KEY: "sk-token"
  });
  assert.equal(result.isValid, true);
});

test("validateConfig allows persisted Codex login when bootstrap login is disabled", () => {
  const result = validateConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_BOOTSTRAP_LOGIN: "false"
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
