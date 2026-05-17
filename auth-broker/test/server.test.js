import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createRequestListener } from "../src/server.js";

async function invokeRoute({ method = "GET", url = "/", body, deps = {} }) {
  const listener = createRequestListener({
    listProviders: () => [],
    ...deps
  });

  const chunks = [];
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = { host: "localhost" };

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
    }
  };

  await listener(request, response);

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: Buffer.concat(chunks).toString("utf8")
  };
}

test("POST /api/auth/sessions/:id/login forwards manual login requests", async () => {
  let seenSessionId;
  const response = await invokeRoute({
    method: "POST",
    url: "/api/auth/sessions/session-1/login",
    deps: {
      runAuthSessionLogin: async (sessionId) => {
        seenSessionId = sessionId;
        return { ok: true, session: { id: sessionId, provider: "claude", state: "waiting_for_browser" } };
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenSessionId, "session-1");
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    session: { id: "session-1", provider: "claude", state: "waiting_for_browser" }
  });
});

test("POST routes return 400 for malformed JSON bodies", async () => {
  const response = await invokeRoute({
    method: "POST",
    url: "/api/auth/preflight",
    body: "{"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "Request body must be valid JSON.");
});
