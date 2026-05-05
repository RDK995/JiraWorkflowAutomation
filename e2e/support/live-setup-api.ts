import { expect, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";

import type { Agent, ConfigMap } from "./types";

const API_BASE = process.env.PLAYWRIGHT_SETUP_API_URL || `http://${process.env.PLAYWRIGHT_SETUP_API_HOST || "127.0.0.1"}:${process.env.PLAYWRIGHT_SETUP_API_PORT || "3010"}`;

type ReadinessCheck = { command: string; ok: boolean; output: string };
type ReadinessResponse = { ok: boolean; checks: ReadinessCheck[] };

export async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${API_BASE}${path}`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
}

export async function apiPost<T>(request: APIRequestContext, path: string, body: unknown): Promise<T> {
  const response = await request.post(`${API_BASE}${path}`, { data: body });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
}

export async function stopContainer(request: APIRequestContext) {
  await request.post(`${API_BASE}/api/docker/stop`, { data: {} });
}

function runDockerExec(command: string): string {
  return execFileSync("docker", ["exec", "jira-automation", "sh", "-lc", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function getClaudeAuthStatusRaw(): string {
  try {
    return runDockerExec("claude auth status 2>&1 || true");
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: string }).stderr || "") : "";
    const stdout = error instanceof Error && "stdout" in error ? String((error as { stdout?: string }).stdout || "") : "";
    return [stdout, stderr].filter(Boolean).join("\n").trim();
  }
}

export function claudeIsLoggedInFromStatus(statusText: string): boolean {
  const lowered = String(statusText || "").toLowerCase();
  if (!lowered) {
    return false;
  }
  if (lowered.includes("not logged in") || lowered.includes("\"loggedin\": false") || lowered.includes("\"authmethod\": \"none\"")) {
    return false;
  }
  if (lowered.includes("\"loggedin\": true")) {
    return true;
  }
  return !lowered.includes("please run /login");
}

export async function waitForClaudeLoginInContainer({
  timeoutMs = 180_000,
  pollMs = 5_000,
  onPoll
}: {
  timeoutMs?: number;
  pollMs?: number;
  onPoll?: (snapshot: { elapsedMs: number; status: string }) => void | Promise<void>;
} = {}) {
  const startedAt = Date.now();
  let lastStatus = "";

  while (Date.now() - startedAt < timeoutMs) {
    lastStatus = getClaudeAuthStatusRaw();
    if (onPoll) {
      await onPoll({ elapsedMs: Date.now() - startedAt, status: lastStatus });
    }
    if (claudeIsLoggedInFromStatus(lastStatus)) {
      return { ok: true, status: lastStatus };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return { ok: false, status: lastStatus };
}

export function persistedAuthConfig(agent: Agent): ConfigMap {
  if (agent === "claude") {
    return {
      AI_AGENT: "claude",
      CLAUDE_BOOTSTRAP_LOGIN: "false",
      CLAUDE_DEVICE_LOGIN_ON_START: "false"
    };
  }

  return {
    AI_AGENT: "codex",
    CODEX_BOOTSTRAP_LOGIN: "false",
    CODEX_DEVICE_LOGIN_ON_START: "false"
  };
}

export async function expectPersistedIntegrationLoginToBeValid(request: APIRequestContext, agent: Agent) {
  const authResult = await apiPost<ReadinessResponse>(
    request,
    "/api/checks/integration-container-auth",
    { config: persistedAuthConfig(agent) }
  );

  expect(authResult.ok).toBeTruthy();
  expect(authResult.checks.some((check) => check.ok && check.command.includes("login"))).toBeTruthy();
}
