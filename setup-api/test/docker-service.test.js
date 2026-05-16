import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

import { createDockerService } from "../src/services/docker-service.js";

const CLAUDE_STATUS_COMMAND = "status_command='claude auth status'; if claude auth status >/tmp/pronto-claude-auth 2>&1; then status_rc=0; elif claude login status >/tmp/pronto-claude-auth 2>&1; then status_command='claude login status'; status_rc=0; elif claude whoami >/tmp/pronto-claude-auth 2>&1; then status_command='claude whoami'; status_rc=0; else status_rc=$?; fi; printf '__PRONTO_CLAUDE_STATUS_COMMAND__:%s\\n' \"$status_command\"; printf '__PRONTO_CLAUDE_STATUS_RC__:%s\\n' \"$status_rc\"; cat /tmp/pronto-claude-auth; exit 0";

function createExecFileMock(handler) {
  const mock = (file, args, options, callback) => {
    Promise.resolve(handler(file, args, options))
      .then(({ stdout = "", stderr = "" }) => callback(null, stdout, stderr))
      .catch((error) => callback(error));
  };
  mock[promisify.custom] = (file, args, options) => Promise.resolve(handler(file, args, options));
  return mock;
}

test("runDockerReadinessCheck treats unsupported docker desktop command as skipped", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/" + args[0] };
      }
      if (args[0] === "context") {
        return { stdout: "default" };
      }
      if (args[0] === "version") {
        return { stdout: "Client and Server" };
      }

      const error = new Error("unsupported");
      error.stderr = "docker: unknown command: docker desktop";
      throw error;
    })
  });

  const result = await service.runDockerReadinessCheck();
  assert.equal(result.ok, true);
  assert.equal(result.checks[1].ok, true);
  assert.equal(result.diagnosis.code, "docker_ready");
});

test("runDockerReadinessCheck classifies missing docker CLI", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which" && args[0] === "docker") {
        throw new Error("not found");
      }
      if (file === "which" && args[0] === "colima") {
        throw new Error("not found");
      }
      const error = new Error("missing");
      error.stderr = "docker: command not found";
      throw error;
    })
  });

  const result = await service.runDockerReadinessCheck();
  assert.equal(result.ok, false);
  assert.equal(result.diagnosis.code, "docker_not_installed");
});

test("runDockerReadinessCheck classifies stopped colima runtime", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/" + args[0] };
      }
      if (args[0] === "context") {
        return { stdout: "colima" };
      }
      if (file === "colima" && args[0] === "status") {
        return { stdout: "Stopped" };
      }
      if (args[0] === "version") {
        const error = new Error("down");
        error.stderr = "Cannot connect to the Docker daemon";
        throw error;
      }
      const error = new Error("unsupported");
      error.stderr = "docker: unknown command: docker desktop";
      throw error;
    })
  });

  const result = await service.runDockerReadinessCheck();
  assert.equal(result.ok, false);
  assert.equal(result.diagnosis.code, "colima_stopped");
});

test("runDockerReadinessCheck treats colima status as informational when docker works", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/" + args[0] };
      }
      if (args[0] === "context") {
        return { stdout: "colima" };
      }
      if (file === "colima" && args[0] === "status") {
        const error = new Error("not running");
        error.stderr = "FATA[0000] colima is not running";
        throw error;
      }
      if (file === "colima" && args[0] === "list") {
        return { stdout: "PROFILE    STATUS\ndefault    Stopped\n" };
      }
      if (args[0] === "version") {
        return { stdout: "Client and Server" };
      }

      const error = new Error("unsupported");
      error.stderr = "docker: unknown command: docker desktop";
      throw error;
    })
  });

  const result = await service.runDockerReadinessCheck();
  const colimaStatus = result.checks.find((check) => check.command === "colima status");
  assert.equal(result.ok, true);
  assert.equal(result.diagnosis.code, "docker_ready");
  assert.equal(colimaStatus?.ok, true);
  assert.match(colimaStatus?.output || "", /informational only/i);
});

test("getContainerStatus reports running container", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (args[0] === "ps") {
        return { stdout: "Up 3 minutes" };
      }
      return { stdout: "" };
    })
  });

  const result = await service.getContainerStatus();
  assert.equal(result.exists, true);
  assert.equal(result.running, true);
});

test("stopContainer skips removal when container does not exist", async () => {
  const calls = [];
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      calls.push(args);
      if (args[0] === "ps") {
        return { stdout: "" };
      }
      return { stdout: "removed" };
    })
  });

  const result = await service.stopContainer();
  assert.equal(result.output, "Container does not exist.");
  assert.equal(calls.length, 1);
});

test("runContainer uses configured env file path", async () => {
  let seenArgs;
  const service = createDockerService({
    envPath: "/tmp/custom.env",
    execFileImpl: createExecFileMock((file, args) => {
      seenArgs = args;
      return { stdout: "container-id" };
    })
  });

  await service.runContainer();
  assert.deepEqual(seenArgs.slice(0, 4), ["run", "--env-file", "/tmp/custom.env", "-p"]);
  assert.ok(seenArgs.includes("codex-state:/data/codex"));
  assert.ok(seenArgs.includes("claude-state:/data/claude"));
});

test("buildImage returns a structured response when the docker build fails", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "docker" && args[0] === "context") {
        return { stdout: "default" };
      }
      const error = new Error("failed");
      error.stderr = "The command '/bin/sh -c pip install --no-cache-dir -r requirements.txt' returned a non-zero code: 1";
      throw error;
    })
  });

  const result = await service.buildImage();
  assert.equal(result.ok, false);
  assert.equal(result.diagnosis?.code, "docker_build_dependency_error");
});

test("runDockerNetworkCheck reports registry reachability", async () => {
  const calls = [];
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      calls.push({ file, args });
      if (file === "docker" && args[0] === "context") {
        return { stdout: "default" };
      }
      if (file === "docker" && args[0] === "version") {
        return { stdout: "Client and Server" };
      }
      if (file === "docker" && args[0] === "run") {
        return { stdout: "" };
      }
      throw new Error("unexpected");
    })
  });

  const result = await service.runDockerNetworkCheck();
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 3);
  assert.equal(calls.filter((call) => call.args[0] === "run").length, 3);
});

test("resetDockerBuilderCache prunes the builder cache", async () => {
  let seen;
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "docker" && args[0] === "context") {
        return { stdout: "default" };
      }
      seen = { file, args };
      return { stdout: "Deleted build cache objects" };
    })
  });

  const result = await service.resetDockerBuilderCache();
  assert.deepEqual(seen, { file: "docker", args: ["builder", "prune", "-af"] });
  assert.equal(result.ok, true);
});

test("getCodexContainerAuthStatus verifies codex inside the running container", async () => {
  const seen = [];
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      seen.push({ file, args });
      if (file === "docker" && args[0] === "ps") {
        return { stdout: "Up 3 minutes" };
      }
      if (file === "docker" && args[0] === "exec" && args[4] === "codex --version") {
        return { stdout: "codex 1.2.3" };
      }
      if (file === "docker" && args[0] === "exec" && args[4] === "codex login status") {
        return { stdout: "Logged in as demo@example.com" };
      }
      throw new Error("unexpected");
    })
  });

  const result = await service.getAiContainerAuthStatus({ AI_AGENT: "codex" });
  assert.equal(result.ok, true);
  assert.equal(result.checks[1].ok, true);
  assert.equal(seen.filter((call) => call.args[0] === "exec").length, 2);
});

test("getAiContainerAuthStatus verifies claude inside the running container", async () => {
  const seen = [];
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      seen.push({ file, args });
      if (file === "docker" && args[0] === "ps") {
        return { stdout: "Up 3 minutes" };
      }
      if (file === "docker" && args[0] === "exec" && args[4] === "claude --version") {
        return { stdout: "claude 0.9.0" };
      }
      if (file === "docker" && args[0] === "exec" && args[4].includes("claude auth status")) {
        return { stdout: "__PRONTO_CLAUDE_STATUS_COMMAND__:claude auth status\n__PRONTO_CLAUDE_STATUS_RC__:0\nLogged in as demo@example.com" };
      }
      throw new Error("unexpected");
    })
  });

  const result = await service.getAiContainerAuthStatus({ AI_AGENT: "claude" });
  assert.equal(result.ok, true);
  assert.equal(result.checks[1].ok, true);
  assert.equal(seen.filter((call) => call.args[0] === "exec").length, 2);
});

test("startColima runs colima start", async () => {
  let seen;
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/colima" };
      }
      seen = { file, args };
      return { stdout: "starting" };
    })
  });

  const result = await service.startColima();
  assert.deepEqual(seen, { file: "colima", args: ["start", "--runtime", "docker"] });
  assert.equal(result.ok, true);
});

test("startColima returns a structured response when colima is missing", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which" && args[0] === "colima") {
        throw new Error("not found");
      }
      throw new Error("unexpected");
    })
  });

  const result = await service.startColima();
  assert.equal(result.ok, false);
  assert.equal(result.diagnosis?.code, "colima_not_installed");
});

test("startColima returns a structured response when start fails", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which" && args[0] === "colima") {
        return { stdout: "/usr/local/bin/colima" };
      }
      const error = new Error("failed");
      error.stderr = "FATA[0000] error starting vm";
      throw error;
    })
  });

  const result = await service.startColima();
  assert.equal(result.ok, false);
  assert.equal(result.diagnosis?.code, "colima_start_failed");
});

test("openDockerDesktop launches Docker on macOS", async () => {
  let seen;
  const service = createDockerService({
    platform: "darwin",
    execFileImpl: createExecFileMock((file, args) => {
      seen = { file, args };
      return { stdout: "" };
    })
  });

  const result = await service.openDockerDesktop();
  assert.deepEqual(seen, { file: "open", args: ["-a", "Docker"] });
  assert.equal(result.ok, true);
});

test("openDockerDesktop returns a structured response when Docker Desktop is missing", async () => {
  const service = createDockerService({
    platform: "darwin",
    execFileImpl: createExecFileMock(() => {
      const error = new Error("missing");
      error.stderr = "Unable to find application named 'Docker'";
      throw error;
    })
  });

  const result = await service.openDockerDesktop();
  assert.equal(result.ok, false);
  assert.equal(result.diagnosis?.code, "docker_desktop_not_installed");
});

test("listDockerContexts returns parsed context rows", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/docker" };
      }
      return { stdout: "default|true\ncolima|false\n" };
    })
  });

  const result = await service.listDockerContexts();
  assert.equal(result.ok, true);
  assert.deepEqual(result.contexts, [
    { name: "default", current: true },
    { name: "colima", current: false }
  ]);
});

test("switchDockerContext uses docker context use", async () => {
  let seen;
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      seen = { file, args };
      return { stdout: "default" };
    })
  });

  const result = await service.switchDockerContext("default");
  assert.deepEqual(seen, { file: "docker", args: ["context", "use", "default"] });
  assert.equal(result.ok, true);
});
