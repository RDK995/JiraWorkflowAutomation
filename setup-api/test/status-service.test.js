import test from "node:test";
import assert from "node:assert/strict";

import { createStatusService } from "../src/services/status-service.js";

test("getJiraReadinessStatus reports missing Jira fields", async () => {
  const service = createStatusService();
  const result = await service.getJiraReadinessStatus({});
  assert.equal(result.ok, false);
  assert.match(result.checks[0].output, /Missing required fields/);
});

test("getJiraReadinessStatus returns authenticated user on success", async () => {
  const calls = [];
  const service = createStatusService({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ displayName: "Ryan Kenny" })
      };
    }
  });

  const result = await service.getJiraReadinessStatus({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_USER_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira-token"
  });

  assert.equal(result.ok, true);
  assert.match(result.checks[0].output, /Ryan Kenny/);
  assert.equal(calls[0].url, "https://example.atlassian.net/rest/api/3/myself");
});

test("getJiraWebhookDeliveryStatus requires running PRonto service", async () => {
  const service = createStatusService({
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    }
  });

  const result = await service.getJiraWebhookDeliveryStatus({});

  assert.equal(result.ok, false);
  assert.match(result.checks[0].output, /Launch PRonto before testing webhook delivery/);
});

test("getJiraWebhookDeliveryStatus posts a test webhook to the public ngrok url", async () => {
  const calls = [];
  const service = createStatusService({
    getContainerLogsImpl: async () => ({ logs: "Tunnel established at https://demo.ngrok-free.app" }),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === "http://127.0.0.1:3000/health") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "ok" })
        };
      }
      if (url === "https://demo.ngrok-free.app/webhooks/jira-transition") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tested: true })
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    }
  });

  const result = await service.getJiraWebhookDeliveryStatus({
    READY_STATUS: "Ready",
    IN_PROGRESS_STATUS: "In Progress",
    JIRA_WEBHOOK_SECRET: "secret"
  });

  assert.equal(result.ok, true);
  assert.equal(calls[1].url, "https://demo.ngrok-free.app/webhooks/jira-transition");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers["x-pronto-webhook-test"], "true");
  assert.equal(calls[1].options.headers["x-jira-webhook-secret"], "secret");
});

test("getGitHubReadinessStatus reports missing token", async () => {
  const service = createStatusService();
  const result = await service.getGitHubReadinessStatus({});
  assert.equal(result.ok, false);
  assert.match(result.checks[0].output, /GITHUB_TOKEN or GH_TOKEN/);
});

test("getGitHubReadinessStatus returns authenticated login on success", async () => {
  const service = createStatusService({
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.github.com/user");
      assert.match(options.headers.Authorization, /^Bearer /);
      return {
        ok: true,
        json: async () => ({ login: "ryankenny" })
      };
    }
  });

  const result = await service.getGitHubReadinessStatus({
    GITHUB_TOKEN: "ghp_token"
  });

  assert.equal(result.ok, true);
  assert.match(result.checks[0].output, /ryankenny/);
});

test("getCodexReadinessStatus reports missing auth options", async () => {
  const service = createStatusService();
  const result = await service.getCodexReadinessStatus({
    CODEX_BOOTSTRAP_LOGIN: "true",
    CODEX_DEVICE_LOGIN_ON_START: "false"
  });
  assert.equal(result.ok, false);
  assert.match(result.checks[0].output, /CODEX_API_KEY or OPENAI_API_KEY/);
});

test("getCodexReadinessStatus validates OpenAI API key", async () => {
  const service = createStatusService({
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/models");
      assert.match(options.headers.Authorization, /^Bearer /);
      return {
        ok: true,
        json: async () => ({ data: [] })
      };
    }
  });

  const result = await service.getCodexReadinessStatus({
    OPENAI_API_KEY: "sk-test"
  });

  assert.equal(result.ok, true);
  assert.match(result.checks[0].output, /OPENAI_API_KEY/);
});

test("getCodexReadinessStatus accepts device login mode", async () => {
  const service = createStatusService();
  const result = await service.getCodexReadinessStatus({
    CODEX_DEVICE_LOGIN_ON_START: "true"
  });
  assert.equal(result.ok, true);
  assert.match(result.checks[0].output, /Device login is enabled/);
});

test("getCodexReadinessStatus accepts Claude device login mode", async () => {
  const service = createStatusService();

  const result = await service.getCodexReadinessStatus({
    AI_AGENT: "claude",
    CLAUDE_BOOTSTRAP_LOGIN: "true",
    CLAUDE_DEVICE_LOGIN_ON_START: "true"
  });

  assert.equal(result.ok, true);
  assert.match(result.checks[0].output, /Device login is enabled/);
});

test("getCodexReadinessStatus accepts Claude persisted login mode", async () => {
  const service = createStatusService();
  const result = await service.getCodexReadinessStatus({
    AI_AGENT: "claude",
    CLAUDE_BOOTSTRAP_LOGIN: "false",
    CLAUDE_DEVICE_LOGIN_ON_START: "false"
  });

  assert.equal(result.ok, true);
  assert.match(result.checks[0].output, /Persisted login mode selected/);
});

test("getCodexReadinessStatus rejects invalid Claude login mode combination", async () => {
  const service = createStatusService();
  const result = await service.getCodexReadinessStatus({
    AI_AGENT: "claude",
    CLAUDE_BOOTSTRAP_LOGIN: "true",
    CLAUDE_DEVICE_LOGIN_ON_START: "false"
  });

  assert.equal(result.ok, false);
  assert.match(result.checks[0].output, /Enable CLAUDE_DEVICE_LOGIN_ON_START/);
});

test("getNgrokReadinessStatus passes when ngrok is disabled", async () => {
  const service = createStatusService();
  const result = await service.getNgrokReadinessStatus({ NGROK_ENABLE: "false" });
  assert.equal(result.ok, true);
  assert.match(result.checks[0].output, /ngrok is disabled/i);
});

test("getNgrokReadinessStatus requires authtoken when enabled", async () => {
  const service = createStatusService();
  const result = await service.getNgrokReadinessStatus({ NGROK_ENABLE: "true" });
  assert.equal(result.ok, false);
  assert.match(result.checks[0].output, /NGROK_AUTHTOKEN/);
});

test("getNgrokReadinessStatus validates reserved domain with ngrok api", async () => {
  const service = createStatusService({
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.ngrok.com/reserved_domains");
      assert.equal(options.headers["ngrok-version"], "2");
      return {
        ok: true,
        json: async () => ({ reserved_domains: [{ domain: "demo.ngrok-free.app" }] })
      };
    }
  });

  const result = await service.getNgrokReadinessStatus({
    NGROK_ENABLE: "true",
    NGROK_AUTHTOKEN: "token",
    NGROK_API_KEY: "api-key",
    NGROK_DOMAIN: "demo.ngrok-free.app"
  });

  assert.equal(result.ok, true);
  assert.match(result.checks[1].output, /demo.ngrok-free.app/);
});

test("getHealthStatus returns error when service is unavailable", async () => {
  const service = createStatusService({
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    }
  });

  const result = await service.getHealthStatus();
  assert.equal(result.reachable, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test("getFullStatus combines config, docker, health, and logs", async () => {
  const tails = [];
  const service = createStatusService({
    readCurrentConfigImpl: async () => ({ exists: true, config: { PORT: "3000" } }),
    getDockerStatusImpl: async () => ({ available: true, imageExists: true, container: { exists: true, running: true } }),
    getContainerLogsImpl: async (tail) => {
      tails.push(tail);
      return {
        logs: tail === 400 ? "Created https://github.com/RDK995/ExampleFrontend/pull/5" : "tail logs"
      };
    },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: "ok" }) })
  });

  const result = await service.getFullStatus();
  assert.equal(result.config.exists, true);
  assert.equal(result.docker.available, true);
  assert.equal(result.health.reachable, true);
  assert.equal(result.logs, "tail logs");
  assert.deepEqual(result.createdPullRequests, ["https://github.com/RDK995/ExampleFrontend/pull/5"]);
  assert.deepEqual(tails, [80, 400]);
});

test("getFullStatus skips container logs when the PRonto container does not exist yet", async () => {
  let logsCalled = false;
  const service = createStatusService({
    readCurrentConfigImpl: async () => ({ exists: true, config: {} }),
    getDockerStatusImpl: async () => ({
      available: true,
      imageExists: true,
      container: { exists: false, running: false, status: "not-created", name: "jira-automation" }
    }),
    getContainerLogsImpl: async () => {
      logsCalled = true;
      return { logs: "should not be fetched" };
    },
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    }
  });

  const result = await service.getFullStatus();
  assert.equal(logsCalled, false);
  assert.equal(result.logs, "");
  assert.deepEqual(result.createdPullRequests, []);
});
