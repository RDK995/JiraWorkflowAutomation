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
