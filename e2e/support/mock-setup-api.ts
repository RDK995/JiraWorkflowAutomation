import type { Page, Route } from "@playwright/test";

import type { Agent, ConfigMap } from "./types";

const baseConfig: ConfigMap = {
  PORT: "3000",
  JIRA_BASE_URL: "https://example.atlassian.net",
  JIRA_USER_EMAIL: "engineer@example.com",
  JIRA_API_TOKEN: "jira-token",
  JIRA_WEBHOOK_SECRET: "",
  READY_STATUS: "To Do",
  IN_PROGRESS_STATUS: "In Progress",
  IN_REVIEW_STATUS: "In Review",
  GITHUB_TOKEN: "github-token",
  GH_TOKEN: "",
  REQUIRE_GITHUB_AUTH: "true",
  AI_AGENT: "codex",
  CODEX_API_KEY: "",
  OPENAI_API_KEY: "",
  CODEX_BOOTSTRAP_LOGIN: "true",
  CODEX_DEVICE_LOGIN_ON_START: "true",
  CLAUDE_BOOTSTRAP_LOGIN: "true",
  CLAUDE_DEVICE_LOGIN_ON_START: "true",
  WORKFLOW_BASE_BRANCH: "main",
  CODEX_EXEC_ARGS: "--full-auto",
  ANTHROPIC_API_KEY: "",
  CLAUDE_EXEC_ARGS: "--permission-mode auto --allowedTools Bash,Read,Edit,Write",
  NGROK_ENABLE: "true",
  NGROK_AUTHTOKEN: "ngrok-token",
  NGROK_API_KEY: "ngrok-api-key",
  NGROK_DOMAIN: "pronto.ngrok-free.app"
};

type MockState = {
  running: boolean;
  logs: string;
  authSessionId: string;
  authSessionState: string;
  authSessionCode: string;
  claudeLoginConfirmed: boolean;
};

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(payload)
  });
}

function createInitialState(): MockState {
  return {
    running: false,
    logs: "",
    authSessionId: "session-1",
    authSessionState: "starting",
    authSessionCode: "",
    claudeLoginConfirmed: false
  };
}

export async function mockSetupApi(page: Page, agent: Agent) {
  return mockSetupApiWithOptions(page, agent, {});
}

type MockOptions = {
  claudeRequiresCode?: boolean;
};

export async function mockSetupApiWithOptions(page: Page, agent: Agent, options: MockOptions = {}) {
  const config = {
    ...baseConfig,
    AI_AGENT: agent
  };
  const state = createInitialState();
  const claudeRequiresCode = options.claudeRequiresCode ?? true;

  await page.route(/http:\/\/localhost:3010\/api\/.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "GET" && path === "/api/config") {
      await fulfillJson(route, { config });
      return;
    }

    if (method === "GET" && path === "/api/checks/prerequisites") {
      await fulfillJson(route, {
        dockerInstalled: true,
        envFilePresent: true,
        recommendedPorts: { setupApi: 3010, automationApp: 3000 }
      });
      return;
    }

    if (method === "GET" && path === "/api/status") {
      const logs = state.running
        ? (agent === "codex"
            ? "Starting interactive Codex device auth...\nOpen this link in your browser:\nhttps://auth.openai.com/codex/device\nCode: ABCD-12345\nCode expires in 10m."
            : state.logs)
        : "";

      await fulfillJson(route, {
        config: { exists: true, values: config },
        docker: {
          available: true,
          imageExists: true,
          container: {
            exists: state.running,
            running: state.running,
            status: state.running ? "Up 10 seconds" : "not-created",
            name: "jira-automation"
          }
        },
        health: {
          reachable: state.running
        },
        logs,
        createdPullRequests: []
      });
      return;
    }

    if (method === "POST" && path === "/api/config/validate") {
      await fulfillJson(route, { config, errors: {}, isValid: true });
      return;
    }

    if (method === "POST" && path === "/api/config/save") {
      await fulfillJson(route, { config, errors: {}, isValid: true, saved: true });
      return;
    }

    if (method === "POST" && path === "/api/checks/docker-readiness") {
      await fulfillJson(route, { ok: true, checks: [{ command: "docker version", ok: true, output: "ready" }] });
      return;
    }

    if (method === "POST" && path === "/api/checks/jira-readiness") {
      await fulfillJson(route, { ok: true, checks: [{ command: "jira connectivity", ok: true, output: "Authenticated as engineer@example.com" }] });
      return;
    }

    if (method === "POST" && path === "/api/checks/github-readiness") {
      await fulfillJson(route, { ok: true, checks: [{ command: "github connectivity", ok: true, output: "Authenticated as pronto-user" }] });
      return;
    }

    if (method === "POST" && path === "/api/checks/codex-readiness") {
      await fulfillJson(route, { ok: true, checks: [{ command: "integration readiness", ok: true, output: `${agent} ready` }] });
      return;
    }

    if (method === "POST" && path === "/api/checks/ngrok-readiness") {
      await fulfillJson(route, { ok: true, checks: [{ command: "ngrok", ok: true, output: "Tunnel ready" }] });
      return;
    }

    if (method === "POST" && path === "/api/docker/run") {
      state.running = true;
      state.logs = "PRonto container started.";
      await fulfillJson(route, { ok: true, output: "container-started" });
      return;
    }

    if (method === "POST" && path === "/api/docker/stop") {
      state.running = false;
      await fulfillJson(route, { ok: true, output: "container-stopped" });
      return;
    }

    if (method === "POST" && path === "/api/checks/jira-webhook-delivery") {
      await fulfillJson(route, { ok: true, checks: [{ command: "webhook delivery", ok: true, output: "delivered" }] });
      return;
    }

    if (method === "POST" && path === "/api/checks/integration-container-auth") {
      await fulfillJson(route, {
        ok: true,
        checks: [
          { command: `${agent} cli`, ok: true, output: `${agent} cli present` },
          { command: `${agent} login`, ok: true, output: `${agent} login confirmed` }
        ]
      });
      return;
    }

    if (method === "GET" && path === "/api/auth/health") {
      await fulfillJson(route, {
        ok: true,
        service: "auth-broker",
        nodeVersion: "22.13.0",
        providers: [
          { id: "claude", label: "Claude Code" },
          { id: "codex", label: "Codex" }
        ],
        transportInfo: {
          transport: "launcher_http",
          baseUrl: "http://127.0.0.1:3020",
          targetLabel: "launcher-managed auth broker"
        }
      });
      return;
    }

    if (method === "POST" && path === "/api/auth/preflight") {
      await fulfillJson(route, {
        ok: true,
        provider: agent,
        checks: [],
        state: "preflight"
      });
      return;
    }

    if (method === "POST" && path === "/api/auth/sessions/start") {
      state.authSessionState = agent === "claude"
        ? (claudeRequiresCode ? "waiting_for_code" : "waiting_for_browser")
        : "waiting_for_browser";
      state.authSessionCode = agent === "codex" ? "ABCD-12345" : (claudeRequiresCode ? "AUTH-CODE-1234" : "");
      await fulfillJson(route, {
        ok: true,
        session: {
          id: state.authSessionId,
          provider: agent,
          state: state.authSessionState,
          output: "Open browser to sign in.",
          browserUrl: agent === "claude" ? "https://claude.example/device" : "https://auth.openai.com/codex/device",
          code: state.authSessionCode,
          requiresCode: agent === "claude" ? claudeRequiresCode : false,
          persistenceVerified: false,
          error: null,
          createdAt: "",
          updatedAt: ""
        }
      });
      return;
    }

    if (method === "GET" && path === `/api/auth/sessions/${state.authSessionId}`) {
      await fulfillJson(route, {
        ok: true,
        session: {
          id: state.authSessionId,
          provider: agent,
          state: state.claudeLoginConfirmed ? "authenticated" : state.authSessionState,
          output: state.claudeLoginConfirmed ? "Authenticated." : "Waiting for provider sign-in.",
          browserUrl: state.claudeLoginConfirmed ? "" : (agent === "claude" ? "https://claude.example/device" : "https://auth.openai.com/codex/device"),
          code: state.authSessionCode,
          requiresCode: agent === "claude" ? claudeRequiresCode : false,
          persistenceVerified: state.claudeLoginConfirmed,
          error: null,
          createdAt: "",
          updatedAt: ""
        }
      });
      return;
    }

    if (method === "POST" && path === `/api/auth/sessions/${state.authSessionId}/code`) {
      state.authSessionCode = "AUTH-CODE-1234";
      state.authSessionState = "verifying";
      state.claudeLoginConfirmed = true;
      await fulfillJson(route, {
        ok: true,
        session: {
          id: state.authSessionId,
          provider: agent,
          state: "verifying",
          output: "Authorization code accepted.",
          browserUrl: "https://claude.example/device",
          code: state.authSessionCode,
          requiresCode: true,
          persistenceVerified: false,
          error: null,
          createdAt: "",
          updatedAt: ""
        }
      });
      return;
    }

    if (method === "POST" && path === `/api/auth/sessions/${state.authSessionId}/login`) {
      state.authSessionState = claudeRequiresCode ? "waiting_for_code" : "waiting_for_browser";
      await fulfillJson(route, {
        ok: true,
        session: {
          id: state.authSessionId,
          provider: agent,
          state: state.authSessionState,
          output: "Claude login command accepted.",
          browserUrl: "https://claude.example/device",
          code: claudeRequiresCode ? "AUTH-CODE-1234" : "",
          requiresCode: agent === "claude" ? claudeRequiresCode : false,
          persistenceVerified: false,
          error: null,
          createdAt: "",
          updatedAt: ""
        }
      });
      return;
    }

    if (method === "POST" && path === `/api/auth/sessions/${state.authSessionId}/verify`) {
      state.authSessionState = "authenticated";
      state.claudeLoginConfirmed = true;
      await fulfillJson(route, {
        ok: true,
        session: {
          id: state.authSessionId,
          provider: agent,
          state: "authenticated",
          output: "Provider login confirmed.",
          browserUrl: "",
          code: "",
          requiresCode: false,
          persistenceVerified: true,
          error: null,
          createdAt: "",
          updatedAt: ""
        }
      });
      return;
    }

    await fulfillJson(route, { ok: true });
  });
}
