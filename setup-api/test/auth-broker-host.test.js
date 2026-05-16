import test from "node:test";
import assert from "node:assert/strict";

import { createAuthBrokerHostManager } from "../src/services/auth-broker-host.js";

test("ensureAvailable bypasses host startup for non-launcher transport", async () => {
  const manager = createAuthBrokerHostManager({
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
    spawnImpl: () => {
      throw new Error("should not spawn");
    }
  });

  const result = await manager.ensureAvailable({
    transport: "standalone_http",
    baseUrl: "http://127.0.0.1:3020"
  });

  assert.deepEqual(result, { ok: true, started: false, status: "transport-bypassed" });
});

test("ensureAvailable spawns native launcher broker host in dev emulation mode", async () => {
  const spawnCalls = [];
  let healthChecks = 0;
  const manager = createAuthBrokerHostManager({
    env: { AUTH_BROKER_DEV_EMULATION: "true" },
    execPath: "/usr/local/bin/node",
    fetchImpl: async () => {
      healthChecks += 1;
      if (healthChecks < 3) {
        throw new Error("connection refused");
      }
      return { ok: true };
    },
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return {
        unref() {}
      };
    }
  });

  const result = await manager.ensureAvailable({
    transport: "launcher_http",
    baseUrl: "http://127.0.0.1:3020"
  });

  assert.equal(result.ok, true);
  assert.equal(result.started, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "cargo");
  assert.deepEqual(spawnCalls[0].args, ["run", "--quiet"]);
  assert.match(spawnCalls[0].options.cwd, /launcher\/src-tauri$/);
  assert.equal(spawnCalls[0].options.env.AUTH_BROKER_BIND, "127.0.0.1:3020");
});

test("ensureAvailable does not spawn broker host in launcher mode unless dev emulation is enabled", async () => {
  const manager = createAuthBrokerHostManager({
    env: {},
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
    spawnImpl: () => {
      throw new Error("should not spawn");
    }
  });

  const result = await manager.ensureAvailable({
    transport: "launcher_http",
    baseUrl: "http://127.0.0.1:3020"
  });

  assert.equal(result.ok, false);
  assert.equal(result.started, false);
  assert.equal(result.status, "unreachable");
  assert.match(result.error, /AUTH_BROKER_DEV_EMULATION=true/);
});

test("ensureAvailable supports legacy node host emulation when explicitly configured", async () => {
  const spawnCalls = [];
  let healthChecks = 0;
  const manager = createAuthBrokerHostManager({
    env: { AUTH_BROKER_DEV_EMULATION: "true", AUTH_BROKER_DEV_EMULATION_HOST: "node" },
    execPath: "/usr/local/bin/node",
    fetchImpl: async () => {
      healthChecks += 1;
      if (healthChecks < 3) {
        throw new Error("connection refused");
      }
      return { ok: true };
    },
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return {
        unref() {}
      };
    }
  });

  const result = await manager.ensureAvailable({
    transport: "launcher_http",
    baseUrl: "http://127.0.0.1:3020"
  });

  assert.equal(result.ok, true);
  assert.equal(result.started, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "/usr/local/bin/node");
  assert.match(spawnCalls[0].args[0], /auth-broker\/src\/server\.js$/);
  assert.equal(spawnCalls[0].options.env.AUTH_BROKER_HOST_TYPE, "launcher_managed_dev_host");
  assert.equal(spawnCalls[0].options.env.AUTH_BROKER_HOST_MODE, "launcher_http");
});
