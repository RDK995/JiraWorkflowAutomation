import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createRequestListener } from "../src/server.js";

async function invokeRoute({ method = "GET", url = "/", body, headers = {}, deps = {} }) {
  const listener = createRequestListener({
    serveStaticAssetImpl: async () => false,
    ...deps
  });

  const chunks = [];
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = headers;

  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode, responseHeaders = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(responseHeaders)) {
        this.headers[name.toLowerCase()] = value;
      }
    },
    end(chunk) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      this.finished = true;
    }
  };

  await listener(request, response);

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: Buffer.concat(chunks).toString("utf8")
  };
}

test("GET /api/status returns mocked status payload", async () => {
  const response = await invokeRoute({
    url: "/api/status",
    deps: {
      getFullStatusImpl: async () => ({ ok: true })
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});

test("POST /api/config/validate validates provided config", async () => {
  const response = await invokeRoute({
    method: "POST",
    url: "/api/config/validate",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ config: {} })
  });

  const payload = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(payload.isValid, false);
  assert.ok(payload.errors.JIRA_BASE_URL);
});

test("POST /api/checks/jira-readiness forwards form config to service", async () => {
  let seenConfig;
  const config = { JIRA_BASE_URL: "https://example.atlassian.net" };
  const response = await invokeRoute({
    method: "POST",
    url: "/api/checks/jira-readiness",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ config }),
    deps: {
      getJiraReadinessStatusImpl: async (value) => {
        seenConfig = value;
        return { ok: true, checks: [] };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seenConfig, config);
});

test("POST /api/checks/jira-webhook-delivery forwards form config to service", async () => {
  let seenConfig;
  const config = { JIRA_WEBHOOK_SECRET: "secret" };
  const response = await invokeRoute({
    method: "POST",
    url: "/api/checks/jira-webhook-delivery",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ config }),
    deps: {
      getJiraWebhookDeliveryStatusImpl: async (value) => {
        seenConfig = value;
        return { ok: true, checks: [] };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seenConfig, config);
});

test("POST /api/checks/github-readiness forwards form config to service", async () => {
  let seenConfig;
  const config = { GITHUB_TOKEN: "ghp_token" };
  const response = await invokeRoute({
    method: "POST",
    url: "/api/checks/github-readiness",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ config }),
    deps: {
      getGitHubReadinessStatusImpl: async (value) => {
        seenConfig = value;
        return { ok: true, checks: [] };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seenConfig, config);
});

test("POST /api/checks/codex-readiness forwards form config to service", async () => {
  let seenConfig;
  const config = { OPENAI_API_KEY: "sk-test" };
  const response = await invokeRoute({
    method: "POST",
    url: "/api/checks/codex-readiness",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ config }),
    deps: {
      getCodexReadinessStatusImpl: async (value) => {
        seenConfig = value;
        return { ok: true, checks: [] };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seenConfig, config);
});

test("POST /api/checks/codex-container-auth calls the docker service", async () => {
  let called = false;
  let seenConfig;
  const config = { AI_AGENT: "claude" };
  const response = await invokeRoute({
    method: "POST",
    url: "/api/checks/codex-container-auth",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ config }),
    deps: {
      getAiContainerAuthStatusImpl: async (value) => {
        called = true;
        seenConfig = value;
        return { ok: true, checks: [] };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(called, true);
  assert.deepEqual(seenConfig, config);
});

test("GET /api/auth/health proxies auth broker health", async () => {
  const response = await invokeRoute({
    method: "GET",
    url: "/api/auth/health",
    deps: {
      getAuthBrokerHealthImpl: async () => ({ ok: true, service: "auth-broker" }),
      getAuthBrokerTransportInfoImpl: () => ({ transport: "launcher_http", baseUrl: "http://127.0.0.1:3020", targetLabel: "launcher-managed auth broker" })
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    service: "auth-broker",
    transportInfo: {
      transport: "launcher_http",
      baseUrl: "http://127.0.0.1:3020",
      targetLabel: "launcher-managed auth broker"
    }
  });
});

test("POST /api/auth/preflight forwards provider and context", async () => {
  let seenProvider;
  let seenContext;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/auth/preflight",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ provider: "claude", context: { AI_AGENT: "claude" } }),
    deps: {
      runAuthBrokerPreflightImpl: async (provider, context) => {
        seenProvider = provider;
        seenContext = context;
        return { ok: true, provider, checks: [], state: "preflight" };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenProvider, "claude");
  assert.deepEqual(seenContext, { AI_AGENT: "claude" });
});

test("POST /api/auth/sessions/start forwards provider and context", async () => {
  let seenProvider;
  let seenContext;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/auth/sessions/start",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ provider: "codex", context: { AI_AGENT: "codex" } }),
    deps: {
      startAuthBrokerSessionImpl: async (provider, context) => {
        seenProvider = provider;
        seenContext = context;
        return { ok: true, session: { id: "session-1", provider, state: "starting" } };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenProvider, "codex");
  assert.deepEqual(seenContext, { AI_AGENT: "codex" });
});

test("GET /api/auth/sessions/:id forwards session status lookup", async () => {
  let seenSessionId;
  const response = await invokeRoute({
    method: "GET",
    url: "/api/auth/sessions/session-1",
    headers: { host: "localhost" },
    deps: {
      getAuthBrokerSessionStatusImpl: async (sessionId) => {
        seenSessionId = sessionId;
        return { ok: true, session: { id: sessionId, provider: "claude", state: "waiting_for_code" } };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenSessionId, "session-1");
});

test("POST /api/auth/sessions/:id/code forwards auth code submission", async () => {
  let seenSessionId;
  let seenCode;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/auth/sessions/session-1/code",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ code: "ABCD-1234" }),
    deps: {
      submitAuthBrokerCodeImpl: async (sessionId, code) => {
        seenSessionId = sessionId;
        seenCode = code;
        return { ok: true, session: { id: sessionId, provider: "claude", state: "verifying" } };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenSessionId, "session-1");
  assert.equal(seenCode, "ABCD-1234");
});

test("POST /api/auth/sessions/:id/verify forwards verify call", async () => {
  let seenSessionId;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/auth/sessions/session-1/verify",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({}),
    deps: {
      verifyAuthBrokerSessionImpl: async (sessionId) => {
        seenSessionId = sessionId;
        return { ok: true, session: { id: sessionId, provider: "codex", state: "authenticated" } };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenSessionId, "session-1");
});

test("POST /api/auth/sessions/:id/cancel forwards cancel call", async () => {
  let seenSessionId;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/auth/sessions/session-1/cancel",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({}),
    deps: {
      cancelAuthBrokerSessionImpl: async (sessionId) => {
        seenSessionId = sessionId;
        return { ok: true, session: { id: sessionId, provider: "codex", state: "cancelled" } };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenSessionId, "session-1");
});

test("legacy Claude device auth compatibility routes are removed", async () => {
  const response = await invokeRoute({
    method: "POST",
    url: "/api/checks/claude-device-login/start",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(response.statusCode, 404);
});

test("POST /api/checks/ngrok-readiness forwards form config to service", async () => {
  let seenConfig;
  const config = { NGROK_ENABLE: "true", NGROK_AUTHTOKEN: "token" };
  const response = await invokeRoute({
    method: "POST",
    url: "/api/checks/ngrok-readiness",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ config }),
    deps: {
      getNgrokReadinessStatusImpl: async (value) => {
        seenConfig = value;
        return { ok: true, checks: [] };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seenConfig, config);
});

test("POST /api/docker/start-colima calls the docker service", async () => {
  let called = false;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/start-colima",
    headers: { host: "localhost" },
    deps: {
      startColimaImpl: async () => {
        called = true;
        return { ok: true, output: "started" };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(called, true);
});

test("POST /api/docker/build returns structured failure payloads", async () => {
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/build",
    headers: { host: "localhost" },
    deps: {
      buildImageImpl: async () => ({
        ok: false,
        output: "build failed",
        diagnosis: {
          code: "docker_build_failed",
          title: "Build failed",
          message: "Review Docker output"
        }
      })
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).diagnosis.code, "docker_build_failed");
});

test("POST /api/docker/network-check calls the docker service", async () => {
  let called = false;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/network-check",
    headers: { host: "localhost" },
    deps: {
      runDockerNetworkCheckImpl: async () => {
        called = true;
        return { ok: true, checks: [] };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(called, true);
});

test("POST /api/docker/reset-builder-cache calls the docker service", async () => {
  let called = false;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/reset-builder-cache",
    headers: { host: "localhost" },
    deps: {
      resetDockerBuilderCacheImpl: async () => {
        called = true;
        return { ok: true, output: "cleared" };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(called, true);
});

test("POST /api/docker/start-colima returns structured failure payloads", async () => {
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/start-colima",
    headers: { host: "localhost" },
    deps: {
      startColimaImpl: async () => ({
        ok: false,
        output: "colima missing",
        diagnosis: {
          code: "colima_not_installed",
          title: "Colima missing",
          message: "Install Colima"
        }
      })
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).diagnosis.code, "colima_not_installed");
});

test("POST /api/docker/open-docker-desktop calls the docker service", async () => {
  let called = false;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/open-docker-desktop",
    headers: { host: "localhost" },
    deps: {
      openDockerDesktopImpl: async () => {
        called = true;
        return { ok: true, output: "opened" };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(called, true);
});

test("POST /api/docker/open-docker-desktop returns structured failure payloads", async () => {
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/open-docker-desktop",
    headers: { host: "localhost" },
    deps: {
      openDockerDesktopImpl: async () => ({
        ok: false,
        output: "docker desktop missing",
        diagnosis: {
          code: "docker_desktop_not_installed",
          title: "Docker Desktop missing",
          message: "Install Docker Desktop"
        }
      })
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).diagnosis.code, "docker_desktop_not_installed");
});

test("GET /api/docker/contexts calls the docker service", async () => {
  let called = false;
  const response = await invokeRoute({
    url: "/api/docker/contexts",
    headers: { host: "localhost" },
    deps: {
      listDockerContextsImpl: async () => {
        called = true;
        return { ok: true, contexts: [] };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(called, true);
});

test("POST /api/docker/context/use calls the docker service", async () => {
  let seenName;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/context/use",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ name: "default" }),
    deps: {
      switchDockerContextImpl: async (name) => {
        seenName = name;
        return { ok: true, output: "switched" };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenName, "default");
});

test("POST /api/docker/run stops existing container before starting", async () => {
  const order = [];
  const response = await invokeRoute({
    method: "POST",
    url: "/api/docker/run",
    headers: { host: "localhost" },
    deps: {
      stopContainerImpl: async () => {
        order.push("stop");
        return { ok: true };
      },
      runContainerImpl: async () => {
        order.push("run");
        return { ok: true };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(order, ["stop", "run"]);
});

test("GET unknown route falls back to 404 when no static asset exists", async () => {
  const response = await invokeRoute({
    url: "/missing",
    headers: { host: "localhost" }
  });

  assert.equal(response.statusCode, 404);
});

test("GET unknown api route returns JSON 404 before SPA fallback", async () => {
  const response = await invokeRoute({
    url: "/api/typo",
    headers: { host: "localhost" },
    deps: {
      serveStaticAssetImpl: async (requestPath) => requestPath === "/"
    }
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: "Not found" });
});
