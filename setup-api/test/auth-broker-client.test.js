import test from "node:test";
import assert from "node:assert/strict";

import { createAuthBrokerClient, getAuthBrokerClientConfig } from "../src/services/auth-broker-client.js";

test("getAuthBrokerClientConfig defaults to launcher broker transport", () => {
  const config = getAuthBrokerClientConfig({});

  assert.deepEqual(config, {
    transport: "launcher_http",
    baseUrl: "http://127.0.0.1:3020",
    targetLabel: "launcher-managed auth broker"
  });
});

test("getAuthBrokerClientConfig supports launcher broker transport", () => {
  const config = getAuthBrokerClientConfig({
    AUTH_BROKER_TRANSPORT: "launcher_http",
    AUTH_BROKER_BASE_URL: "http://127.0.0.1:4123/"
  });

  assert.deepEqual(config, {
    transport: "launcher_http",
    baseUrl: "http://127.0.0.1:4123",
    targetLabel: "launcher-managed auth broker"
  });
});

test("getAuthBrokerClientConfig supports standalone broker transport", () => {
  const config = getAuthBrokerClientConfig({
    AUTH_BROKER_TRANSPORT: "standalone_http",
    AUTH_BROKER_BASE_URL: "http://127.0.0.1:5123/"
  });

  assert.deepEqual(config, {
    transport: "standalone_http",
    baseUrl: "http://127.0.0.1:5123",
    targetLabel: "standalone auth broker"
  });
});

test("createAuthBrokerClient annotates health payload with transport info", async () => {
  const client = createAuthBrokerClient({
    env: {
      AUTH_BROKER_TRANSPORT: "launcher_http",
      AUTH_BROKER_BASE_URL: "http://127.0.0.1:4123"
    },
    ensureAvailableImpl: async () => ({ ok: true, started: false, status: "already-running" }),
    fetchImpl: async () => ({
      ok: true,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type" ? "application/json" : null;
        }
      },
      async json() {
        return { ok: true, service: "auth-broker" };
      }
    })
  });

  const result = await client.getHealth();
  assert.deepEqual(result, {
    ok: true,
    service: "auth-broker",
    transport: "launcher_http",
    baseUrl: "http://127.0.0.1:4123",
    targetLabel: "launcher-managed auth broker"
  });
});

test("createAuthBrokerClient ensures launcher broker availability before requests", async () => {
  let ensured = false;
  const client = createAuthBrokerClient({
    env: {
      AUTH_BROKER_TRANSPORT: "launcher_http"
    },
    ensureAvailableImpl: async () => {
      ensured = true;
      return { ok: true, started: true, status: "started" };
    },
    fetchImpl: async () => ({
      ok: true,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type" ? "application/json" : null;
        }
      },
      async json() {
        return { ok: true, service: "auth-broker" };
      }
    })
  });

  await client.getHealth();
  assert.equal(ensured, true);
});
