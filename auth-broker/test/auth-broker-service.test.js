import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

import { createAuthBrokerService } from "../src/services/auth-broker-service.js";

function createExecFileMock(handler) {
  const mock = (file, args, options, callback) => {
    Promise.resolve(handler(file, args, options))
      .then(({ stdout = "", stderr = "" }) => callback(null, stdout, stderr))
      .catch((error) => callback(error));
  };
  mock[promisify.custom] = (file, args, options) => Promise.resolve(handler(file, args, options));
  return mock;
}

test("runPreflight warns for unsupported Claude runtime without blocking login", async () => {
  const service = createAuthBrokerService({
    nodeVersion: "25.6.1",
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which" && args[0] === "docker") {
        return { stdout: "/usr/local/bin/docker" };
      }
      if (file === "/usr/local/bin/docker" && args[0] === "version") {
        return { stdout: "Docker version" };
      }
      if (file === "/usr/local/bin/docker" && args[0] === "ps") {
        return { stdout: "Up 2 minutes" };
      }
      if (file === "/usr/local/bin/docker" && args[0] === "exec") {
        return { stdout: "writable" };
      }
      throw new Error(`unexpected ${file} ${args.join(" ")}`);
    })
  });

  const result = await service.runPreflight("claude");
  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.code === "unsupported_runtime")?.severity, "warning");
});

test("startAuthSession returns Codex waiting_for_browser state from interactive session output", async () => {
  let onDataHandler = () => {};
  let onExitHandler = () => {};
  const service = createAuthBrokerService({
    nodeVersion: "22.13.0",
    ptyImpl: {
      spawn() {
        return {
          onData(callback) {
            onDataHandler = callback;
          },
          onExit(callback) {
            onExitHandler = callback;
          },
          kill() {
            onExitHandler({ exitCode: 0 });
          }
        };
      }
    },
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which" && args[0] === "docker") {
        return { stdout: "/usr/local/bin/docker" };
      }
      if (file === "/usr/local/bin/docker" && args[0] === "version") {
        return { stdout: "Docker version" };
      }
      if (file === "/usr/local/bin/docker" && args[0] === "ps" && args[1] === "-a") {
        return { stdout: "Up 2 minutes" };
      }
      if (file === "/usr/local/bin/docker" && args[0] === "exec" && args[4] === "codex --version") {
        return { stdout: "codex 1.2.3" };
      }
      if (file === "/usr/local/bin/docker" && args[0] === "exec" && args[4] === "codex login status") {
        const error = new Error("not logged in");
        error.stderr = "Not logged in";
        throw error;
      }
      return { stdout: "writable" };
    })
  });

  setTimeout(() => {
    onDataHandler("Starting interactive Codex device auth...\nOpen this link in your browser:\nhttps://auth.openai.com/codex/device\nCode: ABCD-12345\n");
  }, 50);

  const result = await service.startAuthSession("codex");
  assert.equal(result.ok, true);
  assert.equal(result.session.state, "waiting_for_browser");
  assert.equal(result.session.browserUrl, "https://auth.openai.com/codex/device");
  assert.equal(result.session.code, "ABCD-12345");
});
