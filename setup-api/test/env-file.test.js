import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEnvFileService } from "../src/services/env-file.js";

test("readCurrentConfig returns defaults when env file does not exist", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-file-test-"));
  const service = createEnvFileService({ envPath: path.join(tempDir, ".env") });

  const result = await service.readCurrentConfig();
  assert.equal(result.exists, false);
  assert.equal(result.config.PORT, "3000");
});

test("saveConfig writes serialized env content for valid config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-file-test-"));
  const envPath = path.join(tempDir, ".env");
  const service = createEnvFileService({ envPath });

  const result = await service.saveConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token"
  });

  assert.equal(result.saved, true);
  const written = await fs.readFile(envPath, "utf8");
  assert.match(written, /JIRA_BASE_URL=https:\/\/example\.atlassian\.net/);
});

test("saveConfig does not write file when validation fails", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-file-test-"));
  const envPath = path.join(tempDir, ".env");
  const service = createEnvFileService({ envPath });

  const result = await service.saveConfig({});
  assert.equal(result.saved, false);
  await assert.rejects(fs.readFile(envPath, "utf8"));
});

test("saveConfig preserves unknown env keys", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-file-test-"));
  const envPath = path.join(tempDir, ".env");
  await fs.writeFile(
    envPath,
    "WORKFLOW_TIMEOUT_SECONDS=900\nPOST_WORKFLOW_RESULT_TO_JIRA=false\nJIRA_BASE_URL=https://old.atlassian.net\n",
    "utf8"
  );
  const service = createEnvFileService({ envPath });

  const result = await service.saveConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token",
    GITHUB_TOKEN: "ghp_token",
    CODEX_API_KEY: "sk-token"
  });

  assert.equal(result.saved, true);
  const written = await fs.readFile(envPath, "utf8");
  assert.match(written, /WORKFLOW_TIMEOUT_SECONDS=900/);
  assert.match(written, /POST_WORKFLOW_RESULT_TO_JIRA=false/);
  assert.match(written, /JIRA_BASE_URL=https:\/\/example\.atlassian\.net/);
});
